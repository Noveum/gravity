import { expect, test } from "vitest";
import {
  replacePersonalNotes,
  splitImportedConversation,
} from "../src/components/records/imported-conversation";

const transcript =
  "SENT by Alex · 2026-09-28T16:47:41.437Z · fictional-source\nHello Mira,\n\nCan we discuss your evaluation?\n\nRECEIVED by Mira · 2026-09-29T08:30:00Z · fictional-reply\nYes, next Tuesday works.";
test("legacy conversations become readable messages without losing their exact source", () => {
  const original = `Prepare the evaluation agenda.\n\n${transcript}`;
  const result = splitImportedConversation(original);
  expect(result.notes).toBe("Prepare the evaluation agenda.");
  expect(result.source).toBe(transcript);
  expect(result.messages).toEqual([
    expect.objectContaining({
      direction: "outbound",
      sender: "Alex",
      body: "Hello Mira,\n\nCan we discuss your evaluation?",
    }),
    expect.objectContaining({
      direction: "inbound",
      sender: "Mira",
      body: "Yes, next Tuesday works.",
    }),
  ]);
  expect(replacePersonalNotes(original, "Updated agenda.")).toBe(
    `Updated agenda.\n\n${transcript}`,
  );
  expect(replacePersonalNotes(original, "")).toBe(transcript);
});
test("unrecognized notes and malformed headers remain editable and are never discarded", () => {
  for (const value of [
    "My normal notes.\nSENT by Alex yesterday.",
    "SENT by Alex · 2026-99-99T01:00:00Z · source\nA draft.",
    '{"notes":"Fictional imported notes"}',
  ]) {
    expect(splitImportedConversation(value)).toEqual({
      notes: value,
      source: "",
      messages: [],
    });
  }
});
