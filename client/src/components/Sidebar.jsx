import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MoreHorizontal, UserRound, LogOut, MessageCircle, Circle, X, Check, CheckCheck, Plus, Users, Pin } from "lucide-react";
import assets from "../assets/assets";
import AuthContext from "../context/AuthContext";
import { ChatContext } from "../context/ChatContext";
import { formatLastSeen, formatMessageTime } from "../lib/utils";

function Sidebar() {
  const { getUsers, users, selectedUser, setSelectedUser, unseenMessages, messages, groups, selectedGroup, setSelectedGroup, openGroup, createGroup, getGroups } = useContext(ChatContext);
  const { logout, onlineUsers, authUser, socket } = useContext(AuthContext);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [presenceClock, setPresenceClock] = useState(Date.now());
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [pinnedItems, setPinnedItems] = useState({ direct: [], groups: [] });
  const navigate = useNavigate();
  const pinnedStorageKey = authUser?._id ? `nexus:pinned-conversations:${String(authUser._id)}` : null;
  const pinnedDirectIds = useMemo(() => pinnedItems.direct || [], [pinnedItems.direct]);
  const pinnedGroupIds = useMemo(() => pinnedItems.groups || [], [pinnedItems.groups]);

  // Pins are account-scoped and local to this browser, so they survive reloads
  // without changing server data or other users' sidebar preferences.
  useEffect(() => {
    if (!pinnedStorageKey) {
      setPinnedItems({ direct: [], groups: [] });
      return;
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(pinnedStorageKey) || "{}");
      setPinnedItems({
        direct: Array.isArray(saved.direct) ? saved.direct.map(String) : [],
        groups: Array.isArray(saved.groups) ? saved.groups.map(String) : [],
      });
    } catch {
      setPinnedItems({ direct: [], groups: [] });
    }
  }, [pinnedStorageKey]);

  useEffect(() => {
    if (!pinnedStorageKey) return undefined;
    const syncPins = (event) => {
      if (event.key !== pinnedStorageKey) return;
      try {
        const saved = JSON.parse(event.newValue || "{}");
        setPinnedItems({
          direct: Array.isArray(saved.direct) ? saved.direct.map(String) : [],
          groups: Array.isArray(saved.groups) ? saved.groups.map(String) : [],
        });
      } catch {
        setPinnedItems({ direct: [], groups: [] });
      }
    };
    window.addEventListener("storage", syncPins);
    return () => window.removeEventListener("storage", syncPins);
  }, [pinnedStorageKey]);

  const togglePinnedItem = (kind, itemId) => {
    const id = String(itemId || "");
    if (!id) return;
    const current = pinnedItems[kind] || [];
    const next = {
      ...pinnedItems,
      [kind]: current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    };
    setPinnedItems(next);
    if (pinnedStorageKey) {
      try { window.localStorage.setItem(pinnedStorageKey, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setPresenceClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { getUsers(); getGroups(); }, [onlineUsers, getUsers, getGroups]);

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => getUsers();
    socket.on("newMessage", refresh);
    socket.on("messageUpdated", refresh);
    socket.on("group-message", refresh);
    socket.on("group-updated", getGroups);
    return () => {
      socket.off("newMessage", refresh);
      socket.off("messageUpdated", refresh);
      socket.off("group-message", refresh);
      socket.off("group-updated", getGroups);
    };
  }, [socket, getUsers, getGroups]);

  const latestByUser = useMemo(() => {
    const latest = {};
    for (const user of users) {
      if (user.lastMessage) latest[String(user._id)] = user.lastMessage;
    }
    for (const msg of messages) {
      const otherId = String(msg.senderId) === String(authUser?._id) ? msg.receiverId : msg.senderId;
      if (!otherId) continue;
      const time = new Date(msg.createdAt || 0).getTime();
      if (!latest[otherId] || time > new Date(latest[otherId].createdAt || 0).getTime()) latest[otherId] = msg;
    }
    return latest;
  }, [messages, users, authUser?._id]);

  const displayUsers = useMemo(() => users
    .filter((user) => String(user._id) !== String(authUser?._id))
    .filter((user) => (user.fullName || "").toLowerCase().includes(searchTerm.trim().toLowerCase()))
    .filter((user) => filter !== "online" || onlineUsers.some((id) => String(id) === String(user._id)))
    .sort((a, b) => {
      const aPinned = pinnedDirectIds.includes(String(a._id));
      const bPinned = pinnedDirectIds.includes(String(b._id));
      if (aPinned !== bPinned) return Number(bPinned) - Number(aPinned);
      const aTime = new Date(latestByUser[a._id]?.createdAt || 0).getTime();
      const bTime = new Date(latestByUser[b._id]?.createdAt || 0).getTime();
      return bTime - aTime || Number(onlineUsers.some((id) => String(id) === String(b._id))) - Number(onlineUsers.some((id) => String(id) === String(a._id))) || (a.fullName || "").localeCompare(b.fullName || "");
    }), [users, authUser?._id, searchTerm, filter, onlineUsers, latestByUser, pinnedDirectIds]);

  const displayGroups = useMemo(() => [...groups].sort((a, b) => {
    const aPinned = pinnedGroupIds.includes(String(a._id || a.id));
    const bPinned = pinnedGroupIds.includes(String(b._id || b.id));
    return Number(bPinned) - Number(aPinned) || (a.name || "").localeCompare(b.name || "");
  }), [groups, pinnedGroupIds]);

  const getImageSource = (url) => !url ? assets.avatar_icon : (url.startsWith("http") || url.startsWith("data:") ? url : `${import.meta.env.VITE_BACKEND_URL}${url}`);
  const handleImageError = (event) => { event.currentTarget.onerror = null; event.currentTarget.src = assets.avatar_icon; };
  const previewFor = (user) => {
    const msg = latestByUser[user._id];
    if (!msg) return onlineUsers.includes(user._id) ? "Available to chat" : formatLastSeen(user.lastSeen, presenceClock);
    if (msg.deletedForEveryone) return "Message deleted";
    if (msg.image && !msg.text) return "▧ Photo";
    return msg.text || "Message";
  };

  return (
    <aside className={`nexus-sidebar h-full ${selectedUser || selectedGroup ? "max-md:hidden" : ""}`}>
      <header className="nx-sidebar-header">
        <div className="nx-brand-lockup">
          <div className="nx-brand-mark" aria-hidden="true"><MessageCircle size={21} strokeWidth={2.2} /></div>
          <div className="min-w-0"><p className="nx-brand-name">nexus<span>chat</span></p><p className="nx-brand-caption">MESSAGES, MADE HUMAN</p></div>
        </div>
        <div className="nx-menu-wrap">
          <button type="button" className={`nx-icon-button ${menuOpen ? "is-active" : ""}`} aria-label="Open account menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={21} /></button>
          {menuOpen && <>
            <button className="nx-menu-dismiss" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="nx-account-menu">
              <div className="nx-menu-user"><img src={getImageSource(authUser?.profilePic)} onError={handleImageError} alt="" /><div><strong>{authUser?.fullName || "Your account"}</strong><span>Personal account</span></div></div>
              <button type="button" onClick={() => { setMenuOpen(false); navigate("/profile"); }}><UserRound size={16} /> Edit profile</button>
              <button type="button" className="nx-logout-item" onClick={logout}><LogOut size={16} /> Sign out</button>
            </div>
          </>}
        </div>
      </header>

      <div className="nx-inbox-heading"><div><p className="nx-eyebrow">YOUR SPACE</p><h1>Messages <span>{displayUsers.length}</span></h1></div><div className="nx-online-summary"><i />{onlineUsers.filter((id) => String(id) !== String(authUser?._id)).length} online</div></div>

      <label className="nx-search-box">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search people or messages" aria-label="Search people" />
        {searchTerm && <button type="button" aria-label="Clear search" onClick={() => setSearchTerm("")}><X size={15} /></button>}
        {!searchTerm && <kbd>⌘ K</kbd>}
      </label>

      <div className="nx-filter-row" role="group" aria-label="Filter conversations">
        <button type="button" className={filter === "all" ? "is-selected" : ""} onClick={() => setFilter("all")}>All chats</button>
        <button type="button" className={filter === "online" ? "is-selected" : ""} onClick={() => setFilter("online")}>Online <span>{onlineUsers.filter((id) => String(id) !== String(authUser?._id)).length}</span></button>
      </div>

      <div className="px-5 pt-4">
        <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold tracking-[0.16em] text-slate-400">GROUPS</span><button type="button" onClick={() => setGroupModalOpen(true)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-50" aria-label="Create group"><Plus size={14}/> New group</button></div>
        {groups.length === 0 ? <p className="px-1 pb-2 text-xs text-slate-400">Create a group to chat with several people.</p> : <div className="mb-3 space-y-1">{displayGroups.map((group) => {
          const groupId = String(group._id || group.id);
          const isPinned = pinnedGroupIds.includes(groupId);
          const isSelected = String(selectedGroup?._id || selectedGroup?.id) === groupId;
          return <div className={`nx-group-item ${isSelected ? "is-selected" : ""}`} key={groupId}>
            <button type="button" onClick={() => openGroup(group)} className={`nx-group-conversation flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${isSelected ? "bg-blue-50 ring-1 ring-blue-100" : "hover:bg-slate-50"}`} aria-current={isSelected ? "page" : undefined}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600"><Users size={17}/></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{group.name}</span><span className="block truncate text-xs text-slate-400">{group.lastMessage?.text || `${group.members?.length || 0} members`}</span></span>
            </button>
            <button type="button" className={`nx-pin-toggle ${isPinned ? "is-pinned" : ""}`} title={isPinned ? "Unpin group" : "Pin group to top"} aria-label={isPinned ? `Unpin ${group.name}` : `Pin ${group.name} to top`} aria-pressed={isPinned} onClick={(event) => { event.stopPropagation(); togglePinnedItem("groups", groupId); }}><Pin size={14} fill={isPinned ? "currentColor" : "none"}/></button>
          </div>;
        })}</div>}
      </div>

      <div className="nx-conversation-section">
        <div className="nx-list-label"><span>CONVERSATIONS</span><span>{displayUsers.length}</span></div>
        <div className="nx-conversation-list">
          {displayUsers.length === 0 ? (
            <div className="nx-list-empty"><div className="nx-empty-icon"><Search size={19} /></div><strong>{searchTerm ? "No matches found" : filter === "online" ? "Nobody is online" : "No conversations yet"}</strong><p>{searchTerm ? "Try another name." : filter === "online" ? "People will appear here when they come online." : "When you connect with someone, they’ll appear here."}</p></div>
          ) : displayUsers.map((user) => {
            const isOnline = onlineUsers.some((id) => String(id) === String(user._id));
            const isSelected = String(selectedUser?._id) === String(user._id);
            const unread = unseenMessages[user._id] || 0;
            const lastMessage = latestByUser[user._id];
            const lastMessageIsMine = Boolean(lastMessage && String(lastMessage.senderId?._id || lastMessage.senderId) === String(authUser?._id));
            const messageReceipt = lastMessage?.seen ? "is-seen" : lastMessage?.deliveredAt ? "is-delivered" : "is-sent";
            const isPinned = pinnedDirectIds.includes(String(user._id));
            return <div className={`nx-conversation-item ${isSelected ? "is-selected" : ""}`} key={user._id}>
              <button type="button" onClick={() => { setSelectedGroup(null); setSelectedUser(user); }} className={`nx-conversation ${isSelected ? "is-selected" : ""}`} aria-current={isSelected ? "page" : undefined}>
                <span className="nx-avatar-wrap"><img src={getImageSource(user.profilePic)} onError={handleImageError} alt="" className="nx-avatar" /><i className={isOnline ? "is-online" : ""} /></span>
                <span className="nx-conversation-copy"><span className="nx-conversation-top"><strong>{user.fullName || "Unknown user"}</strong><time>{lastMessage ? formatMessageTime(lastMessage.createdAt) : ""}</time></span><span className="nx-conversation-bottom"><span className={`nx-preview ${unread ? "has-unread" : ""}`}>{lastMessageIsMine && (lastMessage?.deliveredAt || lastMessage?.seen ? <CheckCheck size={13} title={lastMessage.seen ? "Seen" : "Delivered"} aria-label={lastMessage.seen ? "Seen" : "Delivered"} className={`nx-preview-check ${messageReceipt}`} /> : <Check size={13} title="Sent" aria-label="Sent" className={`nx-preview-check ${messageReceipt}`} />)}{previewFor(user)}</span>{unread > 0 && <span className="nx-unread-count">{unread > 99 ? "99+" : unread}</span>}</span></span>
              </button>
              <button type="button" className={`nx-pin-toggle ${isPinned ? "is-pinned" : ""}`} title={isPinned ? "Unpin conversation" : "Pin conversation to top"} aria-label={isPinned ? `Unpin ${user.fullName || "conversation"}` : `Pin ${user.fullName || "conversation"} to top`} aria-pressed={isPinned} onClick={() => togglePinnedItem("direct", user._id)}><Pin size={14} fill={isPinned ? "currentColor" : "none"}/></button>
            </div>;
          })}
        </div>
      </div>
      <footer className="nx-sidebar-footer"><span className="nx-footer-status"><Circle size={8} fill="currentColor" /> Connected to NexusChat</span><span className="nx-footer-version">PRIVATE MESSAGING</span></footer>
      {groupModalOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGroupModalOpen(false); }}><form className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200" onSubmit={async (event) => { event.preventDefault(); if (!groupName.trim()) return; setCreatingGroup(true); const ok = await createGroup({ name: groupName, description: groupDescription, memberIds: groupMemberIds }); setCreatingGroup(false); if (ok) { setGroupModalOpen(false); setGroupName(""); setGroupDescription(""); setGroupMemberIds([]); } }}><div className="mb-5 flex items-start justify-between"><div><h2 className="text-lg font-semibold text-slate-900">Create a group</h2><p className="mt-1 text-sm text-slate-500">Start a conversation with your people.</p></div><button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setGroupModalOpen(false)} aria-label="Close dialog"><X size={18}/></button></div><label className="mb-4 block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Group name</span><input required minLength={2} maxLength={80} value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Project team" className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"/></label><label className="mb-4 block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></span><input maxLength={500} value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder="What is this group for?" className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"/></label><div className="mb-5"><p className="mb-2 text-sm font-medium text-slate-700">Add people <span className="font-normal text-slate-400">(optional)</span></p><div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-2">{users.filter((user) => String(user._id) !== String(authUser?._id)).map((user) => <label key={user._id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"><input type="checkbox" checked={groupMemberIds.includes(String(user._id))} onChange={(event) => setGroupMemberIds((prev) => event.target.checked ? [...prev, String(user._id)] : prev.filter((id) => id !== String(user._id)))} className="h-4 w-4 accent-blue-600"/><span className="text-sm text-slate-700">{user.fullName}</span></label>)}</div></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setGroupModalOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button><button type="submit" disabled={creatingGroup || groupName.trim().length < 2} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{creatingGroup ? "Creating…" : "Create group"}</button></div></form></div>}
    </aside>
  );
}

export default Sidebar;
