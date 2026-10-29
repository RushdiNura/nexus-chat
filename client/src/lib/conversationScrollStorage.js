const PREFIX = "nexuschat:scroll-position:v1:";
const memoryCache = new Map();
const pendingWrites = new Map();
let flushTimer = null;

function makeKey(ownerId, conversationType, conversationId) {
  if (!conversationType || !conversationId) return null;
  return `${PREFIX}${encodeURIComponent(String(ownerId || "guest"))}:${conversationType}:${encodeURIComponent(String(conversationId))}`;
}

function persistEntry(key, value) {
  if (typeof window === "undefined" || !key || !value) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ top: Math.max(0, Number(value.top) || 0), nearBottom: Boolean(value.nearBottom) }));
  } catch {
    // Session storage can be unavailable in private browsing or restricted contexts.
  }
}

function flushPendingWrites() {
  for (const [key, value] of pendingWrites.entries()) persistEntry(key, value);
  pendingWrites.clear();
  flushTimer = null;
}

export function readConversationScrollPosition(ownerId, conversationType, conversationId) {
  const key = makeKey(ownerId, conversationType, conversationId);
  if (!key) return null;
  if (memoryCache.has(key)) return memoryCache.get(key);
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) || "null");
    if (!parsed || !Number.isFinite(Number(parsed.top))) return null;
    const value = { top: Math.max(0, Number(parsed.top)), nearBottom: Boolean(parsed.nearBottom) };
    memoryCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function writeConversationScrollPosition(ownerId, conversationType, conversationId, position) {
  const key = makeKey(ownerId, conversationType, conversationId);
  if (!key || !position) return;
  const value = { top: Math.max(0, Number(position.top) || 0), nearBottom: Boolean(position.nearBottom) };
  memoryCache.set(key, value);
  pendingWrites.set(key, value);
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPendingWrites, 120);
}

export function flushConversationScrollPosition(ownerId, conversationType, conversationId) {
  const key = makeKey(ownerId, conversationType, conversationId);
  if (!key) return;
  if (pendingWrites.has(key)) {
    persistEntry(key, pendingWrites.get(key));
    pendingWrites.delete(key);
  }
  if (pendingWrites.size === 0 && flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
