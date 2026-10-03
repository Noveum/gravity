import type { schema } from '@gravity/db';
import {
  BRAND_COLORS,
  FIELD_OBJECTS,
  FIELD_TYPES,
  PIPELINE_KINDS,
  SAVED_VIEW_OBJECTS,
  SAVED_VIEW_VISIBILITIES,
  STAGE_CATEGORIES,
} from '@gravity/shared/constants';
import { internal } from '@gravity/shared/errors';
import { actorSchema } from '@gravity/shared/events';
import { emptyFilterGroup, filterGroupSchema } from '@gravity/shared/filters';
import { policyRole } from '@gravity/shared/policy';
import type {
  ActivityLinkRow,
  ActivityRow,
  BrandRow,
  CompanyRow,
  EmploymentRow,
  FieldDefinitionRow,
  MemberRow as MemberWireRow,
  PersonRow,
  PipelineRow,
  SavedViewRow,
  StageRow,
} from '@gravity/shared/records';
import type { MemberWithUser } from '../org/member-service.ts';

export function oneOf<T extends string>(values: readonly T[], raw: string, fallback: T): T {
  return values.find((value) => value === raw) ?? fallback;
}

export function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function brandRowOf(row: typeof schema.brand.$inferSelect): BrandRow {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    color: oneOf(BRAND_COLORS, row.color, 'blue'),
    signature: row.signature,
    currentPlaybookVersion: row.currentPlaybookVersion,
    syncId: row.syncId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: isoOrNull(row.archivedAt),
  };
}

export function pipelineRowOf(row: typeof schema.pipeline.$inferSelect): PipelineRow {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    key: row.key,
    kind: oneOf(PIPELINE_KINDS, row.kind, 'people'),
    position: row.position,
    syncId: row.syncId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: isoOrNull(row.archivedAt),
  };
}

export function stageRowOf(row: typeof schema.stage.$inferSelect): StageRow {
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    name: row.name,
    category: oneOf(STAGE_CATEGORIES, row.category, 'open'),
    sortOrder: row.sortOrder,
    syncId: row.syncId,
    archivedAt: isoOrNull(row.archivedAt),
  };
}

export function fieldDefinitionRowOf(
  row: typeof schema.fieldDefinition.$inferSelect,
): FieldDefinitionRow {
  return {
    id: row.id,
    object: oneOf(FIELD_OBJECTS, row.object, 'person'),
    pipelineId: row.pipelineId,
    key: row.key,
    label: row.label,
    type: oneOf(FIELD_TYPES, row.type, 'text'),
    options: row.options,
    description: row.description,
    example: row.example,
    position: row.position,
    syncId: row.syncId,
    archivedAt: isoOrNull(row.archivedAt),
  };
}

export function companyRowOf(row: typeof schema.company.$inferSelect): CompanyRow {
  return {
    id: row.id,
    name: row.name,
    domains: row.domains,
    primaryDomain: row.primaryDomain,
    size: row.size,
    segment: row.segment,
    location: row.location,
    fields: row.fields,
    syncId: row.syncId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: isoOrNull(row.archivedAt),
  };
}

export interface PersonExtras {
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly title: string | null;
}

export function personRowOf(
  row: typeof schema.person.$inferSelect,
  extras: PersonExtras,
): PersonRow {
  return {
    id: row.id,
    name: row.name,
    emails: row.emails,
    primaryEmail: row.primaryEmail,
    phones: row.phones,
    linkedinUrl: row.linkedinUrl,
    linkedinProviderId: row.linkedinProviderId,
    location: row.location,
    timezone: row.timezone,
    doNotContact: row.doNotContact,
    fields: row.fields,
    companyId: extras.companyId,
    companyName: extras.companyName,
    title: extras.title,
    syncId: row.syncId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: isoOrNull(row.archivedAt),
  };
}

export function employmentRowOf(
  row: typeof schema.employment.$inferSelect,
  companyName: string,
): EmploymentRow {
  return {
    id: row.id,
    personId: row.personId,
    companyId: row.companyId,
    companyName,
    title: row.title,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    isCurrent: row.isCurrent,
    syncId: row.syncId,
  };
}

export function activityRowOf(
  row: typeof schema.activity.$inferSelect,
  links: readonly ActivityLinkRow[],
): ActivityRow {
  const actor = actorSchema.safeParse(row.actor);
  if (!actor.success) {
    throw internal(`Activity ${row.id} has an unreadable actor.`, actor.error);
  }
  return {
    id: row.id,
    kind: row.kind,
    actor: actor.data,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
    links: [...links],
    syncId: row.syncId,
  };
}

export function savedViewRowOf(row: typeof schema.savedView.$inferSelect): SavedViewRow {
  const filter = filterGroupSchema.safeParse(row.filter);
  return {
    id: row.id,
    object: oneOf(SAVED_VIEW_OBJECTS, row.object, 'lead'),
    pipelineId: row.pipelineId,
    name: row.name,
    filter: filter.success ? filter.data : emptyFilterGroup(),
    display: row.display,
    visibility: oneOf(SAVED_VIEW_VISIBILITIES, row.visibility, 'private'),
    ownerId: row.ownerId,
    position: row.position,
    syncId: row.syncId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function memberRowOf(entry: MemberWithUser): MemberWireRow {
  return {
    memberId: entry.member.id,
    userId: entry.user.id,
    name: entry.user.name,
    email: entry.user.email,
    image: entry.user.image,
    role: policyRole(entry.member.role),
    isAgent: entry.member.isAgent,
    syncId: entry.member.syncId,
  };
}
