import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import assets from "../assets/assets";
import { formatLastSeen, formatMessageTime } from "../lib/utils";
import { ChatContext } from "../context/ChatContext";
import AuthContext from "../context/AuthContext";
import toast from "react-hot-toast";
import { Reply, Pin, Forward, Copy, Link2, Share2, Pencil, Trash2, Search, ChevronUp, ChevronDown, X, Smile, MoreHorizontal, Paperclip, Send } from "lucide-react";
import MediaLightbox from "./MediaLightbox";
import SearchableMessageText from "./SearchableMessageText";
import { buildDraftKey, readDraft, writeDraft } from "../lib/draftStorage";
import { flushConversationScrollPosition, readConversationScrollPosition, writeConversationScrollPosition } from "../lib/conversationScrollStorage";

function ChatContainer() {
  const {
    messages, selectedUser, setSelectedUser, sendMessage, typingUsers,
    hasMoreMessages, isLoadingOlder, loadOlderMessages, updateMessage, deleteMessage, toggleReaction, forwardMessage, togglePinnedMessage, pinnedMessages, users,
  } = useContext(ChatContext);

  const { authUser, onlineUsers, socket } = useContext(AuthContext);
  const draftStorageKey = buildDraftKey("direct", authUser?._id, selectedUser?._id);

  const scrollEnd = useRef();
  const fileInputRef = useRef();
  const hoverToolsTimerRef = useRef(null);
  const [message, setMessage] = useState(() => readDraft(draftStorageKey));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [forwardingMessageId, setForwardingMessageId] = useState(null);
  const [activeReactionPickerId, setActiveReactionPickerId] = useState(null);
  const [activeMessageToolsId, setActiveMessageToolsId] = useState(null);
  const [reactionPickerPosition, setReactionPickerPosition] = useState({ x: 8, y: 8, anchorX: 8, anchorY: 8, side: "right" });
  const reactionPickerRef = useRef(null);
  const [contextMenuMessageId, setContextMenuMessageId] = useState(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0, anchorX: 0, anchorY: 0, side: "right" });
  const contextMenuRef = useRef(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [pinnedBannerDismissed, setPinnedBannerDismissed] = useState(false);
  const [presenceClock, setPresenceClock] = useState(Date.now());
  const messagesContainerRef = useRef(null);
  const currentMessagesRef = useRef(messages);
  currentMessagesRef.current = messages;
  const typingTimeoutRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const pendingScrollRestoreRef = useRef(null);
  const pendingConversationRestoreRef = useRef(null);
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return messages.filter((item) => item?._id && !item.deletedForEveryone && String(item.text || "").toLocaleLowerCase().includes(query));
  }, [messages, searchQuery]);
  const searchMatchIdSet = useMemo(() => new Set(searchMatches.map((item) => String(item._id))), [searchMatches]);
  const activeSearchMessageId = searchMatches.length ? String(searchMatches[Math.min(searchIndex, searchMatches.length - 1)]?._id || "") : "";

  // Function to handle image loading errors
  const handleImageError = (e, fallbackSrc = assets.avatar_icon) => {
    e.target.src = fallbackSrc;
    e.target.onerror = null; // Prevent infinite loop
  };

  // Function to get correct image source
  const getImageSource = (imageUrl, fallback = assets.avatar_icon) => {
    if (!imageUrl) return fallback;

    // Check if it's a relative path or full URL
    if (imageUrl.startsWith("http") || imageUrl.startsWith("data:")) {
      return imageUrl;
    }

    // If it's a relative path, prepend the backend URL
    return `${import.meta.env.VITE_BACKEND_URL}${imageUrl}`;
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (message.trim() === "") return;
    const sent = await sendMessage({ text: message.trim(), ...(replyTarget?._id ? { replyTo: replyTarget._id } : {}) });
    if (sent) { setMessage(""); writeDraft(draftStorageKey, ""); setReplyTarget(null); }
    socket?.emit("typing-stop", { receiverId: selectedUser?._id });
  };

  const handleSendImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      e.target.value = "";
      return;
    }

    if (file.size > 2.5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 2.5 MB");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = async () => {
      const sent = await sendMessage({ image: reader.result });
      if (sent) e.target.value = "";
    };
    reader.readAsDataURL(file);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (hoverToolsTimerRef.current) clearTimeout(hoverToolsTimerRef.current);
  }, []);

  // Show the reaction affordance only after the pointer deliberately rests on a message.
  // The picker state keeps it visible while the pointer moves into the portalled emoji tray.
  const scheduleMessageTools = (messageId) => {
    if (hoverToolsTimerRef.current) clearTimeout(hoverToolsTimerRef.current);
    hoverToolsTimerRef.current = setTimeout(() => setActiveMessageToolsId(messageId), 320);
  };

  const hideMessageTools = (messageId) => {
    if (hoverToolsTimerRef.current) clearTimeout(hoverToolsTimerRef.current);
    hoverToolsTimerRef.current = null;
    setActiveMessageToolsId((current) => current === messageId && activeReactionPickerId !== messageId ? null : current);
  };

  useEffect(() => {
    const timer = setInterval(() => setPresenceClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useLayoutEffect(() => { setMessage(readDraft(draftStorageKey)); setReplyTarget(null); setEditingMessageId(null); setEditingText(""); setForwardingMessageId(null); setActiveReactionPickerId(null); setActiveMessageToolsId(null); setContextMenuMessageId(null); setConfirmAction(null); setPinnedBannerDismissed(false); setImageViewer(null); setSearchOpen(false); setSearchQuery(""); setSearchIndex(0); }, [draftStorageKey]);

  // When changing conversations, wait for the newly selected conversation's messages
  // to load, then restore its exact prior scroll position without smooth-scrolling.
  useLayoutEffect(() => {
    const userId = String(selectedUser?._id || "");
    if (!userId) {
      pendingConversationRestoreRef.current = null;
      return undefined;
    }
    const saved = readConversationScrollPosition(authUser?._id, "direct", userId);
    pendingScrollRestoreRef.current = null;
    pendingConversationRestoreRef.current = { userId, previousMessages: currentMessagesRef.current, saved };
    shouldAutoScrollRef.current = saved?.nearBottom ?? true;
    return () => flushConversationScrollPosition(authUser?._id, "direct", userId);
  }, [selectedUser?._id, authUser?._id]);

  useEffect(() => { if (searchOpen) searchInputRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim() || !searchMatches.length) return;
    setSearchIndex(0);
    const firstMatch = searchMatches[0];
    document.getElementById(`message-${firstMatch._id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchOpen, searchQuery, searchMatches]);

  useEffect(() => {
    if (!selectedUser) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
        setSearchIndex(0);
        return;
      }
      setSelectedUser(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedUser, setSelectedUser, searchOpen]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const activeUserId = String(selectedUser?._id || "");
    const conversationRestore = pendingConversationRestoreRef.current;

    if (conversationRestore && conversationRestore.userId === activeUserId) {
      // Ignore the previous conversation's list and the temporary empty state while
      // the newly selected conversation is being fetched.
      if (messages === conversationRestore.previousMessages || messages.length === 0) return;
      if (container) {
        container.scrollTop = conversationRestore.saved
          ? conversationRestore.saved.top
          : container.scrollHeight;
        const nearBottom = conversationRestore.saved?.nearBottom ?? true;
        shouldAutoScrollRef.current = nearBottom;
        writeConversationScrollPosition(authUser?._id, "direct", activeUserId, {
          top: container.scrollTop,
          nearBottom,
        });
      }
      pendingConversationRestoreRef.current = null;
      return;
    }

    const pending = pendingScrollRestoreRef.current;
    if (pending && container && messages.length > pending.previousCount) {
      container.scrollTop = container.scrollHeight - pending.previousHeight + pending.previousTop;
      pendingScrollRestoreRef.current = null;
      return;
    }
    // New messages follow the bottom only when the user was already near it.
    // Conversation restoration above is instant, avoiding the top-to-bottom animation.
    if (container && shouldAutoScrollRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [messages, selectedUser?._id, authUser?._id]);

  const handleLoadOlder = async () => {
    const container = messagesContainerRef.current;
    if (!container || isLoadingOlder) return;
    pendingScrollRestoreRef.current = {
      previousHeight: container.scrollHeight,
      previousTop: container.scrollTop,
      previousCount: messages.length,
    };
    const loaded = await loadOlderMessages();
    if (!loaded) pendingScrollRestoreRef.current = null;
  };


  useEffect(() => {
    const closeMenu = (event) => {
      if (event.type === "keydown" && event.key === "Escape") {
        setContextMenuMessageId(null);
        setActiveReactionPickerId(null);
        setActiveMessageToolsId(null);
        setConfirmAction(null);
      }
    };
    const closeContextOnOutsideClick = (event) => {
      const target = event.target;
      const insideMenu = target.closest?.(".nexus-message-context-menu");
      const insidePicker = target.closest?.(".nexus-reaction-picker-portal");
      const insideMessage = target.closest?.(".nexus-message-content");
      const insideOptionsControl = target.closest?.(".nexus-message-options-button");
      if (!insideMenu && !insideOptionsControl) setContextMenuMessageId(null);
      if (!insideMenu && !insidePicker && !insideMessage) {
        setActiveReactionPickerId(null);
        setActiveMessageToolsId(null);
      }
    };
    window.addEventListener("keydown", closeMenu);
    window.addEventListener("pointerdown", closeContextOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeMenu);
      window.removeEventListener("pointerdown", closeContextOnOutsideClick);
    };
  }, []);

  const showReactionPickerAt = (rect, messageId, isMine) => {
    const anchorX = isMine ? rect.right : rect.left;
    const anchorY = rect.top;
    setReactionPickerPosition({ x: anchorX, y: Math.max(8, anchorY - 56), anchorX, anchorY, side: isMine ? "left" : "right" });
    setActiveMessageToolsId(messageId);
    setActiveReactionPickerId(messageId);
    setContextMenuMessageId(null);
  };

  const openReactionPicker = (event, messageId, isMine) => {
    event.preventDefault?.();
    event.stopPropagation();
    if (activeReactionPickerId === messageId) {
      setActiveReactionPickerId(null);
      return;
    }
    showReactionPickerAt(event.currentTarget.getBoundingClientRect(), messageId, isMine);
  };

  useLayoutEffect(() => {
    const picker = reactionPickerRef.current;
    if (!activeReactionPickerId || !picker) return;
    const rect = picker.getBoundingClientRect();
    const pad = 8;
    const gap = 8;
    const { anchorX, anchorY, side } = reactionPickerPosition;
    const fitsLeft = anchorX - rect.width >= pad;
    const fitsRight = anchorX + rect.width <= window.innerWidth - pad;
    let resolvedSide = side;
    if (side === "left" && !fitsLeft && fitsRight) resolvedSide = "right";
    else if (side === "right" && !fitsRight && fitsLeft) resolvedSide = "left";
    const desiredX = resolvedSide === "left" ? anchorX - rect.width : anchorX;
    const x = Math.max(pad, Math.min(desiredX, window.innerWidth - rect.width - pad));
    const above = anchorY - rect.height - gap;
    const below = anchorY + gap;
    let desiredY = above >= pad ? above : below + rect.height <= window.innerHeight - pad ? below : above;
    const y = Math.max(pad, Math.min(desiredY, window.innerHeight - rect.height - pad));
    setReactionPickerPosition((current) => {
      if (Math.abs(current.x - x) < 0.5 && Math.abs(current.y - y) < 0.5 && current.side === resolvedSide) return current;
      return { ...current, x, y, side: resolvedSide };
    });
  }, [activeReactionPickerId, reactionPickerPosition]);

  const openMessageContextMenu = (event, messageId, isMine) => {
    event.preventDefault();
    event.stopPropagation();
    let x = event.clientX;
    let y = event.clientY;
    // Keyboard activation has no pointer coordinates; anchor the menu to its control.
    if (!x && !y && event.currentTarget?.getBoundingClientRect) {
      const rect = event.currentTarget.getBoundingClientRect();
      x = isMine ? rect.left : rect.right;
      y = rect.top + rect.height / 2;
    }
    setContextMenuPosition({ x, y, anchorX: x, anchorY: y, side: isMine ? "left" : "right" });
    setContextMenuMessageId(messageId);
    setActiveReactionPickerId(null);
    setActiveMessageToolsId(null);
  };

  // Measure the rendered menu and anchor its near edge to the actual pointer coordinates.
  // It stays in the viewport and flips only when the preferred side has no room.
  useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!contextMenuMessageId || !menu || !contextMenuPosition) return;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    const { anchorX, anchorY, side } = contextMenuPosition;
    const fitsLeft = anchorX - rect.width >= pad;
    const fitsRight = anchorX + rect.width <= window.innerWidth - pad;
    let resolvedSide = side;
    if (side === "left" && !fitsLeft && fitsRight) resolvedSide = "right";
    else if (side === "right" && !fitsRight && fitsLeft) resolvedSide = "left";
    const desiredX = resolvedSide === "left" ? anchorX - rect.width : anchorX;
    const x = Math.max(pad, Math.min(desiredX, window.innerWidth - rect.width - pad));
    let desiredY = anchorY;
    if (desiredY + rect.height > window.innerHeight - pad) desiredY = anchorY - rect.height;
    const y = Math.max(pad, Math.min(desiredY, window.innerHeight - rect.height - pad));
    setContextMenuPosition((current) => {
      if (Math.abs(current.x - x) < 0.5 && Math.abs(current.y - y) < 0.5 && current.side === resolvedSide) return current;
      return { ...current, x, y, side: resolvedSide };
    });
  }, [contextMenuMessageId, contextMenuPosition]);

  const navigateSearch = (direction) => {
    if (!searchMatches.length) return;
    const nextIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
    setSearchIndex(nextIndex);
    const target = document.getElementById(`message-${searchMatches[nextIndex]._id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const closeSearch = () => { setSearchOpen(false); setSearchQuery(""); setSearchIndex(0); };

  const isOnline = selectedUser && onlineUsers.includes(selectedUser._id);

  return selectedUser ? (
    <div className="nexus-chat h-full flex flex-col bg-gradient-to-b from-slate-900/40 to-slate-900/20">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-purple-500/10 bg-slate-900/40 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute -inset-1 bg-purple-600/20 rounded-full blur-sm"></div>
            <img
              src={getImageSource(selectedUser.profilePic)}
              alt={selectedUser.fullName}
              onError={(e) => handleImageError(e)}
              className="w-10 h-10 rounded-full border-2 border-purple-500/30 relative z-10"
            />
            {isOnline && (
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-slate-900 z-20"></div>
            )}
          </div>
          <div>
            <h2 className="text-white font-semibold text-md">
              {selectedUser.fullName}
            </h2>
            {typingUsers?.[selectedUser._id] ? (
              <p className="text-purple-300 text-xs">typing…</p>
            ) : isOnline ? (
              <p className="text-green-400 text-xs flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Online
              </p>
            ) : (
              <p className="text-slate-400 text-xs" title={selectedUser.lastSeen ? new Date(selectedUser.lastSeen).toLocaleString() : undefined}>
                {formatLastSeen(selectedUser.lastSeen, presenceClock)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setSearchOpen(true); setSearchIndex(0); }} aria-label="Search messages" title="Search messages" className="nexus-search-trigger flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"><Search size={16} /></button>
          <button type="button" disabled title="Calling is not implemented yet" className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center border border-white/5 opacity-50 cursor-not-allowed">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-purple-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button type="button" disabled title="Calling is not implemented yet" className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center border border-white/5 opacity-50 cursor-not-allowed">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-purple-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
          </button>
          <button type="button" onClick={() => setSelectedUser(null)} aria-label="Close conversation" title="Close conversation" className="nexus-close-conversation w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 flex items-center justify-center transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="nexus-conversation-search" role="search" aria-label="Search messages in this conversation">
          <Search size={16} aria-hidden="true" className="nexus-conversation-search__icon" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); setSearchIndex(0); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); navigateSearch(event.shiftKey ? -1 : 1); } }}
            placeholder="Search messages…"
            aria-label="Search loaded messages"
          />
          <span className="nexus-conversation-search__count">{searchQuery.trim() ? (searchMatches.length ? `${Math.min(searchIndex + 1, searchMatches.length)} of ${searchMatches.length}` : "No matches") : "Loaded messages"}</span>
          <button type="button" onClick={() => navigateSearch(-1)} disabled={!searchMatches.length} title="Previous match" aria-label="Previous match"><ChevronUp size={16} /></button>
          <button type="button" onClick={() => navigateSearch(1)} disabled={!searchMatches.length} title="Next match" aria-label="Next match"><ChevronDown size={16} /></button>
          <button type="button" onClick={closeSearch} title="Close search" aria-label="Close search"><X size={16} /></button>
        </div>
      )}

      {pinnedMessages.length > 0 && !pinnedBannerDismissed && (
        <div className="mx-4 mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-slate-900/80">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300" aria-hidden="true">⌁</span>
          <button type="button" onClick={() => { const target = document.getElementById(`message-${pinnedMessages[0]._id}`); target?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="min-w-0 flex-1 text-left">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">Pinned message{pinnedMessages.length > 1 ? ` · ${pinnedMessages.length}` : ""}</span>
            <span className="block truncate text-xs text-slate-700 dark:text-slate-200">{pinnedMessages[0].image ? "Photo" : pinnedMessages[0].text || "Message"}</span>
          </button>
          <button type="button" title="Hide pinned-message banner" aria-label="Dismiss pinned-message banner" onClick={() => setPinnedBannerDismissed(true)} className="nexus-banner-dismiss rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" ><svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>
        </div>
      )}

      {/* Chat Messages - Scrollable Area */}
      <div
        ref={messagesContainerRef}
        onScroll={() => {
          const el = messagesContainerRef.current;
          const userId = String(selectedUser?._id || "");
          if (!el || !userId) return;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          shouldAutoScrollRef.current = nearBottom;
          writeConversationScrollPosition(authUser?._id, "direct", userId, { top: el.scrollTop, nearBottom });
        }}
        onClick={(event) => { if (!event.target.closest(".nexus-message-row")) { setActiveReactionPickerId(null); setContextMenuMessageId(null); } }}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 space-y-3 bg-gradient-to-b from-slate-900/10 to-slate-900/5"
      >
        {hasMoreMessages && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={isLoadingOlder}
              className="rounded-full border border-white/10 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-purple-400/40 hover:bg-slate-700/80 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isLoadingOlder ? "Loading older messages…" : "Load older messages"}
            </button>
          </div>
        )}
        {messages.map((msg, index) => {
          const isMyMessage = String(msg.senderId?._id || msg.senderId) === String(authUser._id);
          const isSearchMatch = searchMatchIdSet.has(String(msg._id));
          const isCurrentSearchMatch = Boolean(searchQuery.trim()) && activeSearchMessageId === String(msg._id);

          return (
            <div
              id={msg._id ? `message-${msg._id}` : undefined}
              key={msg._id || msg.clientMessageId || `${msg.createdAt}-${index}`}
              className={`group nexus-message-row relative flex gap-2 ${
                isMyMessage ? "justify-end" : "justify-start"
              } ${isSearchMatch ? "nexus-search-match" : ""} ${isCurrentSearchMatch ? "nexus-search-match-current" : ""}`}
            >
              {/* Sender's avatar (only for received messages) */}
              {!isMyMessage && (
                <img
                  src={getImageSource(selectedUser.profilePic)}
                  alt={selectedUser.fullName}
                  onError={(e) => handleImageError(e)}
                  className="nexus-message-avatar w-7 h-7 rounded-full flex-shrink-0 border border-slate-700/50"
                />
              )}

              <div
                onMouseEnter={() => scheduleMessageTools(msg._id)}
                onMouseLeave={() => hideMessageTools(msg._id)}
                onFocusCapture={() => setActiveMessageToolsId(msg._id)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget) && activeReactionPickerId !== msg._id) {
                    setActiveMessageToolsId((current) => current === msg._id ? null : current);
                  }
                }}
                className={`nexus-message-content min-w-0 w-fit max-w-[75%] ${
                  isMyMessage ? "flex flex-col items-end" : "flex flex-col items-start"
                } ${msg.replyTo && !msg.deletedForEveryone ? "has-reply-preview" : ""} ${activeMessageToolsId === msg._id ? "is-tools-active" : ""} ${activeReactionPickerId === msg._id ? "is-picker-open" : ""}`}
              >
                {msg.forwardedFrom && !msg.deletedForEveryone && (
                  <div className="mb-1 flex items-center gap-1 px-2 text-[11px] italic text-slate-400" title={`Originally from ${msg.forwardedFrom.senderName || "another user"}`}>
                    <span aria-hidden="true">↗</span> Forwarded from {msg.forwardedFrom.senderName || "another user"}
                  </div>
                )}
                {msg.replyTo && !msg.deletedForEveryone && (
                  <button type="button" onClick={() => {
                    const target = document.getElementById(`message-${msg.replyTo.messageId}`);
                    target?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }} className="nexus-reply-preview mb-1 block max-w-full rounded-md border-l-2 border-blue-500 bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-600 hover:bg-slate-50">
                    <span className="block font-semibold text-blue-700">Replying to {String(msg.replyTo.senderId) === String(authUser._id) ? "yourself" : selectedUser.fullName}</span>
                    <span className="block max-w-[220px] truncate">{msg.replyTo.image ? "Photo" : msg.replyTo.text || "Message"}</span>
                  </button>
                )}
                {editingMessageId === msg._id ? (
                  <div className="nexus-edit-inline min-w-[220px] rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                    <textarea autoFocus rows={2} maxLength={10000} value={editingText} onChange={(e) => setEditingText(e.target.value)} className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500" />
                    <div className="mt-2 flex justify-end gap-2 text-xs">
                      <button type="button" onClick={() => { setEditingMessageId(null); setEditingText(""); }} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100">Cancel</button>
                      <button type="button" onClick={async () => { const ok = await updateMessage(msg._id, editingText); if (ok) { setEditingMessageId(null); setEditingText(""); } }} disabled={!editingText.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">Save</button>
                    </div>
                  </div>
                ) : msg.deletedForEveryone ? (
                  <div className="rounded-2xl bg-slate-800/70 px-3 py-2 text-sm italic text-slate-400">This message was deleted</div>
                ) : (
                  <div onClick={() => { setActiveMessageToolsId(msg._id); setActiveReactionPickerId(null); }} onContextMenu={(event) => openMessageContextMenu(event, msg._id, isMyMessage)} className={`nexus-message-bubble rounded-2xl px-3 py-2 relative z-10 ${isMyMessage ? "nexus-own-message bg-gradient-to-r from-purple-600 to-pink-600 text-white" : "nexus-incoming-message bg-slate-800/80 text-white"}`}>
                    {msg.image && <button type="button" className="nexus-media-thumb nexus-shared-image-frame mb-2" onClick={(event) => { event.stopPropagation(); setImageViewer({ src: getImageSource(msg.image), alt: "Shared image", fileName: `nexuschat-${msg._id || "image"}` }); }} aria-label="Open shared image" title="View image"><img src={getImageSource(msg.image)} alt="Shared image" loading="lazy" decoding="async" draggable="false" onError={(e) => handleImageError(e, assets.avatar_icon)} className="nexus-shared-message-image" /></button>}
                    {msg.text && <p className="whitespace-pre-wrap break-words text-sm"><SearchableMessageText text={msg.text} query={searchQuery} /></p>}
                    <div className={`mt-1 flex items-center justify-end gap-0.5 text-[10px] leading-none ${isMyMessage ? "text-white/80" : "text-slate-500"}`}>
                      {msg.pinnedAt && <span title="Pinned message" aria-label="Pinned message">📌</span>}
                      {msg.editedAt && !msg.deletedForEveryone && <span className="italic">edited</span>}
                      <span>{formatMessageTime(msg.createdAt)}</span>
                      {isMyMessage && (msg.seen ? <span className="nexus-read-ticks font-semibold text-sky-200" title={msg.seenAt ? `Read ${new Date(msg.seenAt).toLocaleString()}` : "Read"} aria-label="Read">✓✓</span> : <span className="nexus-sent-tick font-semibold" title={msg.deliveredAt ? "Delivered, not read" : "Sent, not read"} aria-label="Not read">✓</span>)}
                    </div>
                  </div>
                )}
                {!msg.deletedForEveryone && (msg.reactions || []).length > 0 && (
                  <div className={`mt-1 flex flex-wrap gap-1 ${isMyMessage ? "justify-end" : "justify-start"}`} aria-label="Message reactions">
                    {Object.entries((msg.reactions || []).reduce((counts, reaction) => {
                      counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
                      return counts;
                    }, {})).map(([emoji, count]) => {
                      const reacted = (msg.reactions || []).some((reaction) => String(reaction.userId?._id || reaction.userId) === String(authUser._id) && reaction.emoji === emoji);
                      return <button key={emoji} type="button" onClick={() => toggleReaction(msg._id, emoji)} aria-label={`${emoji} reaction, ${count} total`} aria-pressed={reacted} className={`rounded-full border px-2 py-0.5 text-xs transition ${reacted ? "border-purple-400/70 bg-purple-500/20 text-white" : "border-white/10 bg-slate-800/80 text-slate-200 hover:border-purple-400/50"}`}>{emoji} {count}</button>;
                    })}
                  </div>
                )}
                {!msg.deletedForEveryone && editingMessageId !== msg._id && (
                  <>
                  <div className={`nexus-message-hover-tools ${isMyMessage ? "is-own-tools" : "is-incoming-tools"}`}>
                    <div className={`nexus-reaction-anchor ${isMyMessage ? "is-own-reaction-anchor" : "is-incoming-reaction-anchor"}`}>
                      <button type="button" title="Add reaction" aria-label="Add reaction" aria-expanded={activeReactionPickerId === msg._id} onClick={(event) => openReactionPicker(event, msg._id, isMyMessage)} className="nexus-hover-reaction nexus-message-tool-button"><Smile size={15} aria-hidden="true" /></button>
                    </div>
                    <button type="button" title="Message options" aria-label="Message options" aria-haspopup="menu" aria-expanded={contextMenuMessageId === msg._id} onClick={(event) => { if (contextMenuMessageId === msg._id) { event.preventDefault(); event.stopPropagation(); setContextMenuMessageId(null); return; } openMessageContextMenu(event, msg._id, isMyMessage); }} className="nexus-message-tool-button nexus-message-options-button"><MoreHorizontal size={16} aria-hidden="true" /></button>
                  </div>
                  {activeReactionPickerId === msg._id && createPortal(
                    <div ref={reactionPickerRef} className="nexus-reaction-picker nexus-reaction-picker-portal" role="group" aria-label="Choose a reaction" style={{ left: `${reactionPickerPosition.x}px`, top: `${reactionPickerPosition.y}px` }} onPointerDown={(event) => event.stopPropagation()}>
                      {["👍","❤️","😂","😮","😢","🔥"].map((emoji) => <button key={emoji} type="button" title={`React with ${emoji}`} onClick={(event) => { event.stopPropagation(); toggleReaction(msg._id, emoji); setActiveReactionPickerId(null); setActiveMessageToolsId(null); }} className="nexus-reaction-option" aria-label={`React with ${emoji}`}>{emoji}</button>)}
                    </div>, document.body
                  )}
                  </>
                )}
                {contextMenuMessageId === msg._id && !msg.deletedForEveryone && createPortal(
                  <div ref={contextMenuRef} className="nexus-message-context-menu" data-side={contextMenuPosition.side} role="menu" style={{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
                    <button role="menuitem" type="button" className="nexus-menu-item--reply" onClick={() => { setReplyTarget(msg); setEditingMessageId(null); setForwardingMessageId(null); setContextMenuMessageId(null); }}><Reply size={16} aria-hidden="true" /><span>Reply</span></button>
                    <button role="menuitem" type="button" className="nexus-menu-item--reaction" onClick={() => { const bubble = document.getElementById(`message-${msg._id}`)?.querySelector(".nexus-message-bubble"); const rect = bubble?.getBoundingClientRect(); if (rect) showReactionPickerAt(rect, msg._id, isMyMessage); else { setActiveMessageToolsId(msg._id); setActiveReactionPickerId(msg._id); setContextMenuMessageId(null); } }}><Smile size={16} aria-hidden="true" /><span>Add reaction</span></button>
                    <button role="menuitem" type="button" className={`nexus-menu-item--pin ${msg.pinnedAt ? "is-pinned" : ""}`} onClick={() => { setConfirmAction({ type: "pin", message: msg }); setContextMenuMessageId(null); }}><Pin size={16} aria-hidden="true" /><span>{msg.pinnedAt ? "Unpin message" : "Pin message"}</span></button>
                    <button role="menuitem" type="button" className="nexus-menu-item--forward" onClick={() => { setForwardingMessageId(msg._id); setContextMenuMessageId(null); }}><Forward size={16} aria-hidden="true" /><span>Forward</span></button>
                    <div className="nexus-menu-divider" aria-hidden="true" />
                    <button role="menuitem" type="button" className="nexus-menu-item--copy" onClick={async () => { const text = msg.text || (msg.image ? getImageSource(msg.image) : ""); try { await navigator.clipboard.writeText(text); toast.success("Message copied"); } catch { toast.error("Clipboard access is unavailable"); } setContextMenuMessageId(null); }}><Copy size={16} aria-hidden="true" /><span>Copy message</span></button>
                    <button role="menuitem" type="button" className="nexus-menu-item--link" onClick={async () => { const url = new URL(window.location.href); url.searchParams.set("chat", selectedUser._id); if (msg._id) url.searchParams.set("message", msg._id); try { await navigator.clipboard.writeText(url.toString()); toast.success("Message link copied"); } catch { toast.error("Clipboard access is unavailable"); } setContextMenuMessageId(null); }}><Link2 size={16} aria-hidden="true" /><span>Copy link</span></button>
                    <button role="menuitem" type="button" className="nexus-menu-item--share" onClick={async () => { const url = new URL(window.location.href); url.searchParams.set("chat", selectedUser._id); if (msg._id) url.searchParams.set("message", msg._id); if (navigator.share) { try { await navigator.share({ title: "NexusChat message", text: msg.text || "Shared message", url: url.toString() }); } catch { /* The user may cancel the native share sheet. */ } } else { try { await navigator.clipboard.writeText(url.toString()); toast.success("Share link copied"); } catch { toast.error("Sharing is unavailable"); } } setContextMenuMessageId(null); }}><Share2 size={16} aria-hidden="true" /><span>Share</span></button>
                    {isMyMessage && msg.text && <>
                      <div className="nexus-menu-divider" aria-hidden="true" />
                      <button role="menuitem" type="button" className="nexus-menu-item--edit" onClick={() => { setEditingMessageId(msg._id); setEditingText(msg.text); setReplyTarget(null); setConfirmAction(null); setContextMenuMessageId(null); }}><Pencil size={16} aria-hidden="true" /><span>Edit message</span></button>
                    </>}
                    {isMyMessage && <>
                      <div className="nexus-menu-divider" aria-hidden="true" />
                      <button role="menuitem" type="button" className="danger nexus-menu-item--danger" onClick={() => { setConfirmAction({ type: "delete", message: msg }); setContextMenuMessageId(null); }}><Trash2 size={16} aria-hidden="true" /><span>Delete message</span></button>
                    </>}
                  </div>, document.body
                )}
                {forwardingMessageId === msg._id && !msg.deletedForEveryone && (
                  <div className={`mt-2 w-64 max-w-full rounded-xl border border-white/10 bg-slate-900 p-2 shadow-xl ${isMyMessage ? "ml-auto" : ""}`}>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-xs font-semibold text-slate-200">Forward to…</span>
                      <button type="button" onClick={() => setForwardingMessageId(null)} aria-label="Close forward menu" className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">×</button>
                    </div>
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                      {users.filter((user) => String(user._id) !== String(authUser._id)).map((user) => (
                        <button key={user._id} type="button" onClick={async () => { const ok = await forwardMessage(msg._id, user._id); if (ok) { toast.success(`Forwarded to ${user.fullName}`); setForwardingMessageId(null); } }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400">
                          <img src={getImageSource(user.profilePic)} alt="" onError={(e) => handleImageError(e)} className="h-7 w-7 rounded-full object-cover" />
                          <span className="min-w-0 flex-1 truncate">{user.fullName}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* My avatar (only for sent messages, aligned to right) */}
              {isMyMessage && (
                <img
                  src={getImageSource(authUser.profilePic)}
                  alt="You"
                  onError={(e) => handleImageError(e)}
                  className="nexus-message-avatar w-7 h-7 rounded-full flex-shrink-0 border border-slate-700/50"
                />
              )}
            </div>
          );
        })}
        <div ref={scrollEnd}></div>
      </div>

      {/* Direct-message composer — only the attachment/send controls share group styling. */}
      <div className="p-4 bg-slate-900/40 border-t border-purple-500/10 flex-shrink-0">
        {replyTarget && <div className="nexus-reply-composer mb-3 flex items-center justify-between gap-3 rounded-lg border-l-2 border-blue-500 bg-white px-2.5 py-1.5">
          <div className="min-w-0"><p className="text-[11px] font-semibold text-blue-700">Replying to {String(replyTarget.senderId) === String(authUser._id) ? "yourself" : selectedUser.fullName}</p><p className="truncate text-[11px] text-slate-600">{replyTarget.image ? "Photo" : replyTarget.text || "Message"}</p></div>
          <button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply" title="Cancel reply" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={16} aria-hidden="true" /></button>
        </div>}
        <form onSubmit={handleSendMessage} className="nexus-group-composer__row nexus-direct-composer-row">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="nexus-group-composer__attach" title="Attach image" aria-label="Attach image"><Paperclip size={18} aria-hidden="true" /></button>
          <input type="file" ref={fileInputRef} onChange={handleSendImage} accept="image/*" className="hidden" aria-label="Choose an image to send" />
          <div className="flex-1 relative">
            <textarea
              rows={1}
              value={message}
              onChange={(e) => {
                const nextMessage = e.target.value;
                setMessage(nextMessage);
                writeDraft(draftStorageKey, nextMessage);
                if (selectedUser && socket) {
                  socket.emit(nextMessage.trim() ? "typing-start" : "typing-stop", { receiverId: selectedUser._id });
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                  typingTimeoutRef.current = setTimeout(() => socket.emit("typing-stop", { receiverId: selectedUser._id }), 1200);
                }
              }}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              className="w-full max-h-32 resize-none overflow-y-auto bg-slate-800/50 border border-slate-700/50 rounded-xl py-2 px-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all duration-300 text-sm"
            />
          </div>
          <button type="submit" disabled={!message.trim()} className="nexus-group-composer__send" aria-label="Send message" title="Send message"><Send size={18} aria-hidden="true" /></button>
        </form>
      </div>
      {confirmAction && (
        <div className="nexus-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setConfirmAction(null); setEditingMessageId(null); } }}>
          <section className="nexus-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="nexus-confirm-title">
            {confirmAction.type === "edit" ? <>
              <div className="nexus-modal-icon">✎</div><h3 id="nexus-confirm-title">Edit message</h3>
              <textarea autoFocus rows={4} maxLength={10000} value={editingText} onChange={(event) => setEditingText(event.target.value)} className="nexus-edit-modal-input" />
              <div className="nexus-modal-actions"><button type="button" onClick={() => { setConfirmAction(null); setEditingMessageId(null); setEditingText(""); }}>Cancel</button><button type="button" className="primary" disabled={!editingText.trim()} onClick={async () => { const action = confirmAction; const ok = await updateMessage(action.message._id, editingText); if (ok) { setConfirmAction(null); setEditingMessageId(null); setEditingText(""); } }}>Save changes</button></div>
            </> : <>
              <div className="nexus-modal-icon">{confirmAction.type === "delete" ? "⌫" : confirmAction.message.pinnedAt ? "×" : "⌁"}</div>
              <h3 id="nexus-confirm-title">{confirmAction.type === "delete" ? "Delete this message?" : confirmAction.message.pinnedAt ? "Unpin this message?" : "Pin this message?"}</h3>
              <p>{confirmAction.type === "delete" ? "This message will be removed for everyone. This action cannot be undone." : confirmAction.message.pinnedAt ? "The message will no longer appear in the pinned-message banner." : "This message will be highlighted at the top of the conversation."}</p>
              <div className="nexus-modal-actions"><button type="button" onClick={() => setConfirmAction(null)}>Cancel</button><button type="button" className={confirmAction.type === "delete" ? "danger" : "primary"} onClick={async () => { const action = confirmAction; setConfirmAction(null); if (action.type === "delete") await deleteMessage(action.message._id); else await togglePinnedMessage(action.message._id); }}>{confirmAction.type === "delete" ? "Delete message" : confirmAction.message.pinnedAt ? "Unpin message" : "Pin message"}</button></div>
            </>}
          </section>
        </div>
      )}
      <MediaLightbox image={imageViewer} onClose={() => setImageViewer(null)} />
    </div>
  ) : (
    <div className="nexus-empty flex flex-col items-center justify-center gap-4 text-center p-6 bg-gradient-to-br from-purple-900/10 to-pink-900/10 h-full">
      <div className="relative">
        <div className="absolute -inset-6 bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-3xl blur-xl animate-pulse"></div>
        <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl flex items-center justify-center shadow-2xl relative z-10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-white"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>
      <div>
        <h2 className="text-xl font-bold text-white mb-2">
          Welcome to NexusChat
        </h2>
        <p className="text-slate-300 text-sm">
          Select a conversation to start messaging
        </p>
      </div>
      <div className="w-24 h-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full mt-2"></div>
    </div>
  );
}

export default ChatContainer;
