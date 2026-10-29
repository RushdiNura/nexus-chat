import test from "node:test";
import assert from "node:assert/strict";
import { formatLastSeen } from "./utils.js";

const minute = 60_000;
const hour = 60 * minute;

test("formats recent presence in minutes and hours", () => {
  const now = Date.parse("2026-10-28T10:00:00Z");
  assert.equal(formatLastSeen(now - 30_000, now), "last seen just now");
  assert.equal(formatLastSeen(now - 5 * minute, now), "last seen 5 minutes ago");
  assert.equal(formatLastSeen(now - 2 * hour, now), "last seen 2 hours ago");
});

test("formats elapsed presence time and older calendar dates", () => {
  const now = new Date(2026, 9, 28, 10, 0, 0).getTime();
  const today = new Date(2026, 9, 28, 8, 30, 0).getTime();
  const yesterday = new Date(2026, 9, 27, 18, 0, 0).getTime();
  assert.equal(formatLastSeen(today, now), "last seen 1 hour ago");
  assert.equal(formatLastSeen(yesterday, now), "last seen 16 hours ago");
});

test("handles missing last-seen timestamps", () => {
  assert.equal(formatLastSeen(null), "last seen a while ago");
});
