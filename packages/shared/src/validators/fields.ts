import { z } from 'zod';
import { ACTOR_TYPES } from '../constants/actor.ts';
import type { FieldType } from '../constants/crm.ts';
import type { Actor } from '../events/actor.ts';
import { emailSchema } from './common.ts';

export interface FieldDefinitionLike {
  readonly key: string;
  readonly type: FieldType;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly archivedAt?: string | Date | null;
}

export type FieldValue = string | number | boolean | readonly string[] | null;

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function choiceSchema(definition: FieldDefinitionLike) {
  const values = definition.options.map((option) => option.value);
  return z.string().refine((value) => values.includes(value), `Pick one of: ${values.join(', ')}.`);
}

export function fieldValueSchema(definition: FieldDefinitionLike): z.ZodType<FieldValue> {
  switch (definition.type) {
    case 'text':
      return z.string().trim().max(2000).nullable();
    case 'number':
      return z.number().finite().nullable();
    case 'boolean':
      return z.boolean().nullable();
    case 'date':
      return z.string().refine(isCalendarDay, 'Use a calendar day like 2031-03-04.').nullable();
    case 'url':
      return z
        .url({ protocol: /^https?$/ })
        .max(2000)
        .nullable();
    case 'email':
      return emailSchema.nullable();
    case 'select':
      return choiceSchema(definition).nullable();
    case 'multi_select':
      return z
        .array(choiceSchema(definition))
        .max(50)
        .refine((values) => new Set(values).size === values.length, 'Each choice appears once.')
        .nullable();
  }
}

export function fieldValuesSchema(
  definitions: readonly FieldDefinitionLike[],
): z.ZodType<Record<string, FieldValue>> {
  const live = definitions.filter((definition) => (definition.archivedAt ?? null) === null);
  const byKey = new Map(live.map((definition) => [definition.key, definition]));
  const known = live.map((definition) => definition.key).join(', ') || 'none yet';
  return z.record(z.string(), z.unknown()).transform((input, ctx) => {
    const output: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(input)) {
      const definition = byKey.get(key);
      if (definition === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `There is no custom field called ${key}. Known fields: ${known}.`,
        });
        continue;
      }
      const parsed = fieldValueSchema(definition).safeParse(value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: [key, ...issue.path.map(String)],
            message: issue.message,
          });
        }
        continue;
      }
      output[key] = parsed.data;
    }
    return output;
  });
}

export const fieldMetaEntrySchema = z.object({
  source: z.enum(ACTOR_TYPES),
  actorId: z.string().min(1),
  at: z.string(),
});
export type FieldMetaEntry = z.infer<typeof fieldMetaEntrySchema>;

export const fieldsMetaSchema = z.record(z.string(), fieldMetaEntrySchema).catch({});
export type FieldsMeta = Record<string, FieldMetaEntry>;

export interface FieldMerge {
  readonly fields: Record<string, unknown>;
  readonly meta: FieldsMeta;
  readonly suggestions: Record<string, FieldValue>;
}

export function mergeFields(
  current: Readonly<Record<string, unknown>>,
  currentMeta: Readonly<FieldsMeta>,
  incoming: Readonly<Record<string, FieldValue>>,
  actor: Actor,
  at: Date,
): FieldMerge {
  const fields: Record<string, unknown> = { ...current };
  const meta: FieldsMeta = { ...currentMeta };
  const suggestions: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const humanOwned = meta[key]?.source === 'user' && fields[key] !== undefined;
    if (actor.type !== 'user' && humanOwned) {
      suggestions[key] = value;
      continue;
    }
    if (value === null) {
      Reflect.deleteProperty(fields, key);
      Reflect.deleteProperty(meta, key);
      continue;
    }
    fields[key] = value;
    meta[key] = { source: actor.type, actorId: actor.id, at: at.toISOString() };
  }
  return { fields, meta, suggestions };
}
