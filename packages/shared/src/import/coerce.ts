import {
  type FieldDefinitionLike,
  type FieldValue,
  fieldValueSchema,
} from '../validators/fields.ts';

export type Coerced =
  | { readonly ok: true; readonly value: FieldValue }
  | { readonly ok: false; readonly message: string };

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const GROUPED_NUMBER = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;
const LAST_CALENDAR_YEAR = 9999;

export function booleanOf(raw: string): boolean | null {
  const word = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  return null;
}

function offsetMinutesOf(zone: string | undefined): number | null {
  if (zone === undefined || zone.toUpperCase() === 'Z') return 0;
  const digits = zone.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (hours > 23 || minutes >= MINUTES_PER_HOUR) return null;
  const total = hours * MINUTES_PER_HOUR + minutes;
  return zone.startsWith('-') ? -total : total;
}

export function instantOf(text: string): string | null {
  const match = ISO_INSTANT.exec(text.trim());
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const parts = [year, month, day, hour ?? '0', minute ?? '0', second ?? '0'].map(Number);
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = parts;
  const offset = offsetMinutesOf(zone);
  if (y < 1 || offset === null || h > 23 || mi >= MINUTES_PER_HOUR || s >= MINUTES_PER_HOUR) {
    return null;
  }
  const moment = new Date(0);
  moment.setUTCFullYear(y, mo - 1, d);
  if (
    moment.getUTCFullYear() !== y ||
    moment.getUTCMonth() !== mo - 1 ||
    moment.getUTCDate() !== d
  ) {
    return null;
  }
  moment.setUTCHours(
    h,
    mi,
    s,
    fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3)),
  );
  const shifted = new Date(moment.getTime() - offset * MILLISECONDS_PER_MINUTE);
  const shiftedYear = shifted.getUTCFullYear();
  if (shiftedYear < 1 || shiftedYear > LAST_CALENDAR_YEAR) return null;
  return shifted.toISOString();
}

function calendarDayOf(text: string): string | null {
  return instantOf(text) === null ? null : text.trim().slice(0, 10);
}

function numberOf(text: string): number | null {
  const plain = GROUPED_NUMBER.test(text) ? text.replace(/,/g, '') : text;
  if (!PLAIN_NUMBER.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}

function optionValue(definition: FieldDefinitionLike, text: string): string {
  const needle = text.toLowerCase();
  const match = definition.options.find(
    (option) => option.value.toLowerCase() === needle || option.label.toLowerCase() === needle,
  );
  return match?.value ?? text;
}

function candidateOf(definition: FieldDefinitionLike, text: string): Coerced {
  switch (definition.type) {
    case 'number': {
      const value = numberOf(text);
      return value === null
        ? { ok: false, message: `${text} is not a number.` }
        : { ok: true, value };
    }
    case 'boolean': {
      const value = booleanOf(text);
      return value === null
        ? { ok: false, message: `Use yes or no, not ${text}.` }
        : { ok: true, value };
    }
    case 'date': {
      const value = calendarDayOf(text);
      return value === null
        ? { ok: false, message: `Use a date like 2031-03-04, not ${text}.` }
        : { ok: true, value };
    }
    case 'select':
      return { ok: true, value: optionValue(definition, text) };
    case 'multi_select':
      return {
        ok: true,
        value: [
          ...new Set(
            text
              .split(/[;,]/)
              .map((part) => part.trim())
              .filter((part) => part.length > 0)
              .map((part) => optionValue(definition, part)),
          ),
        ],
      };
    default:
      return { ok: true, value: text };
  }
}

export function coerceFieldValue(definition: FieldDefinitionLike, raw: string): Coerced {
  const text = raw.trim();
  if (text.length === 0) return { ok: true, value: null };
  const candidate = candidateOf(definition, text);
  if (!candidate.ok) return candidate;
  const parsed = fieldValueSchema(definition).safeParse(candidate.value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues[0]?.message ?? 'That value does not fit this field.',
  };
}
