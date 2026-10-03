import { sql } from 'drizzle-orm';
import { boolean, date, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  archivedAtColumn,
  createdAtColumn,
  organizationIdColumn,
  syncIdColumn,
  updatedAtColumn,
} from './columns.ts';

export const company = pgTable(
  'company',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    name: text('name').notNull(),
    domains: text('domains').array().notNull().default(sql`'{}'::text[]`),
    primaryDomain: text('primary_domain'),
    size: text('size'),
    revenue: jsonb('revenue').$type<Record<string, unknown>>().notNull().default({}),
    segment: text('segment'),
    location: text('location'),
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    fieldsMeta: jsonb('fields_meta').$type<Record<string, unknown>>().notNull().default({}),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    archivedAt: archivedAtColumn(),
  },
  (table) => [
    uniqueIndex('company_org_primary_domain_unique')
      .on(table.organizationId, table.primaryDomain)
      .where(sql`${table.primaryDomain} is not null and ${table.archivedAt} is null`),
    index('company_domains_gin').using('gin', table.domains),
    index('company_name_trgm').using('gin', table.name.op('gin_trgm_ops')),
    index('company_primary_domain_trgm').using('gin', table.primaryDomain.op('gin_trgm_ops')),
    index('company_org_name_idx').on(table.organizationId, sql`lower(${table.name})`, table.id),
  ],
);

export const person = pgTable(
  'person',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    name: text('name').notNull(),
    emails: text('emails').array().notNull().default(sql`'{}'::text[]`),
    primaryEmail: text('primary_email'),
    phones: text('phones').array().notNull().default(sql`'{}'::text[]`),
    linkedinUrl: text('linkedin_url'),
    linkedinProviderId: text('linkedin_provider_id'),
    location: text('location'),
    timezone: text('timezone'),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    fieldsMeta: jsonb('fields_meta').$type<Record<string, unknown>>().notNull().default({}),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    archivedAt: archivedAtColumn(),
  },
  (table) => [
    uniqueIndex('person_org_primary_email_unique')
      .on(table.organizationId, table.primaryEmail)
      .where(sql`${table.primaryEmail} is not null and ${table.archivedAt} is null`),
    uniqueIndex('person_org_linkedin_provider_unique')
      .on(table.organizationId, table.linkedinProviderId)
      .where(sql`${table.linkedinProviderId} is not null and ${table.archivedAt} is null`),
    index('person_org_linkedin_url_idx').on(table.organizationId, table.linkedinUrl),
    index('person_emails_gin').using('gin', table.emails),
    index('person_name_trgm').using('gin', table.name.op('gin_trgm_ops')),
    index('person_primary_email_trgm').using('gin', table.primaryEmail.op('gin_trgm_ops')),
    index('person_org_name_idx').on(table.organizationId, sql`lower(${table.name})`, table.id),
  ],
);

export const employment = pgTable(
  'employment',
  {
    id: text('id').primaryKey(),
    organizationId: organizationIdColumn(),
    personId: text('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id, { onDelete: 'cascade' }),
    title: text('title'),
    startedAt: date('started_at', { mode: 'string' }),
    endedAt: date('ended_at', { mode: 'string' }),
    isCurrent: boolean('is_current').notNull().default(true),
    syncId: syncIdColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('employment_person_idx').on(table.personId),
    index('employment_company_idx').on(table.companyId),
    uniqueIndex('employment_current_unique')
      .on(table.personId, table.companyId)
      .where(sql`${table.isCurrent}`),
  ],
);
