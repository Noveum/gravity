import { z } from 'zod';
import { SAVED_VIEW_OBJECTS, SAVED_VIEW_VISIBILITIES } from '../constants/crm.ts';
import { emptyFilterGroup, filterGroupWriteSchema } from '../filters/ast.ts';
import { idSchema } from './common.ts';

export const VIEW_LAYOUTS = ['list', 'board'] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

const displaySchema = z.record(z.string(), z.unknown());
const viewNameSchema = z.string().trim().min(1, 'Name the view.').max(80);

export const savedViewCreateSchema = z.object({
  id: z.uuid().optional(),
  object: z.enum(SAVED_VIEW_OBJECTS),
  pipelineId: idSchema.nullable().default(null),
  name: viewNameSchema,
  filter: filterGroupWriteSchema.default(emptyFilterGroup()),
  display: displaySchema.default({}),
  visibility: z.enum(SAVED_VIEW_VISIBILITIES).default('private'),
});

export const savedViewUpdateSchema = z
  .object({
    name: viewNameSchema.optional(),
    filter: filterGroupWriteSchema.optional(),
    display: displaySchema.optional(),
    visibility: z.enum(SAVED_VIEW_VISIBILITIES).optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Change at least one property.',
  );

export const viewPreferenceSchema = z.object({
  page: z.string().regex(/^[a-z][a-z-]{0,39}$/, 'Use a lowercase page name.'),
  scope: z.string().max(64).default(''),
  layout: z.enum(VIEW_LAYOUTS).default('list'),
  display: displaySchema.default({}),
});
