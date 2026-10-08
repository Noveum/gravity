import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  defaultProductColorKey,
  productColorKeys,
} from "../core/product-colors";
import type { RelationshipDetails } from "../core/relationship-context";
import { serverAccessPolicy } from "./access-policy";

export * from "./auth-schema";

import { user } from "./auth-schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const organizationId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id);
const productId = () => uuid("product_id").notNull();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const version = () => integer("version").notNull().default(1);
const recordMetadata = () => ({
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  amountMinor: integer("amount_minor"),
  currency: text("currency").notNull().default("USD"),
});

// Attribution is separate from current relationship ownership. Historical records
// remain unknown unless a reliable submission was recorded.
export const contactImportBatches = pgTable(
  "contact_import_batches",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    submittedBy: text("submitted_by").notNull(),
    sourceMemberId: text("source_member_id"),
    sourceKind: text("source_kind", {
      enum: ["file", "agent", "manual"],
    }).notNull(),
    label: text("label").notNull(),
    submissionKey: text("submission_key").notNull(),
    transport: text("transport", {
      enum: ["session", "mcp", "demo"],
    }).notNull(),
    clientId: text("client_id"),
    grantId: uuid("grant_id"),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.organizationId, t.submittedBy, t.submissionKey),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.submittedBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.sourceMemberId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();

export const contactContributions = pgTable(
  "contact_contributions",
  {
    id: id(),
    organizationId: organizationId(),
    personId: uuid("person_id").notNull(),
    productId: uuid("product_id"),
    actorId: text("actor_id"),
    sourceMemberId: text("source_member_id"),
    kind: text("kind", {
      enum: ["created", "submitted", "updated", "provider_import"],
    }).notNull(),
    transport: text("transport", {
      enum: ["session", "mcp", "demo", "system"],
    }).notNull(),
    clientId: text("client_id"),
    grantId: uuid("grant_id"),
    batchId: uuid("batch_id"),
    sourceRecordId: text("source_record_id"),
    requestHash: text("request_hash"),
    connectionId: uuid("connection_id"),
    sourceConversationId: uuid("source_conversation_id"),
    provider: text("provider"),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [people.organizationId, people.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.sourceMemberId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.batchId],
      foreignColumns: [
        contactImportBatches.organizationId,
        contactImportBatches.productId,
        contactImportBatches.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.sourceConversationId],
      foreignColumns: [
        conversations.organizationId,
        conversations.productId,
        conversations.id,
      ],
    }),
    index("contact_contributions_person").on(
      t.organizationId,
      t.personId,
      t.createdAt,
    ),
    index("contact_contributions_actor").on(
      t.organizationId,
      t.actorId,
      t.personId,
    ),
    uniqueIndex("contact_contributions_batch_row").on(
      t.batchId,
      t.sourceRecordId,
    ),
    uniqueIndex("contact_contributions_provider_row").on(
      t.connectionId,
      t.sourceRecordId,
    ),
    uniqueIndex("contact_contributions_original_creator")
      .on(t.personId)
      .where(sql`${t.kind} = 'created'`),
    check(
      "contact_contribution_batch_row",
      sql`((${t.batchId} IS NULL) = (${t.requestHash} IS NULL)) AND (${t.batchId} IS NULL OR (${t.productId} IS NOT NULL AND ${t.sourceRecordId} IS NOT NULL))`,
    ),
  ],
).enableRLS();

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    timezone: text("timezone").notNull().default("UTC"),
    allowedEmailDomains: jsonb("allowed_email_domains")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
  },
  () => [serverAccessPolicy()],
).enableRLS();
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [serverAccessPolicy(), unique().on(t.organizationId, t.userId)],
).enableRLS();
export const products = pgTable(
  "products",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#7565cf"),
    colorKey: text("color_key", { enum: productColorKeys })
      .notNull()
      .default(defaultProductColorKey),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.name),
    check(
      "product_color_key",
      sql`${t.colorKey} IN (${sql.raw(productColorKeys.map((key) => `'${key}'`).join(", "))})`,
    ),
  ],
).enableRLS();
export const productMemberships = pgTable(
  "product_memberships",
  {
    organizationId: organizationId(),
    productId: productId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.userId),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: organizationId(),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    productIds: jsonb("product_ids").$type<string[]>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    index("invitations_organization_idx").on(t.organizationId),
    uniqueIndex("invitations_pending_email")
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    check("invitation_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check(
      "invitation_single_outcome",
      sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`,
    ),
  ],
).enableRLS();
export const companies = pgTable(
  "companies",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    domain: text("domain"),
    description: text("description").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    version: version(),
    ...recordMetadata(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.id),
    index("companies_browse").on(t.organizationId, t.name, t.id),
    check(
      "company_amount_nonnegative",
      sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`,
    ),
    check("company_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
).enableRLS();
export const people = pgTable(
  "people",
  {
    id: id(),
    organizationId: organizationId(),
    companyId: uuid("company_id"),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    email: text("email"),
    otherEmails: jsonb("other_emails").$type<string[]>().notNull().default([]),
    phone: text("phone").notNull().default(""),
    linkedinUrl: text("linkedin_url").notNull().default(""),
    summary: text("summary").notNull().default(""),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    timeZone: text("time_zone"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    version: version(),
    ...recordMetadata(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.id),
    index("people_company_browse").on(
      t.organizationId,
      t.companyId,
      t.archivedAt,
    ),
    index("people_name_browse").on(t.organizationId, t.name, t.id),
    check(
      "person_amount_nonnegative",
      sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`,
    ),
    check("person_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    foreignKey({
      columns: [t.organizationId, t.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
    uniqueIndex("people_organization_linkedin_url")
      .on(t.organizationId, sql`lower(${t.linkedinUrl})`)
      .where(sql`${t.linkedinUrl} <> ''`),
  ],
).enableRLS();
export const relationships = pgTable(
  "relationships",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    personId: uuid("person_id").notNull(),
    ownerId: text("owner_id").notNull(),
    purpose: text("purpose").notNull().default("buyer"),
    qualification: text("qualification").notNull().default("unverified"),
    context: text("context").notNull().default(""),
    contextDetails: jsonb("context_details")
      .$type<RelationshipDetails>()
      .notNull()
      .default({
        background: "",
        needs: "",
        timing: "",
        budget: "",
        decisionProcess: "",
        risks: "",
        history: "",
        signals: [],
        fields: [],
      }),
    contextSource: text("context_source"),
    stageId: uuid("stage_id"),
    stagePipeline: text("stage_pipeline", { enum: ["outreach"] })
      .notNull()
      .default("outreach"),
    priority: text("priority", { enum: ["low", "normal", "high"] })
      .notNull()
      .default("normal"),
    nextStep: text("next_step").notNull().default(""),
    nextStepDueAt: timestamp("next_step_due_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    touchCount: integer("touch_count").notNull().default(0),
    version: version(),
    ...recordMetadata(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.organizationId, t.productId, t.personId, t.purpose),
    index("relationships_person_browse").on(
      t.organizationId,
      t.personId,
      t.productId,
    ),
    check(
      "relationship_amount_nonnegative",
      sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`,
    ),
    check("relationship_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("relationship_stage_outreach", sql`${t.stagePipeline} = 'outreach'`),
    check("relationship_touch_count", sql`${t.touchCount} >= 0`),
    foreignKey({
      columns: [t.organizationId, t.productId, t.stageId, t.stagePipeline],
      foreignColumns: [
        stages.organizationId,
        stages.productId,
        stages.id,
        stages.pipeline,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [people.organizationId, people.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const sequences = pgTable(
  "sequences",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    name: text("name").notNull(),
    version: version(),
    steps: jsonb("steps")
      .$type<
        {
          number: number;
          name: string;
          delayDays: number;
          channel: "gmail" | "linkedin";
          template: string;
          followUp: number;
        }[]
      >()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
  ],
).enableRLS();
export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    sequenceId: uuid("sequence_id").notNull(),
    status: text("status", {
      enum: ["running", "paused", "completed", "stopped"],
    }).notNull(),
    pauseReason: text("pause_reason", {
      enum: ["reply", "archived", "manual", "do_not_contact"],
    }),
    step: integer("step").notNull().default(1),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: version(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.organizationId, t.productId, t.relationshipId, t.id),
    uniqueIndex("enrollments_active_relationship_sequence")
      .on(t.organizationId, t.relationshipId, t.sequenceId)
      .where(sql`${t.status} IN ('running', 'paused')`),
    check(
      "enrollment_pause_reason",
      sql`(${t.status} = 'paused') = (${t.pauseReason} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.sequenceId],
      foreignColumns: [
        sequences.organizationId,
        sequences.productId,
        sequences.id,
      ],
    }),
  ],
).enableRLS();
export const touches = pgTable(
  "touches",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    stepNumber: integer("step_number").notNull(),
    followUp: integer("follow_up").notNull(),
    channel: text("channel", { enum: ["gmail", "linkedin"] }).notNull(),
    senderId: text("sender_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status", {
      enum: ["planned", "drafted", "approved", "sent", "skipped", "expired"],
    })
      .notNull()
      .default("planned"),
    draft: text("draft").notNull().default(""),
    draftHash: text("draft_hash"),
    approvedHash: text("approved_hash"),
    approvedBy: text("approved_by"),
    sentBy: text("sent_by"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    externalMessageId: text("external_message_id"),
    sentWarnings: jsonb("sent_warnings")
      .$type<string[]>()
      .notNull()
      .default([]),
    skipReason: text("skip_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    uniqueIndex("touches_enrollment_step").on(
      t.organizationId,
      t.relationshipId,
      t.enrollmentId,
      t.stepNumber,
    ),
    uniqueIndex("touches_external_message")
      .on(t.organizationId, t.channel, t.externalMessageId)
      .where(sql`${t.externalMessageId} IS NOT NULL`),
    index().on(t.organizationId, t.productId, t.status, t.dueAt),
    check("touch_follow_up", sql`${t.followUp} BETWEEN 0 AND 3`),
    check(
      "touch_sent_report",
      sql`(${t.status} = 'sent') = (${t.sentAt} IS NOT NULL AND ${t.sentBy} IS NOT NULL)`,
    ),
    check(
      "touch_approval",
      sql`${t.status} <> 'approved' OR (${t.approvedHash} IS NOT NULL AND ${t.approvedHash} = ${t.draftHash})`,
    ),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [
        t.organizationId,
        t.productId,
        t.relationshipId,
        t.enrollmentId,
      ],
      foreignColumns: [
        enrollments.organizationId,
        enrollments.productId,
        enrollments.relationshipId,
        enrollments.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.senderId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.approvedBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.sentBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const contactRules = pgTable(
  "contact_rules",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id),
    cooldownDays: integer("cooldown_days").notNull(),
    dailyCapPerSender: integer("daily_cap_per_sender").notNull(),
    quietHoursStart: integer("quiet_hours_start").notNull(),
    quietHoursEnd: integer("quiet_hours_end").notNull(),
    version: version(),
  },
  (t) => [
    serverAccessPolicy(),
    check("contact_rules_cooldown", sql`${t.cooldownDays} BETWEEN 0 AND 365`),
    check("contact_rules_cap", sql`${t.dailyCapPerSender} BETWEEN 1 AND 10000`),
    check(
      "contact_rules_quiet_hours",
      sql`${t.quietHoursStart} BETWEEN 0 AND 23 AND ${t.quietHoursEnd} BETWEEN 0 AND 23`,
    ),
  ],
).enableRLS();
export const actions = pgTable(
  "actions",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    enrollmentId: uuid("enrollment_id"),
    ownerId: text("owner_id").notNull(),
    sourceConversationId: uuid("source_conversation_id"),
    kind: text("kind", {
      enum: ["reply", "approval", "review", "commitment", "research"],
    }).notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    reasonSource: text("reason_source"),
    owedBy: text("owed_by", { enum: ["us", "them", "unknown"] }).notNull(),
    channel: text("channel", {
      enum: ["gmail", "linkedin", "research"],
    }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["open", "completed", "blocked"] })
      .notNull()
      .default("open"),
    draft: text("draft").notNull().default(""),
    draftHash: text("draft_hash"),
    approvedHash: text("approved_hash"),
    approvedBy: text("approved_by"),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    index().on(t.organizationId, t.productId, t.status, t.dueAt),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.enrollmentId],
      foreignColumns: [
        enrollments.organizationId,
        enrollments.productId,
        enrollments.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.sourceConversationId],
      foreignColumns: [
        conversations.organizationId,
        conversations.productId,
        conversations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const providerConfigurations = pgTable(
  "provider_configurations",
  {
    id: id(),
    organizationId: organizationId(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider", { enum: ["unipile"] }).notNull(),
    encryptedCredentials: text("encrypted_credentials"),
    webhookReady: boolean("webhook_ready").notNull().default(false),
    active: boolean("active").notNull().default(true),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.ownerId, t.id),
    uniqueIndex("provider_configurations_active_owner")
      .on(t.organizationId, t.ownerId, t.provider)
      .where(sql`${t.active} = true`),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const connections = pgTable(
  "connections",
  {
    id: id(),
    organizationId: organizationId(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider", {
      enum: ["gmail", "unipile", "calendar", "fireflies"],
    }).notNull(),
    externalAccountId: text("external_account_id").notNull(),
    providerConfigurationId: uuid("provider_configuration_id"),
    productId: uuid("product_id"),
    displayName: text("display_name").notNull().default(""),
    encryptedCredentials: text("encrypted_credentials"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    syncCursor: jsonb("sync_cursor")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    errorCode: text("error_code"),
    leaseId: uuid("lease_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    webhookSecret: text("webhook_secret"),
    status: text("status").notNull().default("disconnected"),
    selfEmail: text("self_email"),
    inboxFolderIds: jsonb("inbox_folder_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    sentFolderIds: jsonb("sent_folder_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    unique().on(t.organizationId, t.id),
    unique().on(t.provider, t.providerConfigurationId, t.externalAccountId),
    uniqueIndex("connections_legacy_provider_account")
      .on(t.provider, t.externalAccountId)
      .where(sql`${t.providerConfigurationId} IS NULL`),
    foreignKey({
      columns: [t.organizationId, t.ownerId, t.providerConfigurationId],
      foreignColumns: [
        providerConfigurations.organizationId,
        providerConfigurations.ownerId,
        providerConfigurations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    connectionId: uuid("connection_id"),
    provenance: text("provenance", { enum: ["provider", "native"] })
      .notNull()
      .default("provider"),
    externalThreadId: text("external_thread_id").notNull(),
    ownerId: text("owner_id").notNull(),
    visibility: text("visibility", { enum: ["private", "product"] })
      .notNull()
      .default("private"),
    channel: text("channel", { enum: ["gmail", "linkedin"] }).notNull(),
  },
  (t) => [
    serverAccessPolicy(),
    check(
      "conversation_provenance",
      sql`(${t.provenance} = 'provider') = (${t.connectionId} IS NOT NULL)`,
    ),
    uniqueIndex("conversations_native_source")
      .on(t.organizationId, t.ownerId, t.channel, t.externalThreadId)
      .where(sql`${t.provenance} = 'native'`),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.connectionId, t.externalThreadId),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const messages = pgTable(
  "messages",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    conversationId: uuid("conversation_id").notNull(),
    connectionId: uuid("connection_id"),
    providerMessageId: text("provider_message_id").notNull(),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    body: text("body").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    uniqueIndex("messages_native_source")
      .on(t.conversationId, t.providerMessageId)
      .where(sql`${t.connectionId} IS NULL`),
    check("message_body_source", sql`${t.providerMessageId} <> ''`),
    index("messages_activity_idx").on(
      t.organizationId,
      t.productId,
      t.occurredAt,
      t.id,
    ),
    unique().on(t.connectionId, t.providerMessageId),
    foreignKey({
      columns: [t.organizationId, t.productId, t.conversationId],
      foreignColumns: [
        conversations.organizationId,
        conversations.productId,
        conversations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
  ],
).enableRLS();
// A durable claim is committed before calling a provider. Unknown outcomes never retry a send.
export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    ownerId: text("owner_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    touchId: uuid("touch_id"),
    actionId: uuid("action_id"),
    sourceVersion: integer("source_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    channel: text("channel", { enum: ["gmail", "linkedin"] }).notNull(),
    recipient: text("recipient").notNull(),
    draft: text("draft").notNull(),
    subject: text("subject").notNull().default(""),
    externalThreadId: text("external_thread_id"),
    externalMessageId: text("external_message_id"),
    status: text("status", {
      enum: ["sending", "unknown", "accepted", "sent", "failed"],
    }).notNull(),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.ownerId, t.idempotencyKey),
    uniqueIndex("deliveries_touch_claim")
      .on(t.touchId)
      .where(sql`${t.status} <> 'failed'`),
    uniqueIndex("deliveries_action_claim")
      .on(t.actionId, t.sourceVersion)
      .where(sql`${t.status} <> 'failed'`),
    index("deliveries_sender_day").on(t.organizationId, t.ownerId, t.createdAt),
    check(
      "delivery_source",
      sql`(${t.touchId} IS NOT NULL) <> (${t.actionId} IS NOT NULL)`,
    ),
    check(
      "delivery_status",
      sql`${t.status} IN ('sending', 'unknown', 'accepted', 'sent', 'failed')`,
    ),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.touchId],
      foreignColumns: [touches.organizationId, touches.productId, touches.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.actionId],
      foreignColumns: [actions.organizationId, actions.productId, actions.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const pipelines = pgTable(
  "pipelines",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.organizationId, t.productId, t.name),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
  ],
).enableRLS();
export const stages = pgTable(
  "stages",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    pipelineId: uuid("pipeline_id"),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    pipeline: text("pipeline", { enum: ["deal", "outreach"] })
      .notNull()
      .default("deal"),
    category: text("category", { enum: ["open", "won", "lost", "hold"] })
      .notNull()
      .default("open"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.productId, t.pipelineId],
      foreignColumns: [
        pipelines.organizationId,
        pipelines.productId,
        pipelines.id,
      ],
    }),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.organizationId, t.productId, t.id, t.pipeline),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
  ],
).enableRLS();
export const folders = pgTable(
  "folders",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.parentId],
      foreignColumns: [t.organizationId, t.productId, t.id],
    }),
    check(
      "folder_not_self_parent",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
  ],
).enableRLS();
export const assets = pgTable(
  "assets",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    folderId: uuid("folder_id").notNull(),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status", { enum: ["draft", "approved", "archived"] })
      .notNull()
      .default("draft"),
    version: version(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    foreignKey({
      columns: [t.organizationId, t.productId, t.folderId],
      foreignColumns: [folders.organizationId, folders.productId, folders.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.uploadedBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    check("asset_size_valid", sql`${t.size} > 0 AND ${t.size} <= 10485760`),
  ],
).enableRLS();
export const assetStages = pgTable(
  "asset_stages",
  {
    organizationId: organizationId(),
    productId: productId(),
    assetId: uuid("asset_id").notNull(),
    stageId: uuid("stage_id").notNull(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.assetId, t.stageId),
    foreignKey({
      columns: [t.organizationId, t.productId, t.assetId],
      foreignColumns: [assets.organizationId, assets.productId, assets.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.stageId],
      foreignColumns: [stages.organizationId, stages.productId, stages.id],
    }),
  ],
).enableRLS();
export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull(),
    source: text("source").notNull(),
    classification: text("classification", {
      enum: ["fact", "hypothesis"],
    }).notNull(),
    observedAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
  ],
).enableRLS();
export const meetings = pgTable(
  "meetings",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    status: text("status", {
      enum: ["scheduled", "held", "canceled"],
    }).notNull(),
    summary: text("summary").notNull().default(""),
    proposedCommitment: text("proposed_commitment"),
    commitmentActionId: uuid("commitment_action_id"),
    version: version(),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.commitmentActionId],
      foreignColumns: [actions.organizationId, actions.productId, actions.id],
    }),
  ],
).enableRLS();
export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    name: text("name").notNull(),
    amountMinor: integer("amount_minor"),
    currency: text("currency").notNull().default("USD"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    ownerId: text("owner_id"),
    status: text("status", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    probability: integer("probability"),
    expectedCloseDate: date("expected_close_date"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    description: text("description").notNull().default(""),
    lostReason: text("lost_reason").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    version: version(),
  },
  (t) => [
    serverAccessPolicy(),
    check(
      "deal_amount_nonnegative",
      sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`,
    ),
    check(
      "deal_probability_valid",
      sql`${t.probability} IS NULL OR (${t.probability} >= 0 AND ${t.probability} <= 100)`,
    ),
    check("deal_status_valid", sql`${t.status} IN ('open', 'won', 'lost')`),
    check("deal_currency_valid", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.stageId],
      foreignColumns: [stages.organizationId, stages.productId, stages.id],
    }),
  ],
).enableRLS();
export const changeEvents = pgTable(
  "change_events",
  {
    id: id(),
    organizationId: organizationId(),
    productId: uuid("product_id"),
    sourceConversationId: uuid("source_conversation_id"),
    actorId: text("actor_id").notNull(),
    type: text("type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    index().on(t.organizationId, t.createdAt),
    foreignKey({
      columns: [t.organizationId, t.productId, t.sourceConversationId],
      foreignColumns: [
        conversations.organizationId,
        conversations.productId,
        conversations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
  ],
).enableRLS();

export const mcpGrants = pgTable(
  "mcp_grants",
  {
    id: id(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    productIds: jsonb("product_ids").$type<string[]>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const oauthSelections = pgTable(
  "oauth_selections",
  {
    sessionId: text("session_id").notNull(),
    flowKey: text("flow_key").notNull(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => mcpGrants.id),
  },
  (t) => [
    serverAccessPolicy(),
    primaryKey({ columns: [t.sessionId, t.flowKey] }),
  ],
).enableRLS();
export const connectorEvents = pgTable(
  "connector_events",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: uuid("connection_id").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "processed", "unmatched"] })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.connectionId, t.providerEventId),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
  ],
).enableRLS();

export const integrationFlows = pgTable(
  "integration_flows",
  {
    id: id(),
    stateHash: text("state_hash").notNull().unique(),
    organizationId: organizationId(),
    productId: productId(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider").notNull(),
    encryptedVerifier: text("encrypted_verifier").notNull(),
    connectionId: uuid("connection_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
  ],
).enableRLS();
export const integrationItems = pgTable(
  "integration_items",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    connectionId: uuid("connection_id").notNull(),
    externalId: text("external_id").notNull(),
    record: jsonb("record")
      .$type<import("../connectors/types").ImportRecord>()
      .notNull(),
    status: text("status", { enum: ["unmatched", "matched", "ignored"] })
      .notNull()
      .default("unmatched"),
    relationshipId: uuid("relationship_id"),
    entityId: uuid("entity_id"),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.connectionId, t.externalId),
    index().on(t.organizationId, t.connectionId, t.status),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
  ],
).enableRLS();

export const integrationReceipts = pgTable(
  "integration_receipts",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: uuid("connection_id").notNull(),
    externalId: text("external_id").notNull(),
    provider: text("provider", { enum: ["unipile", "fireflies"] }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.connectionId, t.externalId),
    index().on(t.processedAt, t.nextAttemptAt),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
  ],
).enableRLS();

export const fileEntry = pgTable(
  "file_entry",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    parentId: uuid("parent_id"),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    visibility: text("visibility").notNull().default("private"),
    grants: jsonb("grants")
      .$type<import("../files/validators").FileGrant[]>()
      .notNull()
      .default([]),
    publicToken: text("public_token").notNull(),
    body: text("body"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    syncId: integer("sync_id").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    serverAccessPolicy(),
    unique("file_entry_scope_id").on(t.organizationId, t.productId, t.id),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.parentId],
      foreignColumns: [t.organizationId, t.productId, t.id],
    }).onDelete("cascade"),
    index("file_entry_parent_idx").on(
      t.organizationId,
      t.productId,
      t.parentId,
    ),
    uniqueIndex("file_entry_name_unique").on(
      t.organizationId,
      t.productId,
      sql`coalesce(${t.parentId}::text, '')`,
      t.ownerId,
      sql`lower(${t.name})`,
    ),
    uniqueIndex("file_entry_public_token_unique").on(t.publicToken),
    check("file_entry_kind", sql`${t.kind} in ('folder','markdown','file')`),
    check(
      "file_entry_visibility",
      sql`${t.visibility} in ('private','workspace','public','shared','inherit')`,
    ),
    check(
      "file_entry_inherit_parent",
      sql`${t.visibility} <> 'inherit' or ${t.parentId} is not null`,
    ),
    check(
      "file_entry_no_self_parent",
      sql`${t.parentId} is distinct from ${t.id}`,
    ),
    check("file_entry_size", sql`${t.size} between 0 and 104857600`),
  ],
).enableRLS();
export const fileUpload = pgTable(
  "file_upload",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    ownerId: text("owner_id").notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.parentId],
      foreignColumns: [
        fileEntry.organizationId,
        fileEntry.productId,
        fileEntry.id,
      ],
    }).onDelete("cascade"),
    check("file_upload_size", sql`${t.size} between 0 and 104857600`),
  ],
).enableRLS();

export const internalTasks = pgTable(
  "internal_tasks",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id"),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    timeZone: text("time_zone").notNull(),
    recurrence: jsonb("recurrence").$type<{
      frequency: "daily" | "weekly" | "monthly";
      interval: number;
      anchorDay: number;
    }>(),
    status: text("status", { enum: ["open", "completed"] })
      .notNull()
      .default("open"),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    index().on(t.organizationId, t.productId, t.status, t.dueAt),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();

// Yodu's backend bridge is product-scoped. A signed receipt attests only what
// the configured backend asserted; it is not independent payment verification.
export const yoduSources = pgTable(
  "yodu_sources",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    encryptedSecret: text("encrypted_secret").notNull(),
    createdBy: text("created_by").notNull(),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.createdBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const yoduBindings = pgTable(
  "yodu_bindings",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    sourceId: uuid("source_id").notNull(),
    externalSubjectId: text("external_subject_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    createdBy: text("created_by").notNull(),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.sourceId, t.externalSubjectId),
    foreignKey({
      columns: [t.organizationId, t.productId, t.sourceId],
      foreignColumns: [
        yoduSources.organizationId,
        yoduSources.productId,
        yoduSources.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.createdBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
).enableRLS();
export const yoduEvents = pgTable(
  "yodu_events",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    sourceId: uuid("source_id").notNull(),
    externalSubjectId: text("external_subject_id").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    kind: text("kind", {
      enum: ["signup", "onboarding", "payment", "activation"],
    }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    sourceVersion: integer("source_version").notNull(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.sourceId, t.providerEventId),
    index("yodu_events_product_received").on(
      t.organizationId,
      t.productId,
      t.receivedAt,
      t.id,
    ),
    foreignKey({
      columns: [t.organizationId, t.productId, t.sourceId],
      foreignColumns: [
        yoduSources.organizationId,
        yoduSources.productId,
        yoduSources.id,
      ],
    }),
    check(
      "yodu_event_kind",
      sql`${t.kind} IN ('signup', 'onboarding', 'payment', 'activation')`,
    ),
    check("yodu_event_hash", sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
    check("yodu_event_source_version", sql`${t.sourceVersion} > 0`),
  ],
).enableRLS();

export const nativeDrafts = pgTable(
  "native_drafts",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sourceConversationId: uuid("source_conversation_id").notNull(),
    channel: text("channel", { enum: ["gmail", "linkedin"] }).notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull().default(""),
    body: text("body").notNull(),
    sourceId: text("source_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    scheduledActionId: uuid("scheduled_action_id"),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.productId, t.id),
    uniqueIndex("native_drafts_source").on(
      t.organizationId,
      t.ownerId,
      t.sourceId,
    ),
    check("native_draft_source_hash", sql`${t.sourceHash} ~ '^[a-f0-9]{64}$'`),
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.sourceConversationId],
      foreignColumns: [
        conversations.organizationId,
        conversations.productId,
        conversations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.productId, t.scheduledActionId],
      foreignColumns: [actions.organizationId, actions.productId, actions.id],
    }),
  ],
).enableRLS();
