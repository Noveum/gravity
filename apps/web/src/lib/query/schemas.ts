import { ORG_ROLES } from '@gravity/shared/constants';
import {
  activityRowSchema,
  brandRowSchema,
  companyRowSchema,
  employmentRowSchema,
  fieldDefinitionRowSchema,
  leadRowSchema,
  memberRowSchema,
  personRowSchema,
  pipelineRowSchema,
  savedViewRowSchema,
  stageRowSchema,
  viewPreferenceRowSchema,
} from '@gravity/shared/records';
import { z } from 'zod';

const cursorSchema = z.string().nullable();

export const bootstrapSchema = z.object({
  organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  me: z.object({ userId: z.string(), role: z.enum(ORG_ROLES) }),
  brands: z.array(brandRowSchema),
  pipelines: z.array(pipelineRowSchema),
  stages: z.array(stageRowSchema),
  fields: z.array(fieldDefinitionRowSchema),
  members: z.array(memberRowSchema),
  savedViews: z.array(savedViewRowSchema),
  viewPreferences: z.array(viewPreferenceRowSchema),
});
export type Bootstrap = z.infer<typeof bootstrapSchema>;

export const leadPageSchema = z.object({ leads: z.array(leadRowSchema), nextCursor: cursorSchema });
export type LeadPage = z.infer<typeof leadPageSchema>;

export const personPageSchema = z.object({
  people: z.array(personRowSchema),
  nextCursor: cursorSchema,
});
export type PersonPage = z.infer<typeof personPageSchema>;

export const companyPageSchema = z.object({
  companies: z.array(companyRowSchema),
  nextCursor: cursorSchema,
});
export type CompanyPage = z.infer<typeof companyPageSchema>;

export const personRecordSchema = z.object({
  person: personRowSchema,
  employments: z.array(employmentRowSchema),
  leads: z.array(leadRowSchema),
});
export type PersonRecord = z.infer<typeof personRecordSchema>;

export const companyRecordSchema = z.object({
  company: companyRowSchema,
  people: z.array(z.object({ person: personRowSchema, employment: employmentRowSchema })),
  leads: z.array(leadRowSchema),
});
export type CompanyRecord = z.infer<typeof companyRecordSchema>;

export const timelinePageSchema = z.object({
  activities: z.array(activityRowSchema),
  nextCursor: cursorSchema,
});
export type TimelinePage = z.infer<typeof timelinePageSchema>;

export const searchResultSchema = z.object({
  people: z.array(personRowSchema),
  companies: z.array(companyRowSchema),
  leads: z.array(leadRowSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const duplicatesSchema = z.object({
  people: z.array(personRowSchema),
  companies: z.array(companyRowSchema),
});
export type Duplicates = z.infer<typeof duplicatesSchema>;

export const leadEnvelopeSchema = z.object({ lead: leadRowSchema });
export const leadsEnvelopeSchema = z.object({ leads: z.array(leadRowSchema) });
export const quickCreateEnvelopeSchema = z.object({
  lead: leadRowSchema,
  person: personRowSchema,
  company: companyRowSchema.nullable(),
  personCreated: z.boolean(),
});
export const personEnvelopeSchema = z.object({ person: personRowSchema });
export const companyEnvelopeSchema = z.object({ company: companyRowSchema });
export const brandEnvelopeSchema = z.object({ brand: brandRowSchema });
export const brandCreatedSchema = z.object({
  brand: brandRowSchema,
  pipeline: pipelineRowSchema,
  stages: z.array(stageRowSchema),
});
export const pipelineEnvelopeSchema = z.object({ pipeline: pipelineRowSchema });
export const pipelineCreatedSchema = z.object({
  pipeline: pipelineRowSchema,
  stages: z.array(stageRowSchema),
});
export const stageEnvelopeSchema = z.object({ stage: stageRowSchema });
export const stagesEnvelopeSchema = z.object({ stages: z.array(stageRowSchema) });
export const fieldEnvelopeSchema = z.object({ field: fieldDefinitionRowSchema });
export const viewEnvelopeSchema = z.object({ view: savedViewRowSchema });
export const deletedEnvelopeSchema = z.object({ id: z.string() });
export const preferenceEnvelopeSchema = z.object({ preference: viewPreferenceRowSchema });
