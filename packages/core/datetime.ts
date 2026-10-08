import { z } from "zod";

function persistableYear(value: string) {
  const year = new Date(value).getUTCFullYear();
  return !value.startsWith("0000-") && year >= 1 && year <= 9999;
}

export const preciseInstantSchema = z.iso
  .datetime()
  .refine((value) => persistableYear(value) && !/\.\d{4}/.test(value));

export const preciseOffsetInstantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => persistableYear(value) && !/\.\d{4}/.test(value));

// Cursors preserve PostgreSQL microseconds; editable fields preserve milliseconds.
export const cursorInstantSchema = z.iso
  .datetime()
  .refine((value) => persistableYear(value) && !/\.\d{7}/.test(value));
