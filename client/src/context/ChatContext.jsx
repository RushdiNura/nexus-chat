import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
/* eslint-disable react-refresh/only-export-components */
import AuthContext from "./AuthContext";
import toast from "react-hot-toast";
import { listOutboxMessages, removeOutboxMessage, saveOutboxMessage } from "../lib/offlineOutbox";

export const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const { socket, axios, authUser } = useContext(AuthContext);
  const [messages, setMessages] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroupState] = useState(null);
  const selectedGroupRef = useRef(null);
  // Update the ref synchronously with selection so in-flight group requests
  // cannot act on a stale selection during a fast click/switch.
  const setSelectedGroup = useCallback((nextGroup) => {
    const resolvedGroup = typeof nextGroup === "function"
      ? nextGroup(selectedGroupRef.current)
      : nextGroup;
    selectedGroupRef.current = resolvedGroup || null;
    setSelectedGroupState(resolvedGroup || null);
  }, []);
  const [groupMessages, setGroupMessages] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [unseenMessages, setUnseenMessages] = useState({});
  const [typingUsers, setTypingUsers] = useState({});
  const [groupTypingUsers, setGroupTypingUsers] = useState({});
  const groupTypingTimersRef = useRef(new Map());
  const [isSocketConnected, setIsSocketConnected] = useState(Boolean(socket?.connected));
  const [pendingMessageIds, setPendingMessageIds] = useState([]);
  const outboxFlushRef = useRef(false);
  const selectedUserRef = useRef(selectedUser);
  const authUserRef = useRef(authUser);
  const messageRequestRef = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  selectedUserRef.current = selectedUser;
  authUserRef.current = authUser;

  const updateMessage = useCallback(async (messageId, text) => {
    try {
      const { data } = await axios.patch(`/api/messages/${messageId}`, { text });
      if (!data.success) throw new Error(data.message || "Message could not be edited");
      setMessages((prev) => prev.map((item) => String(item._id) === String(messageId) ? data.message : item));
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Message could not be edited");
      return false;
    }
  }, [axios]);

  const deleteMessage = useCallback(async (messageId) => {
    try {
      const { data } = await axios.delete(`/api/messages/${messageId}`);
      if (!data.success) throw new Error(data.message || "Message could not be deleted");
      setMessages((prev) => prev.map((item) => String(item._id) === String(messageId) ? data.message : item));
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Message could not be deleted");
      return false;
    }
  }, [axios]);

  const getUsers = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/messages/users");
      if (data.success) {
        setUsers(data.filteredUser || []);
        setUnseenMessages(data.unseenMessages || {});
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load contacts");
    }
  }, [axios]);

  const forwardMessage = useCallback(async (messageId, recipientId) => {
    try {
      const { data } = await axios.post(`/api/messages/${messageId}/forward`, { recipientId });
      if (!data.success || !data.newMessage) throw new Error(data.message || "Message could not be forwarded");
      // The server emits the forwarded message to all recipient sessions; update the
      // active view only when the destination is the conversation currently open.
      if (String(selectedUserRef.current?._id) === String(recipientId)) {
        setMessages((prev) => prev.some((item) => String(item._id) === String(data.newMessage._id))
          ? prev
          : [...prev, data.newMessage].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
      }
      await getUsers();
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Message could not be forwarded");
      return false;
    }
  }, [axios, getUsers]);

  const toggleReaction = useCallback(async (messageId, emoji) => {
    try {
      const { data } = await axios.post(`/api/messages/${messageId}/reactions`, { emoji });
      if (!data.success || !data.message) throw new Error(data.message || "Reaction could not be updated");
      setMessages((prev) => prev.map((item) => String(item._id) === String(messageId) ? data.message : item));
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Reaction could not be updated");
      return false;
    }
  }, [axios]);

  const getPinnedMessages = useCallback(async (userId) => {
    if (!userId) { setPinnedMessages([]); return; }
    try {
      const { data } = await axios.get(`/api/messages/pinned/${userId}`);
      if (data.success) setPinnedMessages(data.messages || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load pinned messages");
    }
  }, [axios]);

  const togglePinnedMessage = useCallback(async (messageId) => {
    try {
      const { data } = await axios.patch(`/api/messages/${messageId}/pin`);
      if (!data.success || !data.message) throw new Error(data.message || "Pin could not be updated");
      setMessages((prev) => prev.map((item) => String(item._id) === String(messageId) ? data.message : item));
      setPinnedMessages((prev) => {
        const withoutMessage = prev.filter((item) => String(item._id) !== String(messageId));
        return data.message.pinnedAt ? [data.message, ...withoutMessage] : withoutMessage;
      });
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Pin could not be updated");
      return false;
    }
  }, [axios]);



  const getGroups = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/groups");
      if (data.success) {
        const serverGroups = Array.isArray(data.groups) ? data.groups : [];
        const currentGroup = selectedGroupRef.current;
        const currentGroupId = String(currentGroup?._id || currentGroup?.id || "");
        const updatedCurrentGroup = currentGroupId
          ? serverGroups.find((group) => String(group._id || group.id || "") === currentGroupId)
          : null;

        if (updatedCurrentGroup) {
          setSelectedGroup(updatedCurrentGroup);
          setGroups(serverGroups);
        } else if (currentGroup && currentGroupId) {
          // A group-list request may have started before a group was created or
          // selected. Do not close a valid open chat because an older response
          // omitted it; explicit group-removed events clear the selection.
          setGroups([currentGroup, ...serverGroups.filter((group) => String(group._id || group.id || "") !== currentGroupId)]);
        } else {
          setGroups(serverGroups);
        }
      }
      socket?.emit("sync-group-rooms");
    } catch (error) { toast.error(error.response?.data?.message || "Unable to load groups"); }
  }, [axios, socket, setSelectedGroup]);

  const openGroup = useCallback((group) => {
    const groupId = String(group?._id || group?.id || "");
    if (!groupId) {
      toast.error("This group has no valid ID. Refresh the group list and try again.");
      return false;
    }
    const normalizedGroup = { ...group, _id: groupId };
    setSelectedUser(null);
    setGroupMessages([]);
    setSelectedGroup(normalizedGroup);
    return true;
  }, [setSelectedGroup]);

  const createGroup = useCallback(async ({ name, description, memberIds }) => {
    try {
      const { data } = await axios.post("/api/groups", { name, description, memberIds });
      if (!data.success || !data.group) throw new Error(data.message || "Group could not be created");
      const createdGroup = { ...data.group, _id: String(data.group._id || data.group.id) };
      setGroups((prev) => [createdGroup, ...prev.filter((item) => String(item._id || item.id) !== String(createdGroup._id))]);
      socket?.emit("sync-group-rooms");
      setSelectedUser(null);
      setGroupMessages([]);
      setSelectedGroup(createdGroup);
      return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Group could not be created"); return false; }
  }, [axios, socket, setSelectedUser, setSelectedGroup]);

  const editGroupMessage = useCallback(async (messageId, text) => {
    try {
      const { data } = await axios.patch(`/api/groups/messages/${messageId}`, { text });
      if (!data.success || !data.message) throw new Error(data.message || "Message could not be edited");
      setGroupMessages((prev) => prev.map((item) => String(item._id) === String(messageId) ? data.message : item));
      return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Message could not be edited"); return false; }
  }, [axios]);

  const deleteGroupMessage = useCallback(async (messageId) => {
    try {
      const { data } = await axios.delete(`/api/groups/messages/${messageId}`);
      if (!data.success || !data.message) throw new Error(data.message || "Message could not be deleted");
      setGroupMessages((prev) => prev.map((item) => String(item._id) === String(messageId) ? data.message : item));
      return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Message could not be deleted"); return false; }
  }, [axios]);

  const toggleGroupReaction = useCallback(async (messageId, emoji) => {
    try {
      const { data } = await axios.post(`/api/groups/messages/${messageId}/reactions`, { emoji });
      if (!data.success || !data.message) throw new Error(data.message || "Reaction could not be updated");
      setGroupMessages((prev) => prev.map((item) => String(item._id) === String(messageId) ? data.message : item));
      return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Reaction could not be updated"); return false; }
  }, [axios]);

  const toggleGroupPinnedMessage = useCallback(async (messageId) => {
    try {
      const { data } = await axios.patch(`/api/groups/messages/${messageId}/pin`);
      if (!data.success || !data.group) throw new Error(data.message || "Pin could not be updated");
      setSelectedGroup(data.group);
      setGroups((prev) => prev.map((group) => String(group._id) === String(data.group._id) ? data.group : group));
      return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Pin could not be updated"); return false; }
  }, [axios, setSelectedGroup]);

  const markGroupRead = useCallback(async (groupId) => {
    if (!groupId) return;
    try { await axios.post(`/api/groups/${groupId}/read`); }
    catch (error) { console.warn("Unable to update group read receipts:", error.response?.data?.message || error.message); }
  }, [axios]);

  const addGroupMembers = useCallback(async (groupId, memberIds) => {
    try {
      const { data } = await axios.post(`/api/groups/${groupId}/members`, { memberIds });
      if (!data.success || !data.group) throw new Error(data.message || "Members could not be added");
      setGroups((prev) => prev.map((group) => String(group._id) === String(groupId) ? data.group : group));
      if (String(selectedGroupRef.current?._id) === String(groupId)) setSelectedGroup(data.group);
      socket?.emit("sync-group-rooms");
      return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Members could not be added"); return false; }
  }, [axios, socket, setSelectedGroup]);

  const removeGroupMember = useCallback(async (groupId, memberId) => {
    try {
      const { data } = await axios.delete(`/api/groups/${groupId}/members/${memberId}`);
      if (!data.success) throw new Error(data.message || "Member could not be removed");
      if (data.deleted || String(memberId) === String(authUserRef.current?._id)) {
        setGroups((prev) => prev.filter((group) => String(group._id) !== String(groupId)));
        if (String(selectedGroupRef.current?._id) === String(groupId)) { setSelectedGroup(null); setGroupMessages([]); }
      } else {
        setGroups((prev) => prev.map((group) => String(group._id) === String(groupId) ? data.group : group));
        if (String(selectedGroupRef.current?._id) === String(groupId)) setSelectedGroup(data.group);
      }
      socket?.emit("sync-group-rooms");
      return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Member could not be removed"); return false; }
  }, [axios, socket, setSelectedGroup]);

  const getGroupMessages = useCallback(async (groupId) => {
    try {
      const { data } = await axios.get(`/api/groups/${groupId}/messages`);
      if (data.success && String(selectedGroupRef.current?._id) === String(groupId)) { setGroupMessages(data.messages || []); markGroupRead(groupId); }
    } catch (error) { toast.error(error.response?.data?.message || "Unable to load group messages"); }
  }, [axios, markGroupRead]);

  const sendGroupMessage = useCallback(async (text, image = "", replyToMessageId = null) => {
    const group = selectedGroupRef.current;
    const cleanText = typeof text === "string" ? text.trim() : "";
    if (!group || (!cleanText && !image)) return false;
    const clientMessageId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const { data } = await axios.post(`/api/groups/${group._id}/messages`, { text: cleanText, ...(image ? { image } : {}), ...(replyToMessageId ? { replyTo: replyToMessageId } : {}), clientMessageId });
      if (!data.success || !data.message) throw new Error(data.message || "Message could not be sent");
      setGroupMessages((prev) => prev.some((item) => String(item._id) === String(data.message._id)) ? prev : [...prev, data.message]);
      getGroups(); return true;
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Message could not be sent"); return false; }
  }, [axios, getGroups]);

  const forwardGroupMessage = useCallback(async (messageId, targetGroupId) => {
    try {
      const { data } = await axios.post(`/api/groups/messages/${messageId}/forward`, { targetGroupId });
      if (!data.success || !data.message) throw new Error(data.message || "Group message could not be forwarded");
      if (String(selectedGroupRef.current?._id) === String(targetGroupId)) {
        setGroupMessages((prev) => prev.some((item) => String(item._id) === String(data.message._id))
          ? prev
          : [...prev, data.message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
      }
      await getGroups();
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Group message could not be forwarded");
      return false;
    }
  }, [axios, getGroups]);

  const getMessages = useCallback(async (userId) => {
    const requestId = ++messageRequestRef.current;
    try {
      const { data } = await axios.get(`/api/messages/${userId}`);
      if (data.success && requestId === messageRequestRef.current && selectedUserRef.current?._id === userId) {
        setMessages((prev) => {
          const byId = new Map();
          for (const item of [...(data.messages || []), ...prev]) {
            byId.set(String(item._id || item.clientMessageId), item);
          }
          return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        });
        setHasMoreMessages(Boolean(data.hasMore));
        setUnseenMessages((prev) => ({ ...prev, [userId]: 0 }));
      }
    } catch (error) {
      if (requestId === messageRequestRef.current) toast.error(error.response?.data?.message || "Unable to load conversation");
    }
  }, [axios]);

  const loadOlderMessages = useCallback(async () => {
    const userId = selectedUserRef.current?._id;
    const currentMessages = messagesRef.current;
    const oldestMessage = currentMessages[0];
    if (!userId || !oldestMessage?.createdAt || !hasMoreMessages || isLoadingOlder) return false;

    setIsLoadingOlder(true);
    try {
      const { data } = await axios.get(`/api/messages/${userId}`, {
        params: { limit: 50, before: oldestMessage.createdAt },
      });
      if (!data.success || selectedUserRef.current?._id !== userId) return false;
      const older = data.messages || [];
      setMessages((current) => {
        const byId = new Map();
        for (const item of [...older, ...current]) byId.set(String(item._id || item.clientMessageId), item);
        return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      });
      setHasMoreMessages(Boolean(data.hasMore));
      return older.length > 0;
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load older messages");
      return false;
    } finally {
      setIsLoadingOlder(false);
    }
  }, [axios, hasMoreMessages, isLoadingOlder]);

  const sendMessage = useCallback(async (messageData) => {
    const recipient = selectedUserRef.current;
    const ownerId = authUserRef.current?._id;
    if (!recipient || !ownerId) return false;
    const clientMessageId = messageData.clientMessageId || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const payload = { ...messageData, clientMessageId };
    try {
      const { data } = await axios.post(`/api/messages/send/${recipient._id}`, payload);
      if (data.success && data.newMessage) {
        setMessages((prev) => prev.some((item) => String(item._id) === String(data.newMessage._id) || item.clientMessageId === clientMessageId)
          ? prev.map((item) => item.clientMessageId === clientMessageId ? data.newMessage : item)
          : [...prev, data.newMessage].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        setPendingMessageIds((prev) => prev.filter((id) => id !== clientMessageId));
        await removeOutboxMessage(clientMessageId).catch(() => {});
        getUsers();
        return true;
      }
      toast.error(data.message || "Message was not sent");
      return false;
    } catch (error) {
      // Only queue text messages. Data URLs can be large and should not be persisted
      // as an unbounded offline payload in browser storage.
      if (typeof payload.text === "string" && payload.text.trim() && !payload.image && !error.response) {
        const localMessage = {
          _id: `pending:${clientMessageId}`, clientMessageId, senderId: ownerId,
          receiverId: recipient._id, text: payload.text.trim(), createdAt: new Date().toISOString(),
          pending: true, ...(payload.replyTo ? { replyTo: { messageId: payload.replyTo } } : {}),
        };
        try {
          await saveOutboxMessage({ ownerId: String(ownerId), recipientId: String(recipient._id), payload, createdAt: Date.now() });
          setMessages((prev) => prev.some((item) => item.clientMessageId === clientMessageId) ? prev : [...prev, localMessage]);
          setPendingMessageIds((prev) => prev.includes(clientMessageId) ? prev : [...prev, clientMessageId]);
          toast("Offline — message queued and will retry when connected", { icon: "◷" });
          return true;
        } catch (storageError) {
          console.warn("Could not queue offline message:", storageError);
        }
      }
      toast.error(error.response?.data?.message || "Message could not be sent. Please try again.");
      return false;
    }
  }, [axios, getUsers]);

  const flushOfflineOutbox = useCallback(async () => {
    const ownerId = authUserRef.current?._id;
    if (!ownerId || !socket?.connected || outboxFlushRef.current) return;
    outboxFlushRef.current = true;
    try {
      const queued = await listOutboxMessages(ownerId);
      for (const item of queued) {
        if (!socket?.connected) break;
        try {
          const { data } = await axios.post(`/api/messages/send/${item.recipientId}`, item.payload);
          if (!data.success || !data.newMessage) continue;
          if (String(selectedUserRef.current?._id) === String(item.recipientId)) {
            setMessages((prev) => prev.some((message) => String(message._id) === String(data.newMessage._id))
              ? prev.map((message) => message.clientMessageId === item.payload.clientMessageId ? data.newMessage : message)
              : [...prev.filter((message) => message.clientMessageId !== item.payload.clientMessageId), data.newMessage].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
          }
          await removeOutboxMessage(item.payload.clientMessageId);
          setPendingMessageIds((prev) => prev.filter((id) => id !== item.payload.clientMessageId));
        } catch {
          // Keep the item in IndexedDB; retry on the next reconnect.
          break;
        }
      }
      await getUsers();
    } catch (error) {
      // IndexedDB may be disabled by browser policy; normal online messaging still works.
      console.warn("Offline outbox is unavailable:", error);
    } finally {
      outboxFlushRef.current = false;
    }
  }, [axios, getUsers, socket]);

  useEffect(() => {
    if (!socket) return undefined;
    const onConnect = () => {
      setIsSocketConnected(true);
      getUsers();
      const activeId = selectedUserRef.current?._id;
      if (activeId) getMessages(activeId);
      flushOfflineOutbox();
    };
    const onDisconnect = () => setIsSocketConnected(false);
    setIsSocketConnected(Boolean(socket.connected));
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) flushOfflineOutbox();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket, getUsers, getMessages, flushOfflineOutbox, authUser?._id]);

  useEffect(() => {
    if (authUser?._id && socket?.connected) flushOfflineOutbox();
  }, [authUser?._id, socket, flushOfflineOutbox]);

  useEffect(() => {
    getUsers();
  }, [getUsers, authUser?._id]);

  // Open a conversation when following a shared message link.
  useEffect(() => {
    if (!authUser?._id || !users.length) return;
    const params = new URLSearchParams(window.location.search);
    const linkedChatId = params.get("chat");
    if (!linkedChatId) return;
    const targetUser = users.find((user) => String(user._id) === String(linkedChatId));
    if (targetUser) setSelectedUser((current) => current?._id === targetUser._id ? current : targetUser);
  }, [users, authUser?._id]);

  useEffect(() => {
    if (!selectedGroup?._id) { setGroupMessages([]); return; }
    setGroupMessages([]); getGroupMessages(selectedGroup._id);
  }, [selectedGroup?._id, getGroupMessages]);

  useEffect(() => {
    if (!selectedUser?._id) {
      setMessages([]);
      setHasMoreMessages(false);
      setIsLoadingOlder(false);
      return;
    }
    setMessages([]);
    setHasMoreMessages(false);
    setIsLoadingOlder(false);
    getMessages(selectedUser._id);
    getPinnedMessages(selectedUser._id);
  }, [selectedUser?._id, getMessages, getPinnedMessages]);

  useEffect(() => {
    if (!socket) return undefined;
    const groupTypingTimers = groupTypingTimersRef.current;
    const removeGroupTypingUser = (groupId, senderId) => {
      const normalizedGroupId = String(groupId || "");
      const normalizedSenderId = String(senderId || "");
      if (!normalizedGroupId || !normalizedSenderId) return;
      setGroupTypingUsers((prev) => {
        const groupTyping = { ...(prev[normalizedGroupId] || {}) };
        delete groupTyping[normalizedSenderId];
        const next = { ...prev };
        if (Object.keys(groupTyping).length) next[normalizedGroupId] = groupTyping;
        else delete next[normalizedGroupId];
        return next;
      });
    };
    const clearGroupTypingTimer = (groupId, senderId) => {
      const key = `${String(groupId || "")}:${String(senderId || "")}`;
      const timer = groupTypingTimersRef.current.get(key);
      if (timer) clearTimeout(timer);
      groupTypingTimersRef.current.delete(key);
    };
    const onGroupTypingStart = ({ groupId, senderId, senderName } = {}) => {
      const normalizedGroupId = String(groupId || "");
      const normalizedSenderId = String(senderId || "");
      if (!normalizedGroupId || !normalizedSenderId || normalizedSenderId === String(authUserRef.current?._id || "")) return;
      clearGroupTypingTimer(normalizedGroupId, normalizedSenderId);
      setGroupTypingUsers((prev) => ({
        ...prev,
        [normalizedGroupId]: {
          ...(prev[normalizedGroupId] || {}),
          [normalizedSenderId]: senderName || "A member",
        },
      }));
      const key = `${normalizedGroupId}:${normalizedSenderId}`;
      const timer = setTimeout(() => {
        groupTypingTimersRef.current.delete(key);
        removeGroupTypingUser(normalizedGroupId, normalizedSenderId);
      }, 2800);
      groupTypingTimersRef.current.set(key, timer);
    };
    const onGroupTypingStop = ({ groupId, senderId } = {}) => {
      clearGroupTypingTimer(groupId, senderId);
      removeGroupTypingUser(groupId, senderId);
    };
    const onGroupMessage = (message) => {
      if (String(selectedGroupRef.current?._id) === String(message.groupId)) {
        setGroupMessages((prev) => prev.some((item) => String(item._id) === String(message._id)) ? prev : [...prev, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        if (String(message.senderId?._id || message.senderId) !== String(authUserRef.current?._id)) markGroupRead(message.groupId);
      }
      getGroups();
    };
    const onGroupMessageUpdated = (message) => setGroupMessages((prev) => prev.map((item) => {
      if (String(item._id) === String(message._id)) return message;
      const replyId = String(item.replyTo?._id || item.replyTo || "");
      return replyId === String(message._id) ? { ...item, replyTo: message } : item;
    }));
    const onGroupUpdated = () => { getGroups(); socket.emit("sync-group-rooms"); };
    const onGroupRemoved = ({ groupId } = {}) => { setGroups((prev) => prev.filter((group) => String(group._id) !== String(groupId))); if (String(selectedGroupRef.current?._id) === String(groupId)) { setSelectedGroup(null); setGroupMessages([]); } socket.emit("sync-group-rooms"); };
    const onGroupRead = ({ groupId, userId, readAt } = {}) => { if (String(selectedGroupRef.current?._id) !== String(groupId)) return; setGroupMessages((prev) => prev.map((item) => { if (String(item.senderId?._id || item.senderId) !== String(authUserRef.current?._id)) return item; const readBy = Array.isArray(item.readBy) ? item.readBy : []; return readBy.some((read) => String(read.userId?._id || read.userId) === String(userId)) ? item : { ...item, readBy: [...readBy, { userId, readAt }] }; })); };
    const onNewMessage = (message) => {
      const currentUserId = authUserRef.current?._id;
      const activeUserId = selectedUserRef.current?._id;
      const otherId = String(message.senderId) === String(currentUserId) ? String(message.receiverId) : String(message.senderId);
      const isActiveConversation = Boolean(activeUserId && otherId === String(activeUserId));
      const isIncoming = String(message.receiverId) === String(currentUserId);
      if (isIncoming && message._id) socket.emit("message-delivered", { messageId: message._id });
      if (isActiveConversation) {
        setMessages((prev) => {
          if (prev.some((item) => String(item._id) === String(message._id))) return prev;
          if (message.clientMessageId && prev.some((item) => item.clientMessageId === message.clientMessageId)) {
            return prev.map((item) => item.clientMessageId === message.clientMessageId ? message : item);
          }
          return [...prev, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        });
        if (isIncoming) {
          setUnseenMessages((prev) => ({ ...prev, [activeUserId]: 0 }));
          axios.put(`/api/messages/mark/${message._id}`).then(getUsers).catch(() => {});
        } else {
          getUsers();
        }
      } else {
        if (isIncoming) setUnseenMessages((prev) => ({ ...prev, [otherId]: (prev[otherId] || 0) + 1 }));
        getUsers();
      }
    };
    const idOf = (value) => String(value?._id || value || "");
    const patchSidebarLastMessage = (predicate, patch) => {
      setUsers((prev) => prev.map((user) => {
        const lastMessage = user.lastMessage;
        if (!lastMessage || !predicate(lastMessage, user)) return user;
        return { ...user, lastMessage: { ...lastMessage, ...patch(lastMessage) } };
      }));
    };
    const onMessageDelivered = ({ messageId, deliveredAt }) => {
      const timestamp = deliveredAt || new Date().toISOString();
      setMessages((prev) => prev.map((item) => String(item._id) === String(messageId)
        ? { ...item, deliveredAt: item.deliveredAt || timestamp }
        : item));
      patchSidebarLastMessage((item) => String(item._id) === String(messageId), (item) => ({
        deliveredAt: item.deliveredAt || timestamp,
      }));
      // Refresh the server-backed latest-message record for conversations not currently open.
      getUsers();
    };
    const onMessageSeen = ({ messageId, seenAt, seenBy }) => {
      const timestamp = seenAt || new Date().toISOString();
      setMessages((prev) => prev.map((item) => String(item._id) === String(messageId)
        ? { ...item, seen: true, seenAt: item.seenAt || timestamp, deliveredAt: item.deliveredAt || timestamp }
        : item));
      patchSidebarLastMessage((item, user) => String(item._id) === String(messageId) || Boolean(
        seenBy && String(user._id) === String(seenBy) &&
        idOf(item.senderId) === String(authUserRef.current?._id) && idOf(item.receiverId) === String(seenBy)
      ), (item) => ({
        seen: true,
        seenAt: item.seenAt || timestamp,
        deliveredAt: item.deliveredAt || timestamp,
      }));
      getUsers();
    };
    const onMessageUpdated = (updated) => {
      setMessages((prev) => prev.map((m) => String(m._id) === String(updated._id) ? updated : m));
      setPinnedMessages((prev) => {
        const withoutMessage = prev.filter((m) => String(m._id) !== String(updated._id));
        return updated.pinnedAt && !updated.deletedForEveryone ? [updated, ...withoutMessage] : withoutMessage;
      });
      getUsers();
    };
    const onMessagesRead = ({ readerId, seenAt }) => {
      const timestamp = seenAt || new Date().toISOString();
      const me = String(authUserRef.current?._id || "");
      const reader = String(readerId || "");
      // Update loaded messages when this conversation is active.
      setMessages((prev) => prev.map((item) =>
        idOf(item.senderId) === me && idOf(item.receiverId) === reader
          ? { ...item, seen: true, seenAt: item.seenAt || timestamp, deliveredAt: item.deliveredAt || timestamp }
          : item
      ));
      // Also update the sidebar's latest message; it may not be the open conversation.
      patchSidebarLastMessage((item, user) => String(user._id) === reader &&
        idOf(item.senderId) === me && idOf(item.receiverId) === reader,
      (item) => ({ seen: true, seenAt: item.seenAt || timestamp, deliveredAt: item.deliveredAt || timestamp }));
      getUsers();
    };
    const onTypingStart = ({ senderId, senderName }) => setTypingUsers((prev) => ({ ...prev, [senderId]: senderName || true }));
    const onTypingStop = ({ senderId }) => setTypingUsers((prev) => { const next = { ...prev }; delete next[senderId]; return next; });
    const onPresenceChanged = ({ userId, isOnline, lastSeen }) => {
      if (!userId) return;
      const applyPresence = (user) => String(user?._id) === String(userId)
        ? { ...user, isOnline: Boolean(isOnline), ...(lastSeen ? { lastSeen } : isOnline ? { lastSeen: null } : {}) }
        : user;
      setUsers((prev) => prev.map(applyPresence));
      setSelectedUser((prev) => applyPresence(prev));
    };
    socket.on("group-message", onGroupMessage);
    socket.on("group-typing-start", onGroupTypingStart);
    socket.on("group-typing-stop", onGroupTypingStop);
    socket.on("group-message-updated", onGroupMessageUpdated);
    socket.on("group-updated", onGroupUpdated);
    socket.on("group-removed", onGroupRemoved);
    socket.on("group-read", onGroupRead);
    socket.on("newMessage", onNewMessage);
    socket.on("message-seen", onMessageSeen);
    socket.on("message-delivered", onMessageDelivered);
    socket.on("message-updated", onMessageUpdated);
    socket.on("messages-read", onMessagesRead);
    socket.on("typing-start", onTypingStart);
    socket.on("typing-stop", onTypingStop);
    socket.on("user-status-changed", onPresenceChanged);
    return () => {
      socket.off("group-message", onGroupMessage);
      socket.off("group-typing-start", onGroupTypingStart);
      socket.off("group-typing-stop", onGroupTypingStop);
      for (const timer of groupTypingTimers.values()) clearTimeout(timer);
      groupTypingTimers.clear();
      socket.off("group-message-updated", onGroupMessageUpdated);
      socket.off("group-updated", onGroupUpdated);
      socket.off("group-removed", onGroupRemoved);
      socket.off("group-read", onGroupRead);
      socket.off("newMessage", onNewMessage);
      socket.off("message-seen", onMessageSeen);
      socket.off("message-delivered", onMessageDelivered);
      socket.off("message-updated", onMessageUpdated);
      socket.off("messages-read", onMessagesRead);
      socket.off("typing-start", onTypingStart);
      socket.off("typing-stop", onTypingStop);
      socket.off("user-status-changed", onPresenceChanged);
    };
  }, [socket, axios, getUsers, getGroups, markGroupRead, setSelectedGroup]);

  return (
    <ChatContext.Provider value={{
      messages, pinnedMessages, hasMoreMessages, isLoadingOlder, loadOlderMessages, isSocketConnected, pendingMessageIds,
      users, selectedUser, setSelectedUser, unseenMessages, setUnseenMessages,
      groups, selectedGroup, setSelectedGroup, groupMessages, setGroupMessages, getGroups, openGroup, createGroup, getGroupMessages, sendGroupMessage, editGroupMessage, deleteGroupMessage, toggleGroupReaction, toggleGroupPinnedMessage, markGroupRead, addGroupMembers, removeGroupMember, forwardGroupMessage,
      setMessages, getUsers, sendMessage, getMessages, typingUsers, groupTypingUsers, updateMessage, deleteMessage, toggleReaction, forwardMessage, togglePinnedMessage,
    }}>
      {children}
    </ChatContext.Provider>
  );
};
