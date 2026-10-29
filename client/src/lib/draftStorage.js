const DRAFT_PREFIX = "nexuschat:draft:v1";

/** Build a per-account, per-conversation session draft key. */
export function buildDraftKey(kind, userId, conversationId) {
  const owner = String(userId || "").trim();
  const conversation = String(conversationId || "").trim();
  const type = kind === "group" ? "group" : "direct";
  return owner && conversation
    ? `${DRAFT_PREFIX}:${encodeURIComponent(owner)}:${type}:${encodeURIComponent(conversation)}`
    : null;
}

/** Drafts are kept in sessionStorage so they survive chat switches and page refreshes in this tab. */
export function readDraft(key) {
  if (!key || typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function writeDraft(key, value) {
  if (!key || typeof window === "undefined") return;
  try {
    const text = String(value || "");
    if (text) window.sessionStorage.setItem(key, text);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage may be disabled or unavailable; the chat input still works normally.
  }
}
