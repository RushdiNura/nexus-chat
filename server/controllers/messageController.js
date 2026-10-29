import mongoose from "mongoose";
import Message from "../models/Message.js";
import User from "../models/User.js";
import cloudinary from "../lib/cloudinary.js";
import { io } from "../server.js";

const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const userRoom = (id) => `user:${String(id)}`;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_IMAGE_DATA_LENGTH = 4 * 1024 * 1024;
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "🔥"]);

export const getUsersForSidebar = async (req, res) => {
  try {
    const userId = String(req.user_id || "");
    if (!validId(userId)) {
      return res.status(401).json({ success: false, message: "Invalid authenticated user" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const users = await User.find({ _id: { $ne: userObjectId } })
      .select("-password")
      .lean();

    // Keep the inbox ordered by the most recent direct conversation activity.
    const recentMessages = await Message.aggregate([
      { $match: { $or: [{ senderId: userObjectId }, { receiverId: userObjectId }] } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$senderId", userObjectId] },
              "$receiverId",
              "$senderId",
            ],
          },
          lastMessage: { $first: "$$ROOT" },
        },
      },
    ]);
    const latestByUser = new Map(recentMessages.map((row) => [String(row._id), row.lastMessage]));
    const filteredUser = users
      .map((user) => ({ ...user, lastMessage: latestByUser.get(String(user._id)) || null }))
      .sort((a, b) => {
        const activityDiff = new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0);
        return activityDiff || (a.fullName || "").localeCompare(b.fullName || "");
      });

    const unread = await Message.aggregate([
      {
        $match: {
          senderId: { $in: users.map((user) => user._id) },
          receiverId: userObjectId,
          seen: false,
        },
      },
      { $group: { _id: "$senderId", count: { $sum: 1 } } },
    ]);
    const unseenMessages = Object.fromEntries(unread.map((row) => [String(row._id), row.count]));

    return res.status(200).json({ success: true, filteredUser, unseenMessages });
  } catch (error) {
    console.error("Sidebar users failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load users" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { id: otherId } = req.params;
    const myId = String(req.user_id || "");
    if (!validId(otherId) || !validId(myId) || String(otherId) === myId) {
      return res.status(400).json({ success: false, message: "Invalid conversation" });
    }

    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 100);
    const beforeValue = req.query.before;
    const beforeDate = beforeValue && !Number.isNaN(Date.parse(beforeValue))
      ? new Date(beforeValue)
      : null;
    const query = {
      $or: [
        { senderId: myId, receiverId: otherId },
        { senderId: otherId, receiverId: myId },
      ],
    };
    if (beforeDate) query.createdAt = { $lt: beforeDate };

    const rows = await Message.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    const messages = rows.reverse();
    const incoming = rows.filter(
      (message) => String(message.senderId) === String(otherId) && String(message.receiverId) === myId,
    );

    // Delivery/read receipts only affect messages on this page; requesting an older
    // page must not silently mark unrelated messages elsewhere in the conversation.
    const notYetDelivered = incoming.filter((message) => !message.deliveredAt);
    if (notYetDelivered.length) {
      const deliveredAt = new Date();
      const ids = notYetDelivered.map((message) => message._id);
      await Message.updateMany(
        { _id: { $in: ids }, receiverId: myId, deliveredAt: { $exists: false } },
        { $set: { deliveredAt } },
      );
      for (const message of notYetDelivered) {
        io.to(userRoom(message.senderId)).emit("message-delivered", {
          messageId: String(message._id),
          deliveredAt,
          deliveredTo: myId,
        });
        message.deliveredAt = deliveredAt;
      }
    }

    const notYetSeen = incoming.filter((message) => !message.seen);
    if (notYetSeen.length) {
      const seenAt = new Date();
      const ids = notYetSeen.map((message) => message._id);
      const changed = await Message.updateMany(
        { _id: { $in: ids }, receiverId: myId, seen: false },
        { $set: { seen: true, seenAt } },
      );
      if (changed.modifiedCount) {
        io.to(userRoom(otherId)).emit("messages-read", {
          readerId: myId,
          seenAt,
          messageIds: notYetSeen.map((message) => String(message._id)),
        });
        for (const message of notYetSeen) {
          message.seen = true;
          message.seenAt = seenAt;
        }
      }
    }

    return res.status(200).json({ success: true, messages, hasMore: rows.length === limit });
  } catch (error) {
    console.error("Get messages failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load messages" });
  }
};

export const getMessageAsSeen = async (req, res) => {
  try {
    const myId = String(req.user_id || "");
    const { id } = req.params;
    if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid message ID" });

    const existing = await Message.findOne({ _id: id, receiverId: myId });
    if (!existing) return res.status(404).json({ success: false, message: "Message not found" });

    if (!existing.seen) {
      existing.seen = true;
      existing.seenAt = new Date();
      if (!existing.deliveredAt) existing.deliveredAt = existing.seenAt;
      await existing.save();
      const payload = {
        messageId: String(existing._id),
        seenAt: existing.seenAt,
        seenBy: myId,
      };
      io.to(userRoom(existing.senderId)).emit("message-seen", payload);
      io.to(userRoom(existing.senderId)).emit("messages-read", {
        readerId: myId,
        seenAt: existing.seenAt,
        messageIds: [String(existing._id)],
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark message seen failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update message status" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const receiverId = String(req.params.id || "");
    const senderId = String(req.user_id || "");
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const image = body.image;
    const clientMessageId = typeof body.clientMessageId === "string"
      ? body.clientMessageId.trim().slice(0, 100)
      : undefined;

    if (!validId(receiverId) || !validId(senderId) || receiverId === senderId) {
      return res.status(400).json({ success: false, message: "Invalid recipient" });
    }
    if (!text && !image) return res.status(400).json({ success: false, message: "A message cannot be empty" });
    if (text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ success: false, message: "Message is too long" });
    }
    if (!(await User.exists({ _id: receiverId }))) {
      return res.status(404).json({ success: false, message: "Recipient not found" });
    }

    // Idempotency is scoped to the sender, but a reused ID may not leak a message
    // from another recipient's conversation.
    if (clientMessageId) {
      const existing = await Message.findOne({ senderId, clientMessageId });
      if (existing) {
        if (String(existing.receiverId) !== receiverId) {
          return res.status(409).json({ success: false, message: "This message ID was already used for another conversation" });
        }
        return res.status(200).json({ success: true, newMessage: existing, duplicate: true });
      }
    }

    let imageUrl;
    if (image) {
      if (typeof image !== "string" || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(image)) {
        return res.status(400).json({ success: false, message: "Unsupported image format" });
      }
      if (image.length > MAX_IMAGE_DATA_LENGTH) {
        return res.status(413).json({ success: false, message: "Image is too large" });
      }
      const uploaded = await cloudinary.uploader.upload(image, {
        folder: "chatapp/messages",
        resource_type: "image",
      });
      imageUrl = uploaded.secure_url;
    }

    let replyTo;
    const replyTarget = typeof body.replyTo === "string"
      ? body.replyTo
      : body.replyTo?.messageId || body.replyTo?._id;
    if (replyTarget) {
      if (!validId(replyTarget)) return res.status(400).json({ success: false, message: "Invalid reply target" });
      const original = await Message.findOne({
        _id: replyTarget,
        $or: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      }).lean();
      if (!original || original.deletedForEveryone) {
        return res.status(400).json({ success: false, message: "The message you're replying to is unavailable" });
      }
      replyTo = {
        messageId: original._id,
        senderId: original.senderId,
        text: original.text || "",
        image: original.image || undefined,
      };
    }

    const newMessage = await Message.create({
      text,
      ...(imageUrl ? { image: imageUrl } : {}),
      receiverId,
      senderId,
      ...(replyTo ? { replyTo } : {}),
      ...(clientMessageId ? { clientMessageId } : {}),
    });
    io.to(userRoom(receiverId)).emit("newMessage", newMessage);
    io.to(userRoom(senderId)).emit("newMessage", newMessage);
    return res.status(201).json({ success: true, newMessage });
  } catch (error) {
    if (error?.code === 11000) {
      const clientMessageId = typeof req.body?.clientMessageId === "string"
        ? req.body.clientMessageId.trim().slice(0, 100)
        : undefined;
      const existing = clientMessageId
        ? await Message.findOne({
            senderId: String(req.user_id),
            clientMessageId,
            receiverId: String(req.params.id),
          })
        : null;
      if (existing) return res.status(200).json({ success: true, newMessage: existing, duplicate: true });
      return res.status(409).json({ success: false, message: "Message ID conflict; retry with a new message ID" });
    }
    console.error("Send message failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to send message" });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const senderId = String(req.user_id || "");
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid message ID" });
    if (!text || text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ success: false, message: "Edited text must contain 1–10,000 characters" });
    }

    const message = await Message.findOne({
      _id: id,
      senderId,
      deletedForEveryone: { $ne: true },
    });
    if (!message) return res.status(404).json({ success: false, message: "Message not found or you cannot edit it" });
    if (message.image && !message.text) {
      return res.status(400).json({ success: false, message: "Image-only messages cannot be edited" });
    }

    message.text = text;
    message.editedAt = new Date();
    await message.save();
    const payload = message.toObject();
    io.to(userRoom(message.senderId)).emit("message-updated", payload);
    io.to(userRoom(message.receiverId)).emit("message-updated", payload);
    return res.status(200).json({ success: true, message: payload });
  } catch (error) {
    console.error("Edit message failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to edit message" });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const senderId = String(req.user_id || "");
    if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid message ID" });

    // Keep a tombstone so both sides can show a deleted-message placeholder and
    // existing replies/history are not broken by a hard delete.
    const message = await Message.findOne({
      _id: id,
      senderId,
      deletedForEveryone: { $ne: true },
    });
    if (!message) return res.status(404).json({ success: false, message: "Message not found or already deleted" });

    message.deletedForEveryone = true;
    message.text = "";
    message.image = undefined;
    message.editedAt = undefined;
    message.pinnedAt = undefined;
    message.pinnedBy = undefined;
    message.reactions = [];
    await message.save();

    const payload = message.toObject();
    io.to(userRoom(message.senderId)).emit("message-updated", payload);
    io.to(userRoom(message.receiverId)).emit("message-updated", payload);
    return res.status(200).json({ success: true, message: payload });
  } catch (error) {
    console.error("Delete message failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to delete message" });
  }
};

export const toggleMessageReaction = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = String(req.user_id || "");
    const emoji = req.body?.emoji;
    if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid message ID" });
    if (!ALLOWED_REACTIONS.has(emoji)) {
      return res.status(400).json({ success: false, message: "Unsupported reaction" });
    }

    const message = await Message.findOne({
      _id: id,
      deletedForEveryone: { $ne: true },
      $or: [{ senderId: userId }, { receiverId: userId }],
    });
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });

    const reactions = Array.isArray(message.reactions) ? message.reactions : [];
    const existingIndex = reactions.findIndex((reaction) => String(reaction.userId) === userId);
    if (existingIndex >= 0 && reactions[existingIndex].emoji === emoji) {
      reactions.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      reactions[existingIndex].emoji = emoji;
      reactions[existingIndex].createdAt = new Date();
    } else {
      reactions.push({ userId, emoji, createdAt: new Date() });
    }
    message.reactions = reactions;
    await message.save();

    const payload = message.toObject();
    io.to(userRoom(message.senderId)).emit("message-updated", payload);
    io.to(userRoom(message.receiverId)).emit("message-updated", payload);
    return res.status(200).json({ success: true, message: payload });
  } catch (error) {
    console.error("Toggle message reaction failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update reaction" });
  }
};

export const forwardMessage = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const senderId = String(req.user_id || "");
    const recipientId = String(req.body?.recipientId || "");
    if (!validId(messageId) || !validId(recipientId) || recipientId === senderId) {
      return res.status(400).json({ success: false, message: "Choose a valid recipient" });
    }

    const original = await Message.findOne({
      _id: messageId,
      deletedForEveryone: { $ne: true },
      $or: [{ senderId }, { receiverId: senderId }],
    }).lean();
    if (!original) return res.status(404).json({ success: false, message: "Message not found or unavailable to forward" });
    if (!original.text && !original.image) {
      return res.status(400).json({ success: false, message: "This message has no content to forward" });
    }
    if (!(await User.exists({ _id: recipientId }))) {
      return res.status(404).json({ success: false, message: "Recipient not found" });
    }

    const originalSender = await User.findById(original.senderId).select("fullName").lean();
    const forwarded = await Message.create({
      senderId,
      receiverId: recipientId,
      text: original.text || "",
      ...(original.image ? { image: original.image } : {}),
      forwardedFrom: {
        senderId: original.senderId,
        senderName: originalSender?.fullName || "NexusChat user",
      },
    });
    const payload = forwarded.toObject();
    io.to(userRoom(recipientId)).emit("newMessage", payload);
    io.to(userRoom(senderId)).emit("newMessage", payload);
    return res.status(201).json({ success: true, newMessage: payload });
  } catch (error) {
    console.error("Forward message failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to forward message" });
  }
};

export const getPinnedMessages = async (req, res) => {
  try {
    const { id: otherId } = req.params;
    const myId = String(req.user_id || "");
    if (!validId(otherId) || !validId(myId) || String(otherId) === myId) {
      return res.status(400).json({ success: false, message: "Invalid conversation" });
    }

    const messages = await Message.find({
      pinnedAt: { $exists: true, $ne: null },
      deletedForEveryone: { $ne: true },
      $or: [
        { senderId: myId, receiverId: otherId },
        { senderId: otherId, receiverId: myId },
      ],
    }).sort({ pinnedAt: -1 }).limit(20).lean();
    return res.status(200).json({ success: true, messages });
  } catch (error) {
    console.error("Get pinned messages failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load pinned messages" });
  }
};

export const togglePinnedMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = String(req.user_id || "");
    if (!validId(id)) return res.status(400).json({ success: false, message: "Invalid message ID" });

    const message = await Message.findOne({
      _id: id,
      deletedForEveryone: { $ne: true },
      $or: [{ senderId: userId }, { receiverId: userId }],
    });
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });

    if (message.pinnedAt) {
      message.pinnedAt = undefined;
      message.pinnedBy = undefined;
    } else {
      message.pinnedAt = new Date();
      message.pinnedBy = userId;
    }
    await message.save();

    const payload = message.toObject();
    io.to(userRoom(message.senderId)).emit("message-updated", payload);
    io.to(userRoom(message.receiverId)).emit("message-updated", payload);
    return res.status(200).json({ success: true, message: payload });
  } catch (error) {
    console.error("Toggle pinned message failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update pinned message" });
  }
};
