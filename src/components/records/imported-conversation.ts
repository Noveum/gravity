// Recognize only the legacy transcript header format. Everything else stays a note.
export interface ImportedMessage {
  id: string;
  direction: "inbound" | "outbound";
  sender: string;
  occurredAt: string;
  body: string;
  sourceId: string;
}
export function splitImportedConversation(value: string) {
  const headers = [
    ...value.matchAll(
      /^(SENT|RECEIVED|INBOUND|OUTBOUND) (?:by|from) ([^\n·]+)\s*·\s*(\d{4}-\d{2}-\d{2}T[^\s·]+)\s*(?:·\s*([^\n]*))?\r?$/gm,
    ),
  ].filter((match) => Number.isFinite(Date.parse(match[3] ?? "")));
  if (!headers.length)
    return { notes: value, source: "", messages: [] as ImportedMessage[] };
  const start = headers[0]?.index ?? 0;
  const messages = headers.map((match, index) => ({
    id: `imported-${index}-${match.index}`,
    direction:
      match[1] === "SENT" || match[1] === "OUTBOUND"
        ? ("outbound" as const)
        : ("inbound" as const),
    sender: match[2]?.trim() ?? "",
    occurredAt: match[3] ?? "",
    sourceId: match[4]?.trim() ?? "",
    body: value
      .slice(
        (match.index ?? 0) + match[0].length,
        headers[index + 1]?.index ?? value.length,
      )
      .trim(),
  }));
  return {
    notes: value.slice(0, start).trimEnd(),
    source: value.slice(start),
    messages,
  };
}
export function replacePersonalNotes(original: string, notes: string) {
  const { source } = splitImportedConversation(original);
  return source
    ? `${notes.trim()}${notes.trim() ? "\n\n" : ""}${source}`
    : notes;
}
