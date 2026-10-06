import { z } from "zod";

export const contextSectionKeys = [
  "background",
  "needs",
  "timing",
  "budget",
  "decisionProcess",
  "risks",
  "history",
] as const;
const note = z.string().trim().max(10000);
export const signalKinds = [
  "hiring",
  "funding",
  "product",
  "engagement",
  "other",
] as const;
export const fieldKinds = ["text", "number", "date", "url", "boolean"] as const;
export function safeContextUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const sourceUrl = z
  .string()
  .max(2000)
  .refine((value) => !!safeContextUrl(value));
export const relationshipSignalSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: note,
  kind: z.enum(signalKinds),
  classification: z.enum(["fact", "hypothesis"]),
  sourceUrl: sourceUrl.nullable(),
  observedAt: z.iso.datetime().nullable(),
});
const fieldBase = { id: z.uuid(), label: z.string().trim().min(1).max(100) };
export const relationshipFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...fieldBase, type: z.literal("text"), value: note }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("number"),
    value: z.number().finite(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("date"),
    value: z.iso.date(),
  }),
  z.strictObject({ ...fieldBase, type: z.literal("url"), value: sourceUrl }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("boolean"),
    value: z.boolean(),
  }),
]);
const detailsObjectSchema = z.strictObject({
  background: note,
  needs: note,
  timing: note,
  budget: note,
  decisionProcess: note,
  risks: note,
  history: note,
  signals: z.array(relationshipSignalSchema).max(100).refine(uniqueIds),
  fields: z.array(relationshipFieldSchema).max(50).refine(uniqueIds),
});
function uniqueIds(items: { id: string }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}
const fitsContextLimit = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length <= 80000;
export const relationshipDetailsSchema =
  detailsObjectSchema.refine(fitsContextLimit);
export const relationshipDetailsPatchSchema = detailsObjectSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0)
  .refine(fitsContextLimit);
export type RelationshipDetails = z.infer<typeof relationshipDetailsSchema>;
export type RelationshipSignal = z.infer<typeof relationshipSignalSchema>;
export type RelationshipField = z.infer<typeof relationshipFieldSchema>;
export function emptyRelationshipDetails(): RelationshipDetails {
  return {
    background: "",
    needs: "",
    timing: "",
    budget: "",
    decisionProcess: "",
    risks: "",
    history: "",
    signals: [],
    fields: [],
  };
}

// Legacy imports are untrusted source data, never operational permissions or messages.
// Parsing is bounded before any recursive presentation; scalars remain ordinary notes.
export function importedContext(value: string): object | null {
  if (value.length > 200000 || !/^[\s]*[[{]/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Reserve transport-envelope space under both HTTP adapters' 100 KB body limit.
export function fitsRelationshipInput(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length <= 90000;
}

export function isImportedContext(value: string) {
  // Bracketed human notes such as "[Review] ..." remain ordinary prose.
  // JSON-looking malformed/oversized documents still use the bounded source viewer.
  return (
    importedContext(value) !== null ||
    /^\s*(?:\{\s*"|\[\s*(?:\{|"))/.test(value)
  );
}
