import { z } from "zod";

// Browser inputs and persisted timestamps preserve milliseconds. Higher precision
// would compare differently in PostgreSQL and JavaScript or disappear on edits.
export const preciseInstantSchema = z.iso
  .datetime()
  .refine((value) => !value.startsWith("0000-") && !/\.\d{4}/.test(value));

export const preciseOffsetInstantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => !value.startsWith("0000-") && !/\.\d{4}/.test(value));
