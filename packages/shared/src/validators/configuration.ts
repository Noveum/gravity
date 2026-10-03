import { z } from 'zod';
import {
  BRAND_COLORS,
  FIELD_OBJECTS,
  FIELD_TYPES,
  PIPELINE_KEY_PATTERN,
  PIPELINE_KINDS,
  SELECT_FIELD_TYPES,
  STAGE_CATEGORIES,
} from '../constants/crm.ts';
import { normalizeDomain } from '../utils/identity.ts';
import { idSchema } from './common.ts';

export const nameSchema = z.string().trim().min(1, 'Give it a name.').max(80);

export const pipelineKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PIPELINE_KEY_PATTERN, 'Use 2 to 5 letters, like YOD.');

export const domainSchema = z
  .string()
  .trim()
  .max(253)
  .transform((value, ctx) => {
    const domain = normalizeDomain(value);
    if (domain === null) {
      ctx.addIssue({ code: 'custom', message: 'Use a domain like acme.com.' });
      return z.NEVER;
    }
    return domain;
  });

export const brandCreateSchema = z.object({
  name: nameSchema,
  domain: domainSchema.nullable().default(null),
  color: z.enum(BRAND_COLORS).default('blue'),
  signature: z.string().max(4000).default(''),
  pipelineKey: pipelineKeySchema.optional(),
});

function changesSomething(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}

export const brandUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    domain: domainSchema.nullable().optional(),
    color: z.enum(BRAND_COLORS).optional(),
    signature: z.string().max(4000).optional(),
  })
  .refine(changesSomething, 'Change at least one property.');

export const pipelineCreateSchema = z.object({
  brandId: idSchema,
  name: nameSchema,
  key: pipelineKeySchema,
  kind: z.enum(PIPELINE_KINDS).default('people'),
});

export const pipelineUpdateSchema = z
  .object({ name: nameSchema.optional(), key: pipelineKeySchema.optional() })
  .refine(changesSomething, 'Change at least one property.');

export const stageCreateSchema = z.object({
  pipelineId: idSchema,
  name: nameSchema,
  category: z.enum(STAGE_CATEGORIES).default('open'),
});

export const stageUpdateSchema = z
  .object({ name: nameSchema.optional(), category: z.enum(STAGE_CATEGORIES).optional() })
  .refine(changesSomething, 'Change at least one property.');

export const stageReorderSchema = z.object({
  pipelineId: idSchema,
  stageIds: z
    .array(idSchema)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Each stage appears once.'),
});

export const fieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and underscores.');

export const fieldOptionSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_:-]+$/, 'Use letters, digits, dashes, colons and underscores.'),
  label: z.string().trim().min(1).max(80),
});

const optionsSchema = z
  .array(fieldOptionSchema)
  .max(100)
  .refine(
    (options) => new Set(options.map((option) => option.value)).size === options.length,
    'Each option value appears once.',
  );

export const fieldDefinitionCreateSchema = z
  .object({
    object: z.enum(FIELD_OBJECTS),
    pipelineId: idSchema.nullable().default(null),
    key: fieldKeySchema,
    label: nameSchema,
    type: z.enum(FIELD_TYPES),
    options: optionsSchema.default([]),
    description: z.string().trim().max(500).default(''),
    example: z.string().trim().max(200).default(''),
  })
  .superRefine((value, ctx) => {
    const selectable = SELECT_FIELD_TYPES.includes(value.type);
    if (selectable && value.options.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option.' });
    }
    if (!selectable && value.options.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Only choice fields have options.',
      });
    }
  });

export const fieldDefinitionUpdateSchema = z
  .object({
    label: nameSchema.optional(),
    options: optionsSchema.optional(),
    description: z.string().trim().max(500).optional(),
    example: z.string().trim().max(200).optional(),
  })
  .refine(changesSomething, 'Change at least one property.');
