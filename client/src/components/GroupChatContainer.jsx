import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Send, Users, MoreHorizontal, Pin, Smile, X, UserMinus, LogOut, ShieldCheck, Paperclip, Pencil, Trash2, Search, ChevronUp, ChevronDown, Reply, Forward } from "lucide-react";
import { ChatContext } from "../context/ChatContext";
import AuthContext from "../context/AuthContext";
import { formatMessageTime } from "../lib/utils";
import toast from "react-hot-toast";
import MediaLightbox from "./MediaLightbox";
import SearchableMessageText from "./SearchableMessageText";
import { buildDraftKey, readDraft, writeDraft } from "../lib/draftStorage";
import { flushConversationScrollPosition, readConversationScrollPosition, writeConversationScrollPosition } from "../lib/conversationScrollStorage";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

const getLocalDayKey = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatMessageDayDivider = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = Math.round((today.getTime() - messageDay.getTime()) / 86400000);
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
};

export default function GroupChatContainer() {
  const { selectedGroup, setSelectedGroup, groupMessages, sendGroupMessage, editGroupMessage, deleteGroupMessage, toggleGroupReaction, toggleGroupPinnedMessage, addGroupMembers, removeGroupMember, users, groupTypingUsers, groups, forwardGroupMessage } = useContext(ChatContext);
  const { authUser, socket } = useContext(AuthContext);
  const draftStorageKey = buildDraftKey("group", authUser?._id, selectedGroup?._id);
  const [draft, setDraft] = useState(() => readDraft(draftStorageKey));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [imageData, setImageData] = useState("");
  const [imageName, setImageName] = useState("");
  const fileInputRef = useRef(null);
  const draftTextareaRef = useRef(null);
  const groupMessagesContainerRef = useRef(null);
  const groupTypingTimeoutRef = useRef(null);
  const typingGroupIdRef = useRef(null);
  const lastGroupIdRef = useRef(null);
  const pendingGroupScrollRestoreRef = useRef(null);
  const previousGroupMessagesRef = useRef(groupMessages);
  const shouldFollowGroupBottomRef = useRef(true);
  const hoverToolsTimerRef = useRef(null);
  const [sending, setSending] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [newMessagesWhileAway, setNewMessagesWhileAway] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [editingSaving, setEditingSaving] = useState(false);
  const editTextareaRef = useRef(null);
  const [groupAction, setGroupAction] = useState(null);
  const [groupActionBusy, setGroupActionBusy] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [forwardingMessageId, setForwardingMessageId] = useState(null);
  const [activeReactionId, setActiveReactionId] = useState(null);
  const [activeToolsId, setActiveToolsId] = useState(null);
  const [readReceiptsMessageId, setReadReceiptsMessageId] = useState(null);
  const [groupReactionPosition, setGroupReactionPosition] = useState({ x: 8, y: 8, anchorX: 8, anchorY: 8, side: "right" });
  const groupReactionPickerRef = useRef(null);
  const [menuMessageId, setMenuMessageId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ x: 8, y: 8, anchorX: 8, anchorY: 8, side: "right" });
  const groupMenuRef = useRef(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [addMemberSearchQuery, setAddMemberSearchQuery] = useState("");
  const [addingMembers, setAddingMembers] = useState(false);
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return groupMessages.filter((item) => item?._id && !item.deletedForEveryone && String(item.text || "").toLocaleLowerCase().includes(query));
  }, [groupMessages, searchQuery]);
  const searchMatchIdSet = useMemo(() => new Set(searchMatches.map((item) => String(item._id))), [searchMatches]);
  const activeSearchMessageId = searchMatches.length ? String(searchMatches[Math.min(searchIndex, searchMatches.length - 1)]?._id || "") : "";
  const ownId = String(authUser?._id || "");
  const currentGroupId = String(selectedGroup?._id || "");
  const groupTypingNames = Object.entries(groupTypingUsers?.[currentGroupId] || {})
    .filter(([senderId]) => String(senderId) !== ownId)
    .map(([, senderName]) => String(senderName || "A member"));
  const groupTypingLabel = groupTypingNames.length === 1
    ? `${groupTypingNames[0]} is typing…`
    : groupTypingNames.length === 2
      ? `${groupTypingNames[0]} and ${groupTypingNames[1]} are typing…`
      : groupTypingNames.length > 2
        ? `${groupTypingNames[0]} and ${groupTypingNames.length - 1} others are typing…`
        : "";
  const stopGroupTyping = useCallback((expectedGroupId) => {
    const activeGroupId = String(typingGroupIdRef.current || "");
    if (!activeGroupId || (expectedGroupId && activeGroupId !== String(expectedGroupId))) return;
    if (groupTypingTimeoutRef.current) {
      clearTimeout(groupTypingTimeoutRef.current);
      groupTypingTimeoutRef.current = null;
    }
    socket?.emit("group-typing-stop", { groupId: activeGroupId });
    typingGroupIdRef.current = null;
  }, [socket]);
  const handleGroupDraftChange = (event) => {
    const nextDraft = event.target.value;
    setDraft(nextDraft);
    writeDraft(draftStorageKey, nextDraft);
    const groupId = String(selectedGroup?._id || "");
    if (!socket || !groupId) return;
    if (!nextDraft.trim()) {
      stopGroupTyping(groupId);
      return;
    }
    if (typingGroupIdRef.current !== groupId) {
      stopGroupTyping();
      typingGroupIdRef.current = groupId;
      socket.emit("group-typing-start", { groupId });
    }
    if (groupTypingTimeoutRef.current) clearTimeout(groupTypingTimeoutRef.current);
    groupTypingTimeoutRef.current = setTimeout(() => stopGroupTyping(groupId), 1400);
  };
  const isAdmin = Boolean(selectedGroup?.admins?.some((id) => String(id?._id || id) === ownId));
  const pinnedMessage = useMemo(() => {
    const pinId = selectedGroup?.pinnedMessageId?._id || selectedGroup?.pinnedMessageId;
    return groupMessages.find((item) => String(item._id) === String(pinId)) || (selectedGroup?.pinnedMessageId && typeof selectedGroup.pinnedMessageId === "object" ? selectedGroup.pinnedMessageId : null);
  }, [groupMessages, selectedGroup?.pinnedMessageId]);

  useLayoutEffect(() => {
    const container = groupMessagesContainerRef.current;
    const groupId = String(selectedGroup?._id || "");
    if (!groupId) {
      lastGroupIdRef.current = null;
      pendingGroupScrollRestoreRef.current = null;
      previousGroupMessagesRef.current = groupMessages;
      return;
    }

    if (lastGroupIdRef.current !== groupId) {
      const saved = readConversationScrollPosition(authUser?._id, "group", groupId);
      lastGroupIdRef.current = groupId;
      pendingGroupScrollRestoreRef.current = { groupId, previousMessages: groupMessages, saved };
      shouldFollowGroupBottomRef.current = saved?.nearBottom ?? true;
      setShowJumpToLatest(!(saved?.nearBottom ?? true));
      setNewMessagesWhileAway(0);
      previousGroupMessagesRef.current = groupMessages;
      return;
    }

    const pendingRestore = pendingGroupScrollRestoreRef.current;
    if (pendingRestore?.groupId === groupId && groupMessages !== pendingRestore.previousMessages) {
      if (container) {
        container.scrollTop = pendingRestore.saved ? pendingRestore.saved.top : container.scrollHeight;
        shouldFollowGroupBottomRef.current = pendingRestore.saved?.nearBottom ?? true;
        writeConversationScrollPosition(authUser?._id, "group", groupId, {
          top: container.scrollTop,
          nearBottom: shouldFollowGroupBottomRef.current,
        });
      }
      pendingGroupScrollRestoreRef.current = null;
      previousGroupMessagesRef.current = groupMessages;
      return;
    }

    const previousMessages = previousGroupMessagesRef.current;
    if (previousMessages !== groupMessages) {
      const newMessagesArrived = groupMessages.length > previousMessages.length;
      if (container && newMessagesArrived && shouldFollowGroupBottomRef.current) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        setNewMessagesWhileAway(0);
        setShowJumpToLatest(false);
      } else if (newMessagesArrived && !shouldFollowGroupBottomRef.current) {
        setNewMessagesWhileAway((count) => count + (groupMessages.length - previousMessages.length));
        setShowJumpToLatest(true);
      }
      previousGroupMessagesRef.current = groupMessages;
    }
  }, [selectedGroup?._id, groupMessages, authUser?._id]);

  useLayoutEffect(() => { setDraft(readDraft(draftStorageKey)); setImageViewer(null); setSearchOpen(false); setSearchQuery(""); setSearchIndex(0); }, [draftStorageKey]);
  useEffect(() => {
    setReplyTarget(null);
    setMenuMessageId(null);
    setActiveReactionId(null);
    setForwardingMessageId(null);
    setReadReceiptsMessageId(null);
    setMemberSearchQuery("");
    setAddMemberSearchQuery("");
    setEditingMessageId(null);
    setEditingText("");
    setGroupAction(null);
  }, [selectedGroup?._id]);

  useEffect(() => {
    if (editingMessageId) editTextareaRef.current?.focus();
  }, [editingMessageId]);
  useLayoutEffect(() => {
    const textarea = draftTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "40px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [draft, selectedGroup?._id]);
  useEffect(() => () => {
    flushConversationScrollPosition(authUser?._id, "group", selectedGroup?._id);
    stopGroupTyping();
  }, [authUser?._id, selectedGroup?._id, stopGroupTyping]);
  useEffect(() => { if (searchOpen) searchInputRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim() || !searchMatches.length) return;
    setSearchIndex(0);
    const firstMatch = searchMatches[0];
    document.getElementById(`group-message-${firstMatch._id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchOpen, searchQuery, searchMatches]);
  useEffect(() => {
    const close = (event) => {
      if (event.key !== "Escape") return;
      if (searchOpen) { setSearchOpen(false); setSearchQuery(""); setSearchIndex(0); return; }
      setDetailsOpen(false); setActiveReactionId(null); setActiveToolsId(null); setMenuMessageId(null); setReadReceiptsMessageId(null); setGroupAction(null);
      setEditingMessageId(null); setEditingText("");
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [searchOpen]);
  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      const target = event.target;
      const insideContent = target.closest?.(".group-message-content");
      const insideMenu = target.closest?.(".group-message-context-menu");
      const insidePicker = target.closest?.(".group-message-reaction-picker-portal");
      const insideForwardPicker = target.closest?.(".nexus-group-forward-picker");
      const insideReadReceipts = target.closest?.(".nexus-group-read-receipts");
      const insideReadTrigger = target.closest?.(".nexus-group-read-receipt-trigger");
      if (!insideContent && !insideMenu && !insidePicker && !insideForwardPicker && !insideReadReceipts && !insideReadTrigger) {
        setActiveReactionId(null);
        setActiveToolsId(null);
      }
      if (!insideMenu) setMenuMessageId(null);
      if (!insideForwardPicker) setForwardingMessageId(null);
      if (!insideReadReceipts && !insideReadTrigger) setReadReceiptsMessageId(null);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  useEffect(() => () => { if (hoverToolsTimerRef.current) clearTimeout(hoverToolsTimerRef.current); }, []);

  const scheduleGroupMessageTools = (messageId) => {
    if (hoverToolsTimerRef.current) clearTimeout(hoverToolsTimerRef.current);
    hoverToolsTimerRef.current = setTimeout(() => setActiveToolsId(messageId), 320);
  };

  const hideGroupMessageTools = (messageId) => {
    if (hoverToolsTimerRef.current) clearTimeout(hoverToolsTimerRef.current);
    hoverToolsTimerRef.current = null;
    setActiveToolsId((current) => current === messageId && activeReactionId !== messageId ? null : current);
  };

  useLayoutEffect(() => {
    const menu = groupMenuRef.current;
    if (!menuMessageId || !menu) return;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    const { anchorX, anchorY, side } = menuPosition;
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
    setMenuPosition((current) => {
      if (Math.abs(current.x - x) < 0.5 && Math.abs(current.y - y) < 0.5 && current.side === resolvedSide) return current;
      return { ...current, x, y, side: resolvedSide };
    });
  }, [menuMessageId, menuPosition]);

  useLayoutEffect(() => {
    const picker = groupReactionPickerRef.current;
    if (!activeReactionId || !picker) return;
    const rect = picker.getBoundingClientRect();
    const pad = 8;
    const gap = 8;
    const { anchorX, anchorY, side } = groupReactionPosition;
    const fitsLeft = anchorX - rect.width >= pad;
    const fitsRight = anchorX + rect.width <= window.innerWidth - pad;
    let resolvedSide = side;
    if (side === "left" && !fitsLeft && fitsRight) resolvedSide = "right";
    else if (side === "right" && !fitsRight && fitsLeft) resolvedSide = "left";
    const desiredX = resolvedSide === "left" ? anchorX - rect.width : anchorX;
    const x = Math.max(pad, Math.min(desiredX, window.innerWidth - rect.width - pad));
    const above = anchorY - rect.height - gap;
    const below = anchorY + gap;
    const desiredY = above >= pad ? above : below + rect.height <= window.innerHeight - pad ? below : above;
    const y = Math.max(pad, Math.min(desiredY, window.innerHeight - rect.height - pad));
    setGroupReactionPosition((current) => {
      if (Math.abs(current.x - x) < 0.5 && Math.abs(current.y - y) < 0.5 && current.side === resolvedSide) return current;
      return { ...current, x, y, side: resolvedSide };
    });
  }, [activeReactionId, groupReactionPosition]);

  if (!selectedGroup) return <main className="nexus-chat flex h-full items-center justify-center bg-slate-50"><div className="text-center text-slate-500"><div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Users size={26} /></div><h2 className="font-semibold text-slate-800">Your conversations, together</h2><p className="mt-1 text-sm">Choose a chat or create a group to get started.</p></div></main>;

  const submit = async (event) => { event.preventDefault(); if ((!draft.trim() && !imageData) || sending) return; stopGroupTyping(String(selectedGroup?._id || "")); setSending(true); const ok = await sendGroupMessage(draft, imageData, replyTarget?._id || null); if (ok) { setDraft(""); writeDraft(draftStorageKey, ""); setImageData(""); setImageName(""); setReplyTarget(null); if (fileInputRef.current) fileInputRef.current.value = ""; } setSending(false); };
  const chooseImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) { window.alert("Choose a PNG, JPEG, WebP, or GIF image."); event.target.value = ""; return; }
    if (file.size > 3 * 1024 * 1024) { window.alert("Choose an image smaller than 3 MB."); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => { setImageData(String(reader.result || "")); setImageName(file.name); };
    reader.onerror = () => window.alert("Unable to read this image file.");
    reader.readAsDataURL(file);
  };
  const handleAddMembers = async () => {
    if (!selectedMemberIds.length || addingMembers) return;
    setAddingMembers(true);
    const ok = await addGroupMembers(selectedGroup._id, selectedMemberIds);
    setAddingMembers(false);
    if (ok) setSelectedMemberIds([]);
  };

  const handleGroupMessagesScroll = () => {
    const container = groupMessagesContainerRef.current;
    const groupId = String(selectedGroup?._id || "");
    if (!container || !groupId) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    shouldFollowGroupBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
    if (nearBottom) setNewMessagesWhileAway(0);
    writeConversationScrollPosition(authUser?._id, "group", groupId, { top: container.scrollTop, nearBottom });
  };

  const openMessageMenu = (event, messageId, own) => {
    event.preventDefault();
    event.stopPropagation();
    let x = event.clientX;
    let y = event.clientY;
    // Keyboard activation has no pointer coordinates; anchor it to the options control.
    if (!x && !y && event.currentTarget?.getBoundingClientRect) {
      const rect = event.currentTarget.getBoundingClientRect();
      x = own ? rect.left : rect.right;
      y = rect.top + rect.height / 2;
    }
    setMenuPosition({ x, y, anchorX: x, anchorY: y, side: own ? "left" : "right" });
    setMenuMessageId(messageId);
    setActiveReactionId(null);
    setActiveToolsId(null);
  };

  const showGroupReactionPickerAt = (rect, messageId, own) => {
    const anchorX = own ? rect.right : rect.left;
    const anchorY = rect.top;
    setGroupReactionPosition({ x: anchorX, y: Math.max(8, anchorY - 52), anchorX, anchorY, side: own ? "left" : "right" });
    setActiveToolsId(messageId);
    setActiveReactionId(messageId);
    setMenuMessageId(null);
  };

  const openGroupReactionPicker = (event, messageId, own) => {
    event.preventDefault?.();
    event.stopPropagation();
    if (activeReactionId === messageId) {
      setActiveReactionId(null);
      return;
    }
    showGroupReactionPickerAt(event.currentTarget.getBoundingClientRect(), messageId, own);
  };

  const navigateSearch = (direction) => {
    if (!searchMatches.length) return;
    const nextIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
    setSearchIndex(nextIndex);
    document.getElementById(`group-message-${searchMatches[nextIndex]._id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const closeSearch = () => { setSearchOpen(false); setSearchQuery(""); setSearchIndex(0); };

  const startGroupMessageEdit = (item) => {
    setEditingMessageId(String(item._id));
    setEditingText(String(item.text || ""));
    setMenuMessageId(null);
    setActiveReactionId(null);
    setActiveToolsId(null);
    setReadReceiptsMessageId(null);
    setGroupAction(null);
    requestAnimationFrame(() => {
      editTextareaRef.current?.focus();
      editTextareaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const cancelGroupMessageEdit = () => {
    setEditingMessageId(null);
    setEditingText("");
    setEditingSaving(false);
  };

  const saveGroupMessageEdit = async (messageId) => {
    const nextText = editingText.trim();
    if (!nextText || editingSaving) return;
    const original = groupMessages.find((message) => String(message._id) === String(messageId));
    if (!original) {
      toast.error("This message is no longer available.");
      cancelGroupMessageEdit();
      return;
    }
    if (nextText === String(original.text || "").trim()) {
      cancelGroupMessageEdit();
      return;
    }
    setEditingSaving(true);
    const ok = await editGroupMessage(messageId, nextText);
    setEditingSaving(false);
    if (ok) {
      cancelGroupMessageEdit();
      toast.success("Message updated");
    }
  };

  const handleRemove = (member) => {
    const memberId = String(member?._id || member);
    const self = memberId === ownId;
    setGroupAction({ type: self ? "leave" : "remove", member, memberId });
  };

  const confirmGroupAction = async () => {
    const action = groupAction;
    if (!action || groupActionBusy) return;
    setGroupActionBusy(true);
    let ok = false;
    try {
      if (action.type === "delete") {
        ok = await deleteGroupMessage(action.message._id);
        if (ok) toast.success("Message deleted");
      } else if (action.type === "pin" || action.type === "unpin") {
        ok = await toggleGroupPinnedMessage(action.message._id);
        if (ok) toast.success(action.type === "unpin" ? "Message unpinned" : "Message pinned");
      } else if (action.type === "remove" || action.type === "leave") {
        ok = await removeGroupMember(selectedGroup._id, action.memberId);
        if (ok) {
          toast.success(action.type === "leave" ? "You left the group" : "Member removed");
          setDetailsOpen(false);
        }
      }
      if (ok) setGroupAction(null);
    } finally {
      setGroupActionBusy(false);
    }
  };

  const groupActionCopy = groupAction ? ({
    delete: {
      title: "Delete this message?",
      description: "This message will be deleted for everyone in the group. This action cannot be undone.",
      confirmLabel: "Delete message",
      icon: "delete",
      danger: true,
    },
    pin: {
      title: "Pin this message?",
      description: "This message will be highlighted in the group's pinned-message banner.",
      confirmLabel: "Pin message",
      icon: "pin",
      danger: false,
    },
    unpin: {
      title: "Unpin this message?",
      description: "This message will no longer appear in the group's pinned-message banner.",
      confirmLabel: "Unpin message",
      icon: "unpin",
      danger: false,
    },
    remove: {
      title: "Remove this member?",
      description: `${groupAction.member?.fullName || "This member"} will be removed from ${selectedGroup.name}. They will no longer receive group messages unless added again.`,
      confirmLabel: "Remove member",
      icon: "remove",
      danger: true,
    },
    leave: {
      title: "Leave this group?",
      description: `You will leave ${selectedGroup.name} and stop receiving its messages.`,
      confirmLabel: "Leave group",
      icon: "leave",
      danger: true,
    },
  }[groupAction.type] || null) : null;

  return <main className="nexus-chat relative flex h-full min-w-0 flex-col bg-slate-50">
    <header className="flex min-h-[76px] items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
      <div className="flex min-w-0 items-center gap-3"><button type="button" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setSelectedGroup(null)} aria-label="Back to conversations"><ArrowLeft size={19} /></button><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700"><Users size={21} /></div><button type="button" onClick={() => setDetailsOpen(true)} className="min-w-0 text-left"><h2 className="truncate font-semibold text-slate-900">{selectedGroup.name}</h2><p className={`text-xs ${groupTypingLabel ? "nexus-group-typing-label" : "text-slate-500"}`}>{groupTypingLabel ? <><span className="nexus-group-typing-dots" aria-hidden="true"><i/><i/><i/></span><span>{groupTypingLabel}</span></> : `${selectedGroup.members?.length || 0} members · Group conversation`}</p></button></div>
      <div className="flex items-center gap-1.5">
        <button type="button" className="nexus-search-trigger rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700" title="Search messages" aria-label="Search messages" onClick={() => { setSearchOpen(true); setSearchIndex(0); }}><Search size={17} /></button>
        <button type="button" className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50" title="Group details" onClick={() => setDetailsOpen(true)}><MoreHorizontal size={19} /></button>
      </div>
    </header>
    {searchOpen && <div className="nexus-conversation-search" role="search" aria-label="Search messages in this group">
      <Search size={16} aria-hidden="true" className="nexus-conversation-search__icon" />
      <input ref={searchInputRef} type="search" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchIndex(0); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); navigateSearch(event.shiftKey ? -1 : 1); } }} placeholder="Search messages…" aria-label="Search loaded messages" />
      <span className="nexus-conversation-search__count">{searchQuery.trim() ? (searchMatches.length ? `${Math.min(searchIndex + 1, searchMatches.length)} of ${searchMatches.length}` : "No matches") : "Loaded messages"}</span>
      <button type="button" onClick={() => navigateSearch(-1)} disabled={!searchMatches.length} title="Previous match" aria-label="Previous match"><ChevronUp size={16} /></button>
      <button type="button" onClick={() => navigateSearch(1)} disabled={!searchMatches.length} title="Next match" aria-label="Next match"><ChevronDown size={16} /></button>
      <button type="button" onClick={closeSearch} title="Close search" aria-label="Close search"><X size={16} /></button>
    </div>}
    {pinnedMessage && <button type="button" onClick={() => document.getElementById(`group-message-${pinnedMessage._id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="flex items-center gap-3 border-b border-blue-100 bg-blue-50/80 px-5 py-2.5 text-left"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600"><Pin size={15} /></span><span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-blue-700">Pinned message</span><span className="block truncate text-sm text-slate-700">{pinnedMessage.text || "Message deleted"}</span></span>{isAdmin && <span className="text-xs text-blue-700">Manage in menu</span>}</button>}
    <section ref={groupMessagesContainerRef} onScroll={handleGroupMessagesScroll} className="nexus-group-messages nexus-group-messages--dated relative flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-7" onClick={() => { setActiveReactionId(null); setActiveToolsId(null); setMenuMessageId(null); }}>
      {groupMessages.length === 0 ? <div className="flex h-full min-h-40 flex-col items-center justify-center text-center"><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm ring-1 ring-slate-200"><Users size={23} /></div><p className="font-medium text-slate-800">Welcome to {selectedGroup.name}</p><p className="mt-1 text-sm text-slate-500">Send the first message to get the conversation going.</p></div>  : groupMessages.map((item, messageIndex) => {
        const messageDayKey = getLocalDayKey(item.createdAt || item.updatedAt);
        const previousDayKey = messageIndex > 0 ? getLocalDayKey(groupMessages[messageIndex - 1]?.createdAt || groupMessages[messageIndex - 1]?.updatedAt) : "";
        const showDayDivider = Boolean(messageDayKey && messageDayKey !== previousDayKey);
        const messageKey = item._id || item.clientMessageId || `${messageDayKey}-${messageIndex}`;
        const sender = item.senderId || {}; const senderId = String(sender._id || sender); const own = senderId === ownId;
        const reactions = Array.isArray(item.reactions) ? item.reactions : [];
        const grouped = REACTIONS.map((emoji) => ({ emoji, count: reactions.filter((reaction) => reaction.emoji === emoji).length, mine: reactions.some((reaction) => reaction.emoji === emoji && String(reaction.userId?._id || reaction.userId) === ownId) })).filter((reaction) => reaction.count);
        const isPinned = String(selectedGroup.pinnedMessageId?._id || selectedGroup.pinnedMessageId || "") === String(item._id);
        const readEntries = Array.isArray(item.readBy) ? item.readBy : [];
        const uniqueReadEntries = [...new Map(readEntries.map((entry) => {
          const readerId = String(entry?.userId?._id || entry?.userId || entry?._id || "");
          return [readerId, { entry, readerId }];
        }).filter(([readerId]) => readerId && readerId !== ownId)).values()];
        const readerDetails = uniqueReadEntries.map(({ entry, readerId }, readerIndex) => {
          const populatedUser = entry?.userId && typeof entry.userId === "object" ? entry.userId : null;
          const member = (selectedGroup.members || []).find((candidate) => String(candidate?._id || candidate) === readerId);
          const directoryUser = (users || []).find((candidate) => String(candidate?._id || candidate) === readerId);
          const name = populatedUser?.fullName || populatedUser?.name || member?.fullName || member?.name || directoryUser?.fullName || directoryUser?.name || directoryUser?.username || "Group member";
          return { id: readerId || `reader-${readerIndex}`, name, avatar: populatedUser?.profilePic || member?.profilePic || directoryUser?.profilePic || "" };
        });
        const readCount = readerDetails.length;
        const isSearchMatch = searchMatchIdSet.has(String(item._id));
        const isCurrentSearchMatch = Boolean(searchQuery.trim()) && activeSearchMessageId === String(item._id);
        // Use the same reply model as direct conversations: show a quoted preview
        // in the message list and a matching preview in the composer. The target can
        // arrive populated, as an ID, or as an older/sparse socket payload.
        const rawReplyTo = item.replyTo || item.replyToMessage || item.replyToId || null;
        const replyTargetId = String(
          rawReplyTo?._id || rawReplyTo?.messageId || rawReplyTo?.id ||
          (typeof rawReplyTo === "string" ? rawReplyTo : rawReplyTo?.toString?.() || "")
        );
        const isPopulatedReply = Boolean(rawReplyTo && typeof rawReplyTo === "object" && !Array.isArray(rawReplyTo) && (
          rawReplyTo.senderId || typeof rawReplyTo.text === "string" || rawReplyTo.image || rawReplyTo.deletedForEveryone === true
        ));
        const replyDetails = (isPopulatedReply ? rawReplyTo : null) ||
          groupMessages.find((candidate) => String(candidate._id) === replyTargetId) || null;
        const replySender = replyDetails?.senderId;
        const replySenderId = String(replySender?._id || replySender || "");
        const replySenderName = replySenderId === ownId
          ? "yourself"
          : replySender?.fullName || selectedGroup.members?.find((member) => String(member?._id || member) === replySenderId)?.fullName || "group member";
        const replyPreviewText = !replyTargetId
          ? "Original message"
          : replyDetails?.deletedForEveryone
            ? "This message was deleted"
            : replyDetails?.image
              ? "Photo"
              : String(replyDetails?.text || (replyDetails ? "Message" : "Original message"));
        const hasReply = Boolean(replyTargetId || rawReplyTo);
        return <React.Fragment key={messageKey}>
          {showDayDivider && <div className="nexus-group-day-divider" role="separator" aria-label={formatMessageDayDivider(item.createdAt || item.updatedAt)}><span>{formatMessageDayDivider(item.createdAt || item.updatedAt)}</span></div>}
          <div id={`group-message-${item._id}`} className={`group-message-row flex ${own ? "justify-end" : "justify-start"} ${isSearchMatch ? "nexus-search-match" : ""} ${isCurrentSearchMatch ? "nexus-search-match-current" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div
            onMouseEnter={() => scheduleGroupMessageTools(item._id)}
            onMouseLeave={() => hideGroupMessageTools(item._id)}
            onFocusCapture={() => setActiveToolsId(item._id)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget) && activeReactionId !== item._id) {
                setActiveToolsId((current) => current === item._id ? null : current);
              }
            }}
            className={`group-message-content relative ${own ? "items-end" : "items-start"} ${hasReply && !item.deletedForEveryone ? "has-reply-preview" : ""} ${activeToolsId === item._id ? "is-tools-active" : ""} ${activeReactionId === item._id ? "is-picker-open" : ""}`}>
            {hasReply && !item.deletedForEveryone && <button
              type="button"
              className="nexus-reply-preview mb-1 block max-w-full rounded-md border-l-2 border-blue-500 bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-600 hover:bg-slate-50"
              onClick={(event) => {
                event.stopPropagation();
                const original = replyTargetId ? document.getElementById(`group-message-${replyTargetId}`) : null;
                if (original) original.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              title="Jump to the original message"
              aria-label={`Replying to ${replySenderName}: ${replyPreviewText}`}
            >
              <span className="block font-semibold text-blue-700">Replying to {replySenderName}</span>
              <span className="block max-w-[220px] truncate">{replyPreviewText}</span>
            </button>}
            {editingMessageId === String(item._id) ? (
              <div className="nexus-edit-inline nexus-group-edit-inline" onClick={(event) => event.stopPropagation()}>
                <div className="nexus-group-edit-inline__header">
                  <span><Pencil size={13} aria-hidden="true" /> Edit message</span>
                  <button type="button" onClick={cancelGroupMessageEdit} disabled={editingSaving} aria-label="Close edit message" title="Close editor"><X size={15} aria-hidden="true" /></button>
                </div>
                <textarea
                  ref={editTextareaRef}
                  autoFocus
                  rows={Math.min(5, Math.max(2, String(editingText).split("\n").length))}
                  maxLength={10000}
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") { event.preventDefault(); cancelGroupMessageEdit(); }
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveGroupMessageEdit(item._id); }
                  }}
                  aria-label="Edit group message"
                />
                <div className="nexus-group-edit-inline__actions">
                  <span>Ctrl+Enter to save</span>
                  <button type="button" onClick={cancelGroupMessageEdit} disabled={editingSaving}>Cancel</button>
                  <button type="button" className="primary" onClick={() => saveGroupMessageEdit(item._id)} disabled={!editingText.trim() || editingSaving}>
                    {editingSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => { setActiveToolsId(item._id); setActiveReactionId(null); }} onContextMenu={(event) => openMessageMenu(event, item._id, own)} className={`group-message-bubble rounded-[18px] px-3.5 py-2.5 shadow-sm ${own ? "rounded-br-[5px] bg-blue-600 text-white" : "rounded-bl-[5px] border border-slate-200 bg-white text-slate-800"}`}>
                {item.forwardedFrom?.senderName && <div className={`nexus-group-forwarded-label ${own ? "is-own" : ""}`}><Forward size={12} aria-hidden="true"/><span>Forwarded from {item.forwardedFrom.senderName}</span>{item.forwardedFrom.groupName && <small>· {item.forwardedFrom.groupName}</small>}</div>}
                <p className={`mb-1 text-xs font-semibold ${own ? "text-blue-100" : "text-blue-700"}`}>{own ? "You" : (sender.fullName || "Group member")}</p>
                {!item.deletedForEveryone && item.image && <button type="button" className="nexus-media-thumb group-shared-image-frame mb-2" onClick={(event) => { event.stopPropagation(); setImageViewer({ src: item.image, alt: `Image shared by ${sender.fullName || "group member"}`, fileName: `nexuschat-${item._id || "image"}` }); }} aria-label="Open image shared in group" title="View image"><img src={item.image} alt="Shared in group" loading="lazy" decoding="async" draggable="false" className="group-shared-message-image" /></button>}
                <p className="whitespace-pre-wrap break-words text-sm leading-6"><SearchableMessageText text={item.deletedForEveryone ? "This message was deleted" : item.text} query={searchQuery} /></p>
                <div className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${own ? "text-blue-100" : "text-slate-400"}`}>{isPinned && <Pin size={10} />}{item.editedAt ? "edited · " : ""}{formatMessageTime(item.createdAt)}{own && readCount > 0 && <button type="button" className="nexus-group-read-receipt-trigger" title={`See which group members read this message`} aria-label={`Read by ${readCount} group member${readCount === 1 ? "" : "s"}`} aria-expanded={readReceiptsMessageId === item._id} onClick={(event) => { event.stopPropagation(); setReadReceiptsMessageId((current) => current === item._id ? null : item._id); }}>· Read by {readCount}</button>}</div>
              </div>
            )}
            {own && readReceiptsMessageId === item._id && <div className="nexus-group-read-receipts" role="dialog" aria-label="Group message read receipts" onPointerDown={(event) => event.stopPropagation()}>
              <div className="nexus-group-read-receipts__header"><div><strong>Read by</strong><span>{readCount} {readCount === 1 ? "member" : "members"}</span></div><button type="button" onClick={() => setReadReceiptsMessageId(null)} aria-label="Close read receipts"><X size={14}/></button></div>
              <div className="nexus-group-read-receipts__list">
                {readerDetails.map((reader) => <div className="nexus-group-read-receipts__person" key={reader.id}>
                  {reader.avatar ? <img src={reader.avatar} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span className="nexus-group-read-receipts__initial" aria-hidden="true">{reader.name.trim().slice(0, 1).toUpperCase() || "?"}</span>}
                  <span className="nexus-group-read-receipts__name">{reader.name}</span><span className="nexus-group-read-receipts__status">Read</span>
                </div>)}
              </div>
            </div>}
            {editingMessageId !== String(item._id) && grouped.length > 0 && <div className={`mt-1 flex flex-wrap gap-1 ${own ? "justify-end" : "justify-start"}`}>{grouped.map((reaction) => <button key={reaction.emoji} type="button" onClick={() => toggleGroupReaction(item._id, reaction.emoji)} className={`rounded-full border px-2 py-0.5 text-xs ${reaction.mine ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>{reaction.emoji} {reaction.count}</button>)}</div>}
            {editingMessageId !== String(item._id) && !item.deletedForEveryone && <div className={`group-message-hover-tools absolute ${own ? "right-1" : "left-1"} -top-3 z-10 flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1`}>
              <button type="button" aria-label="Add reaction" title="Add reaction" aria-expanded={activeReactionId === item._id} onClick={(event) => openGroupReactionPicker(event, item._id, own)} className="group-message-tool-button"><Smile size={15} /></button>
              <button type="button" aria-label="Message options" title="Message options" onClick={(event) => menuMessageId === item._id ? setMenuMessageId(null) : openMessageMenu(event, item._id, own)} className="group-message-tool-button group-message-more-button"><MoreHorizontal size={16} /></button>
            </div>}
            {activeReactionId === item._id && createPortal(
              <div ref={groupReactionPickerRef} className="group-message-reaction-picker group-message-reaction-picker-portal" role="group" aria-label="Choose a reaction" style={{ left: `${groupReactionPosition.x}px`, top: `${groupReactionPosition.y}px` }} onPointerDown={(event) => event.stopPropagation()}>
                {REACTIONS.map((emoji) => <button key={emoji} type="button" onClick={(event) => { event.stopPropagation(); toggleGroupReaction(item._id, emoji); setActiveReactionId(null); setActiveToolsId(null); }} className="rounded-lg p-1.5 text-lg transition hover:bg-blue-50" aria-label={`React with ${emoji}`}>{emoji}</button>)}
              </div>, document.body
            )}
            {menuMessageId === item._id && createPortal(<div ref={groupMenuRef} className="group-message-context-menu" data-side={menuPosition.side} role="menu" style={{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
              {!item.deletedForEveryone && <button role="menuitem" type="button" className="nexus-menu-item--reply" onClick={() => { setReplyTarget(item); setMenuMessageId(null); setActiveReactionId(null); setActiveToolsId(null); requestAnimationFrame(() => { draftTextareaRef.current?.focus(); draftTextareaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }); }}><Reply size={16} aria-hidden="true"/><span>Reply</span></button>}
              {!item.deletedForEveryone && <button role="menuitem" type="button" className="nexus-menu-item--forward" onClick={() => { setForwardingMessageId(item._id); setMenuMessageId(null); setActiveReactionId(null); }}><Forward size={16} aria-hidden="true"/><span>Forward to group</span></button>}
              <button role="menuitem" type="button" className="nexus-menu-item--reaction" onClick={() => { const bubble = document.querySelector(`#group-message-${item._id} .group-message-bubble`); const rect = bubble?.getBoundingClientRect(); if (rect) showGroupReactionPickerAt(rect, item._id, own); else { setActiveToolsId(item._id); setActiveReactionId(item._id); } setMenuMessageId(null); }}><Smile size={16} aria-hidden="true"/><span>Add reaction</span></button>
              {own && !item.deletedForEveryone && Boolean(item.text) && <button role="menuitem" type="button" className="nexus-menu-item--edit" onClick={() => startGroupMessageEdit(item)}><Pencil size={16} aria-hidden="true"/><span>Edit message</span></button>}
              {isAdmin && <button role="menuitem" type="button" className={`nexus-menu-item--pin ${isPinned ? "is-pinned" : ""}`} onClick={() => { setGroupAction({ type: isPinned ? "unpin" : "pin", message: item }); setMenuMessageId(null); }}><Pin size={16} aria-hidden="true"/><span>{isPinned ? "Unpin message" : "Pin message"}</span></button>}
              {(own || isAdmin) && !item.deletedForEveryone && <>
                <div className="nexus-menu-divider" aria-hidden="true" />
                <button role="menuitem" type="button" className="danger nexus-menu-item--danger" onClick={() => { setGroupAction({ type: "delete", message: item }); setMenuMessageId(null); }}><Trash2 size={16} aria-hidden="true"/><span>Delete message</span></button>
              </>}
            </div>, document.body)}
            {forwardingMessageId === item._id && !item.deletedForEveryone && <div className={`nexus-group-forward-picker ${own ? "is-own" : "is-incoming"}`} role="dialog" aria-label="Forward message to group">
              <div className="nexus-group-forward-picker__header"><div><strong>Forward message</strong><span>Choose a destination group</span></div><button type="button" onClick={() => setForwardingMessageId(null)} aria-label="Close forwarding panel"><X size={15}/></button></div>
              <div className="nexus-group-forward-picker__list">{(groups || []).filter((group) => String(group._id || group.id) !== String(selectedGroup._id)).map((group) => <button key={group._id || group.id} type="button" onClick={async () => { const ok = await forwardGroupMessage(item._id, String(group._id || group.id)); if (ok) { toast.success(`Forwarded to ${group.name}`); setForwardingMessageId(null); } }}><span className="nexus-group-forward-picker__avatar"><Users size={15}/></span><span className="nexus-group-forward-picker__copy"><strong>{group.name || "Group"}</strong><small>{group.members?.length || 0} members</small></span><Forward size={14} className="nexus-group-forward-picker__arrow"/></button>)}{!(groups || []).some((group) => String(group._id || group.id) !== String(selectedGroup._id)) && <p className="nexus-group-forward-picker__empty">You don't have another group to forward to yet.</p>}</div>
            </div>}
          </div>
          </div>
        </React.Fragment>;
      })}
    </section>
    {showJumpToLatest && <button type="button" className="nexus-group-jump-latest" onClick={() => {
      const container = groupMessagesContainerRef.current;
      if (!container) return;
      const latestTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTo({ top: latestTop, behavior: "smooth" });
      shouldFollowGroupBottomRef.current = true;
      setShowJumpToLatest(false);
      setNewMessagesWhileAway(0);
      writeConversationScrollPosition(authUser?._id, "group", String(selectedGroup?._id || ""), { top: latestTop, nearBottom: true });
    }} aria-label="Jump to latest messages"><ChevronDown size={16} aria-hidden="true"/><span>{newMessagesWhileAway ? `${newMessagesWhileAway} new ${newMessagesWhileAway === 1 ? "message" : "messages"}` : "Latest messages"}</span></button>}
    <form onSubmit={submit} className="nexus-group-composer">
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseImage} className="hidden" aria-label="Attach an image" />
      {replyTarget && <div className="nexus-reply-composer mb-3 flex items-center justify-between gap-3 rounded-lg border-l-2 border-blue-500 bg-white px-2.5 py-1.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-blue-700">Replying to {String(replyTarget.senderId?._id || replyTarget.senderId) === ownId ? "yourself" : replyTarget.senderId?.fullName || selectedGroup.members?.find((member) => String(member?._id || member) === String(replyTarget.senderId?._id || replyTarget.senderId))?.fullName || "group member"}</p>
          <p className="truncate text-[11px] text-slate-600">{replyTarget.deletedForEveryone ? "This message was deleted" : replyTarget.image ? "Photo" : replyTarget.text || "Message"}</p>
        </div>
        <button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply" title="Cancel reply" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={16}/></button>
      </div>}
      {imageData && <div className="nexus-group-composer__attachment"><img src={imageData} alt="Attachment preview"/><span>{imageName}</span><button type="button" onClick={() => { setImageData(""); setImageName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} aria-label="Remove attachment"><X size={16}/></button></div>}
      <div className="nexus-group-composer__row">
        <button type="button" onClick={() => fileInputRef.current?.click()} className="nexus-group-composer__attach" title="Attach image" aria-label="Attach image"><Paperclip size={18}/></button>
        <div className="nexus-group-composer__input-wrap">
          <textarea ref={draftTextareaRef} rows={1} value={draft} onChange={handleGroupDraftChange} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={10000} placeholder={`Message ${selectedGroup.name}…`} className="nexus-group-composer__textarea" aria-label="Group message" />
        </div>
        <button type="submit" disabled={(!draft.trim() && !imageData) || sending} className="nexus-group-composer__send" aria-label="Send group message"><Send size={18}/></button>
      </div>
    </form>
    <MediaLightbox image={imageViewer} onClose={() => setImageViewer(null)} />
    {detailsOpen && <div className="absolute inset-0 z-40 flex items-start justify-center bg-slate-900/30 p-4 pt-10 backdrop-blur-[2px]" onClick={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}><section className="max-h-[min(80%,620px)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
      <div className="mb-4 flex items-start justify-between"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><Users size={22} /></div><div><h3 className="font-semibold text-slate-900">{selectedGroup.name}</h3><p className="text-sm text-slate-500">{selectedGroup.members?.length || 0} members</p></div></div><button type="button" onClick={() => setDetailsOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close group details"><X size={18} /></button></div>
      {selectedGroup.description && <p className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{selectedGroup.description}</p>}
      <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-800">Members</h4>{isAdmin && <span className="inline-flex items-center gap-1 text-xs text-blue-700"><ShieldCheck size={13} /> Admin</span>}</div>
      {isAdmin && <div className="mb-3 rounded-xl border border-slate-200 p-3"><p className="mb-2 text-xs font-semibold text-slate-700">Add members</p><label className="nexus-group-member-search mb-2"><Search size={14} aria-hidden="true"/><input type="search" value={addMemberSearchQuery} onChange={(event) => setAddMemberSearchQuery(event.target.value)} placeholder="Find people to add…" aria-label="Search people to add to group"/><span>{users.filter((user) => !(selectedGroup.members || []).some((member) => String(member?._id || member) === String(user._id)) && String(user._id) !== ownId && [user.fullName, user.username, user.email].some((value) => String(value || "").toLocaleLowerCase().includes(addMemberSearchQuery.trim().toLocaleLowerCase()))).length}</span></label><div className="max-h-32 space-y-1 overflow-y-auto">{users.filter((user) => !(selectedGroup.members || []).some((member) => String(member?._id || member) === String(user._id)) && String(user._id) !== ownId && [user.fullName, user.username, user.email].some((value) => String(value || "").toLocaleLowerCase().includes(addMemberSearchQuery.trim().toLocaleLowerCase()))).map((user) => <label key={user._id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selectedMemberIds.includes(String(user._id))} onChange={(event) => setSelectedMemberIds((prev) => event.target.checked ? [...prev, String(user._id)] : prev.filter((id) => id !== String(user._id)))} /> <span className="truncate">{user.fullName || user.username || "User"}</span></label>)}{!users.some((user) => !(selectedGroup.members || []).some((member) => String(member?._id || member) === String(user._id)) && String(user._id) !== ownId && [user.fullName, user.username, user.email].some((value) => String(value || "").toLocaleLowerCase().includes(addMemberSearchQuery.trim().toLocaleLowerCase()))) && <p className="px-2 py-3 text-center text-xs text-slate-400">No matching people available.</p>}</div><button type="button" disabled={!selectedMemberIds.length || addingMembers} onClick={handleAddMembers} className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{addingMembers ? "Adding…" : `Add selected${selectedMemberIds.length ? ` (${selectedMemberIds.length})` : ""}`}</button></div>}
      <label className="nexus-group-member-search mb-2"><Search size={14} aria-hidden="true"/><input type="search" value={memberSearchQuery} onChange={(event) => setMemberSearchQuery(event.target.value)} placeholder="Search group members…" aria-label="Search group members"/><span>{(selectedGroup.members || []).filter((member) => [member?.fullName, member?.username, member?.email].some((value) => String(value || "").toLocaleLowerCase().includes(memberSearchQuery.trim().toLocaleLowerCase()))).length} / {(selectedGroup.members || []).length}</span></label>
      <div className="space-y-1">{(selectedGroup.members || []).filter((member) => [member?.fullName, member?.username, member?.email].some((value) => String(value || "").toLocaleLowerCase().includes(memberSearchQuery.trim().toLocaleLowerCase()))).map((member) => { const memberId = String(member?._id || member); const owner = memberId === String(selectedGroup.ownerId?._id || selectedGroup.ownerId); const admin = selectedGroup.admins?.some((id) => String(id?._id || id) === memberId); return <div key={memberId} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{(member?.fullName || "?").slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{memberId === ownId ? `${member?.fullName || "You"} (you)` : member?.fullName || "Group member"}</p><p className="text-xs text-slate-500">{owner ? "Owner" : admin ? "Admin" : "Member"}</p></div>{isAdmin && !owner && <button type="button" title="Remove member" onClick={() => handleRemove(member)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><UserMinus size={16} /></button>}</div>; })}{!(selectedGroup.members || []).some((member) => [member?.fullName, member?.username, member?.email].some((value) => String(value || "").toLocaleLowerCase().includes(memberSearchQuery.trim().toLocaleLowerCase()))) && <p className="px-2 py-6 text-center text-xs text-slate-400">No members match “{memberSearchQuery.trim()}”.</p>}</div>
      <div className="mt-5 border-t border-slate-100 pt-4">{String(selectedGroup.ownerId?._id || selectedGroup.ownerId) !== ownId && <button type="button" onClick={() => handleRemove(authUser)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"><LogOut size={16} /> Leave group</button>}{String(selectedGroup.ownerId?._id || selectedGroup.ownerId) === ownId && selectedGroup.members?.length > 1 && <p className="text-xs leading-5 text-slate-500">If you leave, ownership will pass to an existing admin or another remaining member.</p>}</div>
    </section></div>}
    {groupAction && groupActionCopy && <div className="nexus-modal-backdrop nexus-group-action-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !groupActionBusy) setGroupAction(null); }}>
      <section className="nexus-confirm-modal nexus-group-action-modal" role="alertdialog" aria-modal="true" aria-labelledby="nexus-group-action-title" aria-describedby="nexus-group-action-description">
        <div className={`nexus-modal-icon ${groupActionCopy.danger ? "is-danger" : ""}`} aria-hidden="true">
          {groupActionCopy.icon === "delete" ? <Trash2 size={19}/> : groupActionCopy.icon === "pin" ? <Pin size={19}/> : groupActionCopy.icon === "unpin" ? <Pin size={19}/> : groupActionCopy.icon === "remove" ? <UserMinus size={19}/> : <LogOut size={19}/>}
        </div>
        <h3 id="nexus-group-action-title">{groupActionCopy.title}</h3>
        <p id="nexus-group-action-description">{groupActionCopy.description}</p>
        <div className="nexus-modal-actions">
          <button type="button" onClick={() => setGroupAction(null)} disabled={groupActionBusy}>Cancel</button>
          <button type="button" className={groupActionCopy.danger ? "danger" : "primary"} onClick={confirmGroupAction} disabled={groupActionBusy}>
            {groupActionBusy ? "Please wait…" : groupActionCopy.confirmLabel}
          </button>
        </div>
      </section>
    </div>}
  </main>;
}
