import { z } from 'zod';
import {
  ACTIVITY_ENTITY_TYPES,
  BRAND_COLORS,
  FIELD_OBJECTS,
  FIELD_TYPES,
  OWED_BY,
  PIPELINE_KINDS,
  STAGE_CATEGORIES,
} from '../constants/crm.ts';
import { ORG_ROLES } from '../constants/organization.ts';
import { actorSchema } from '../events/actor.ts';

const isoSchema = z.string().datetime({ offset: true });
const nullableIso = isoSchema.nullable();
const fieldsSchema = z.record(z.string(), z.unknown());
const syncIdSchema = z.number().int().nonnegative();

export const brandRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  color: z.enum(BRAND_COLORS),
  signature: z.string(),
  currentPlaybookVersion: z.number().int(),
  syncId: syncIdSchema,
  createdAt: isoSchema,
  updatedAt: isoSchema,
  archivedAt: nullableIso,
});
export type BrandRow = z.infer<typeof brandRowSchema>;

export const pipelineRowSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  name: z.string(),
  key: z.string(),
  kind: z.enum(PIPELINE_KINDS),
  position: z.number().int(),
  syncId: syncIdSchema,
  createdAt: isoSchema,
  updatedAt: isoSchema,
  archivedAt: nullableIso,
});
export type PipelineRow = z.infer<typeof pipelineRowSchema>;

export const stageRowSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  name: z.string(),
  category: z.enum(STAGE_CATEGORIES),
  sortOrder: z.number().int(),
  syncId: syncIdSchema,
  archivedAt: nullableIso,
});
export type StageRow = z.infer<typeof stageRowSchema>;

export const fieldDefinitionRowSchema = z.object({
  id: z.string(),
  object: z.enum(FIELD_OBJECTS),
  pipelineId: z.string().nullable(),
  key: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  description: z.string(),
  example: z.string(),
  position: z.number().int(),
  syncId: syncIdSchema,
  archivedAt: nullableIso,
});
export type FieldDefinitionRow = z.infer<typeof fieldDefinitionRowSchema>;

export const memberRowSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: z.enum(ORG_ROLES),
  isAgent: z.boolean(),
  syncId: syncIdSchema,
});
export type MemberRow = z.infer<typeof memberRowSchema>;

export const companyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  domains: z.array(z.string()),
  primaryDomain: z.string().nullable(),
  size: z.string().nullable(),
  segment: z.string().nullable(),
  location: z.string().nullable(),
  fields: fieldsSchema,
  syncId: syncIdSchema,
  createdAt: isoSchema,
  updatedAt: isoSchema,
  archivedAt: nullableIso,
});
export type CompanyRow = z.infer<typeof companyRowSchema>;

export const personRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  primaryEmail: z.string().nullable(),
  phones: z.array(z.string()),
  linkedinUrl: z.string().nullable(),
  linkedinProviderId: z.string().nullable(),
  location: z.string().nullable(),
  timezone: z.string().nullable(),
  doNotContact: z.boolean(),
  fields: fieldsSchema,
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  title: z.string().nullable(),
  syncId: syncIdSchema,
  createdAt: isoSchema,
  updatedAt: isoSchema,
  archivedAt: nullableIso,
});
export type PersonRow = z.infer<typeof personRowSchema>;

export const employmentRowSchema = z.object({
  id: z.string(),
  personId: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  title: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  isCurrent: z.boolean(),
  syncId: syncIdSchema,
});
export type EmploymentRow = z.infer<typeof employmentRowSchema>;

export const leadRowSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pipelineId: z.string(),
  brandId: z.string(),
  number: z.number().int().nonnegative(),
  key: z.string(),
  personId: z.string(),
  personName: z.string(),
  personEmail: z.string().nullable(),
  personLinkedinUrl: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  ownerId: z.string().nullable(),
  stageId: z.string(),
  stageCategory: z.enum(STAGE_CATEGORIES),
  source: z.string(),
  priority: z.number().int().min(0).max(4),
  holdReason: z.string().nullable(),
  holdUntil: nullableIso,
  nextAction: z.string().nullable(),
  nextActionAt: nullableIso,
  owedBy: z.enum(OWED_BY),
  lastInboundAt: nullableIso,
  lastOutboundAt: nullableIso,
  fields: fieldsSchema,
  syncId: syncIdSchema,
  createdAt: isoSchema,
  updatedAt: isoSchema,
  archivedAt: nullableIso,
});
export type LeadRow = z.infer<typeof leadRowSchema>;

export const activityLinkSchema = z.object({
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.string(),
});
export type ActivityLinkRow = z.infer<typeof activityLinkSchema>;

export const activityRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  actor: actorSchema,
  occurredAt: isoSchema,
  payload: z.record(z.string(), z.unknown()),
  links: z.array(activityLinkSchema),
  syncId: syncIdSchema,
});
export type ActivityRow = z.infer<typeof activityRowSchema>;
