export function formatMessageTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Telegram-style relative presence label for a user's last active time. */
export function formatLastSeen(date, now = Date.now()) {
  if (!date) return "last seen a while ago";
  const timestamp = new Date(date).getTime();
  if (!Number.isFinite(timestamp)) return "last seen a while ago";

  const elapsed = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return "last seen just now";
  if (elapsed < hour) {
    const minutes = Math.floor(elapsed / minute);
    return `last seen ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < day) {
    const hours = Math.floor(elapsed / hour);
    return `last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const last = new Date(timestamp);
  const current = new Date(now);
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  const wasYesterday = last.getFullYear() === yesterday.getFullYear()
    && last.getMonth() === yesterday.getMonth()
    && last.getDate() === yesterday.getDate();
  const time = last.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (wasYesterday) return `last seen yesterday at ${time}`;
  return `last seen ${last.toLocaleDateString([], { day: "numeric", month: "short", year: last.getFullYear() === current.getFullYear() ? undefined : "numeric" })}`;
}
