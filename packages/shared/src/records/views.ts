import { z } from 'zod';
import { SAVED_VIEW_OBJECTS, SAVED_VIEW_VISIBILITIES } from '../constants/crm.ts';
import { filterGroupSchema } from '../filters/ast.ts';
import { VIEW_LAYOUTS } from '../validators/views.ts';

export const savedViewRowSchema = z.object({
  id: z.string(),
  object: z.enum(SAVED_VIEW_OBJECTS),
  pipelineId: z.string().nullable(),
  name: z.string(),
  filter: filterGroupSchema,
  display: z.record(z.string(), z.unknown()),
  visibility: z.enum(SAVED_VIEW_VISIBILITIES),
  ownerId: z.string(),
  position: z.number().int(),
  syncId: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type SavedViewRow = z.infer<typeof savedViewRowSchema>;

export const viewPreferenceRowSchema = z.object({
  page: z.string(),
  scope: z.string(),
  layout: z.enum(VIEW_LAYOUTS),
  display: z.record(z.string(), z.unknown()),
});
export type ViewPreferenceRow = z.infer<typeof viewPreferenceRowSchema>;
