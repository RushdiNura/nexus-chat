import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Message from "../models/Message.js";
import Group from "../models/Group.js";

const configureSocket = (server) => {
  const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  const io = new Server(server, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Optional cross-instance Socket.IO adapter. When REDIS_URL is absent, the
  // app continues to run in single-process mode without Redis.
  let redisPubClient = null;
  let redisSubClient = null;
  let redisPresenceClient = null;
  io.redisReady = (async () => {
    if (!process.env.REDIS_URL) return false;

    try {
      const [{ createClient }, { createAdapter }] = await Promise.all([
        import("redis"),
        import("@socket.io/redis-adapter"),
      ]);
      redisPubClient = createClient({ url: process.env.REDIS_URL });
      redisSubClient = redisPubClient.duplicate();
      redisPubClient.on("error", (error) => console.error("Redis publisher error:", error.message));
      redisSubClient.on("error", (error) => console.error("Redis subscriber error:", error.message));
      await Promise.all([redisPubClient.connect(), redisSubClient.connect()]);
      io.adapter(createAdapter(redisPubClient, redisSubClient));
      redisPresenceClient = redisPubClient;
      console.log("Socket.IO Redis adapter enabled");
      return true;
    } catch (error) {
      await Promise.allSettled([
        redisPubClient?.isOpen ? redisPubClient.quit() : Promise.resolve(),
        redisSubClient?.isOpen ? redisSubClient.quit() : Promise.resolve(),
      ]);
      throw new Error(`REDIS_URL is set but the Socket.IO Redis adapter failed to initialize: ${error.message}`);
    }
  })();

  io.closeRedisClients = async () => {
    await Promise.allSettled([
      redisPubClient?.isOpen ? redisPubClient.quit() : Promise.resolve(),
      redisSubClient?.isOpen ? redisSubClient.quit() : Promise.resolve(),
    ]);
  };

  // Presence is shared through Redis when configured. ZSET scores are lease
  // expirations, so a crashed process does not leave a user online forever.
  // Single-instance development continues to use an in-memory fallback.
  const activeSockets = new Map();
  const PRESENCE_TTL_MS = Math.max(15000, Number(process.env.PRESENCE_TTL_MS || 60000));
  const HEARTBEAT_MS = Math.max(5000, Math.floor(PRESENCE_TTL_MS / 3));
  const socketsKey = (userId) => `presence:sockets:${userId}`;
  const onlineUsersKey = "presence:online-users";

  const registerRedisSocket = async (userId, socketId) => {
    const now = Date.now();
    const result = await redisPresenceClient.eval(`
      local key = KEYS[1]
      local online = KEYS[2]
      local now = tonumber(ARGV[1])
      local expiry = tonumber(ARGV[2])
      local socketId = ARGV[3]
      redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
      local before = redis.call('ZCARD', key)
      redis.call('ZADD', key, expiry, socketId)
      redis.call('SADD', online, ARGV[4])
      return before
    `, { keys: [socketsKey(userId), onlineUsersKey], arguments: [String(now), String(now + PRESENCE_TTL_MS), socketId, userId] });
    return Number(result) === 0;
  };

  const refreshRedisSocket = async (userId, socketId) => {
    const now = Date.now();
    const result = await redisPresenceClient.eval(`
      local key = KEYS[1]
      local online = KEYS[2]
      local now = tonumber(ARGV[1])
      local expiry = tonumber(ARGV[2])
      local socketId = ARGV[3]
      local userId = ARGV[4]
      redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
      if redis.call('ZSCORE', key, socketId) then
        redis.call('ZADD', key, expiry, socketId)
        redis.call('SADD', online, userId)
        return 1
      end
      return 0
    `, { keys: [socketsKey(userId), onlineUsersKey], arguments: [String(now), String(now + PRESENCE_TTL_MS), socketId, userId] });
    return Number(result) === 1;
  };

  const unregisterRedisSocket = async (userId, socketId) => {
    const now = Date.now();
    const result = await redisPresenceClient.eval(`
      local key = KEYS[1]
      local online = KEYS[2]
      local now = tonumber(ARGV[1])
      local socketId = ARGV[2]
      local userId = ARGV[3]
      redis.call('ZREM', key, socketId)
      redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
      local count = redis.call('ZCARD', key)
      if count == 0 then
        redis.call('SREM', online, userId)
        redis.call('DEL', key)
      end
      return count
    `, { keys: [socketsKey(userId), onlineUsersKey], arguments: [String(now), socketId, userId] });
    return Number(result);
  };

  const getOnlineUserIds = async () => {
    if (redisPresenceClient) return redisPresenceClient.sMembers(onlineUsersKey);
    return [...activeSockets.keys()];
  };

  const publishPresence = async (userId, isOnline, lastSeen = null) => {
    io.emit("user-status-changed", { userId, isOnline, lastSeen });
    try { io.emit("online-users", await getOnlineUserIds()); }
    catch (error) { console.error("Unable to read shared presence:", error.message); }
  };

  // Sweep leases left behind by a crashed process. Each user's expiry cleanup
  // is atomic with online-set removal; the DB write is rechecked against Redis
  // afterward to reduce stale offline writes during a concurrent reconnect.
  const sweepExpiredPresence = async () => {
    if (!redisPresenceClient) return;
    try {
      for await (const key of redisPresenceClient.scanIterator({ MATCH: "presence:sockets:*", COUNT: 100 })) {
        const userId = String(key).slice("presence:sockets:".length);
        const now = Date.now();
        const count = Number(await redisPresenceClient.eval(`
          local key = KEYS[1]
          local online = KEYS[2]
          local now = tonumber(ARGV[1])
          local userId = ARGV[2]
          redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
          local count = redis.call('ZCARD', key)
          if count == 0 then
            redis.call('SREM', online, userId)
            redis.call('DEL', key)
          end
          return count
        `, { keys: [String(key), onlineUsersKey], arguments: [String(now), userId] }));
        if (count === 0) {
          const lastSeen = new Date();
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen }).catch(() => {});
          const stillOnline = await redisPresenceClient.sIsMember(onlineUsersKey, userId);
          if (stillOnline) {
            await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: null }).catch(() => {});
          } else {
            await publishPresence(userId, false, lastSeen);
          }
        }
      }
    } catch (error) {
      console.error("Presence lease sweep failed:", error.message);
    }
  };
  const presenceSweepTimer = setInterval(sweepExpiredPresence, 15000);
  presenceSweepTimer.unref?.();
  io.closePresenceSweep = () => clearInterval(presenceSweepTimer);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || !process.env.MY_JWT) return next(new Error("Authentication required"));
      const decoded = jwt.verify(token, process.env.MY_JWT);
      const user = await User.findById(decoded.id).select("_id fullName");
      if (!user) return next(new Error("User not found"));
      socket.userId = user._id.toString();
      socket.userName = user.fullName;
      next();
    } catch {
      next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);

    let wasOffline = false;
    let heartbeatTimer = null;
    let registered = false;
    if (redisPresenceClient) {
      try {
        wasOffline = await registerRedisSocket(userId, socket.id);
        registered = true;
        heartbeatTimer = setInterval(async () => {
          try {
            const active = await refreshRedisSocket(userId, socket.id);
            if (!active && socket.connected) {
              // Lease expired after a transient Redis outage; register again.
              const becameOnline = await registerRedisSocket(userId, socket.id);
              if (becameOnline) {
                await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: null }).catch(() => {});
                await publishPresence(userId, true);
              }
            }
          } catch (error) { console.error("Presence heartbeat failed:", error.message); }
        }, HEARTBEAT_MS);
        heartbeatTimer.unref?.();
      } catch (error) {
        console.error("Unable to register shared presence:", error.message);
        socket.disconnect(true);
        return;
      }
    } else {
      const sockets = activeSockets.get(userId) || new Set();
      wasOffline = sockets.size === 0;
      sockets.add(socket.id);
      activeSockets.set(userId, sockets);
      registered = true;
    }

    // The Redis registration above awaits I/O. If the client vanished during
    // that await, its disconnect event could fire before the cleanup listener
    // was installed; reconcile that case explicitly before attaching handlers.
    if (!socket.connected) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (registered) {
        try {
          if (redisPresenceClient) {
            const remaining = await unregisterRedisSocket(userId, socket.id);
            if (remaining === 0) {
              const lastSeen = new Date();
              await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen }).catch(() => {});
              await publishPresence(userId, false, lastSeen);
            }
          } else {
            const current = activeSockets.get(userId);
            current?.delete(socket.id);
            if (current?.size === 0) {
              activeSockets.delete(userId);
              const lastSeen = new Date();
              await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen }).catch(() => {});
              await publishPresence(userId, false, lastSeen);
            }
          }
        } catch (error) { console.error("Presence setup cleanup failed:", error.message); }
      }
      return;
    }

    socket.on("disconnect", async () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (!registered) return;
      try {
        let count = 0;
        if (redisPresenceClient) {
          count = await unregisterRedisSocket(userId, socket.id);
        } else {
          const current = activeSockets.get(userId);
          if (!current || !current.has(socket.id)) return;
          current.delete(socket.id);
          count = current.size;
          if (count === 0) activeSockets.delete(userId);
        }
        if (count === 0) {
          const lastSeen = new Date();
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen }).catch(() => {});
          // Recheck after the DB write so an overlapping reconnect cannot be
          // left marked offline by this older disconnect operation.
          const stillOnline = redisPresenceClient
            ? await redisPresenceClient.sIsMember(onlineUsersKey, userId)
            : activeSockets.has(userId);
          if (stillOnline) {
            await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: null }).catch(() => {});
            await publishPresence(userId, true);
          } else {
            await publishPresence(userId, false, lastSeen);
          }
        }
      } catch (error) {
        console.error("Presence disconnect cleanup failed:", error.message);
      }
    });

    if (wasOffline) {
      await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: null }).catch(() => {});
      await publishPresence(userId, true);
    }

    const memberships = await Group.find({ members: userId }).select("_id").lean().catch(() => []);
    if (socket.connected) memberships.forEach((group) => socket.join(`group:${String(group._id)}`));
    if (socket.connected) socket.emit("online-users", await getOnlineUserIds().catch(() => []));
    socket.on("sync-group-rooms", async () => {
      const groups = await Group.find({ members: userId }).select("_id").lean().catch(() => []);
      const allowedRooms = new Set(groups.map((group) => `group:${String(group._id)}`));
      for (const room of socket.rooms) {
        if (room.startsWith("group:") && !allowedRooms.has(room)) socket.leave(room);
      }
      groups.forEach((group) => socket.join(`group:${String(group._id)}`));
    });

    socket.on("typing-start", async ({ receiverId } = {}) => {
      if (typeof receiverId !== "string" || receiverId === userId) return;
      try {
        const recipientExists = await User.exists({ _id: receiverId });
        const related = await Message.exists({ $or: [
          { senderId: userId, receiverId },
          { senderId: receiverId, receiverId: userId },
        ] });
        if (recipientExists && related) {
          socket.to(`user:${receiverId}`).emit("typing-start", { senderId: userId, senderName: socket.userName });
        }
      } catch {
        // Ignore malformed IDs and transient database errors for ephemeral typing events.
      }
    });
    socket.on("typing-stop", ({ receiverId } = {}) => {
      if (typeof receiverId !== "string" || receiverId === userId) return;
      socket.to(`user:${receiverId}`).emit("typing-stop", { senderId: userId });
    });

    // Group typing is ephemeral. Confirm membership before relaying either event so
    // clients cannot spoof activity inside rooms they do not belong to.
    socket.on("group-typing-start", async ({ groupId } = {}) => {
      if (typeof groupId !== "string" || !groupId.trim()) return;
      try {
        const isMember = await Group.exists({ _id: groupId, members: userId });
        if (!isMember) return;
        socket.to(`group:${groupId}`).emit("group-typing-start", {
          groupId,
          senderId: userId,
          senderName: socket.userName,
        });
      } catch {
        // Ignore malformed group IDs and transient database errors.
      }
    });
    socket.on("group-typing-stop", async ({ groupId } = {}) => {
      if (typeof groupId !== "string" || !groupId.trim()) return;
      try {
        const isMember = await Group.exists({ _id: groupId, members: userId });
        if (!isMember) return;
        socket.to(`group:${groupId}`).emit("group-typing-stop", { groupId, senderId: userId });
      } catch {
        // Ignore malformed group IDs and transient database errors.
      }
    });

    socket.on("message-delivered", async ({ messageId } = {}) => {
      try {
        if (!messageId) return;
        const message = await Message.findOneAndUpdate(
          { _id: messageId, receiverId: userId, deliveredAt: { $exists: false } },
          { $set: { deliveredAt: new Date() } },
          { new: true }
        );
        if (message) io.to(`user:${String(message.senderId)}`).emit("message-delivered", {
          messageId: String(message._id), deliveredAt: message.deliveredAt, deliveredTo: userId,
        });
      } catch (error) {
        console.error("Unable to mark message delivered:", error.message);
      }
    });

    socket.on("message-seen", async ({ messageId } = {}) => {
      try {
        if (!messageId) return;
        const message = await Message.findOneAndUpdate(
          { _id: messageId, receiverId: userId, seen: false },
          { $set: { seen: true, seenAt: new Date() } },
          { new: true }
        );
        if (message) io.to(`user:${String(message.senderId)}`).emit("message-seen", {
          messageId: String(message._id), seenAt: message.seenAt, seenBy: userId,
        });
      } catch (error) {
        console.error("Unable to mark message seen:", error.message);
      }
    });

  });

  return io;
};

export default configureSocket;
