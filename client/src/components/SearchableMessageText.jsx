import React from "react";

export default function SearchableMessageText({ text, query }) {
  const value = String(text ?? "");
  const needle = String(query ?? "").trim();
  if (!needle) return value;

  const source = value.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  const parts = [];
  let cursor = 0;
  let matchIndex = source.indexOf(target, cursor);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(value.slice(cursor, matchIndex));
    parts.push(
      <mark key={`match-${matchIndex}`} className="nexus-search-highlight">
        {value.slice(matchIndex, matchIndex + needle.length)}
      </mark>
    );
    cursor = matchIndex + needle.length;
    matchIndex = source.indexOf(target, cursor);
  }

  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts.length ? <>{parts}</> : value;
}
