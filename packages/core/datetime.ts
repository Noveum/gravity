import { z } from "zod";

// Browser inputs and persisted timestamps preserve milliseconds. Higher precision
// would compare differently in PostgreSQL and JavaScript or disappear on edits.
function precisePersistableInstant(value: string) {
  if (value.startsWith("0000-") || /\.\d{4}/.test(value)) return false;
  // Offsets can cross the supported UTC year range even when the written year
  // is valid. Date serialization must remain a four-digit AD timestamp.
  const year = new Date(value).getUTCFullYear();
  return year >= 1 && year <= 9999;
}

export const preciseInstantSchema = z.iso
  .datetime()
  .refine(precisePersistableInstant);

export const preciseOffsetInstantSchema = z.iso
  .datetime({ offset: true })
  .refine(precisePersistableInstant);
