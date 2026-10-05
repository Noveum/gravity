import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    timezone: text("timezone").notNull().default("UTC"),
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
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.name),
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
  },
  (t) => [serverAccessPolicy(), unique().on(t.organizationId, t.id)],
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
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
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
  },
  (t) => [
    serverAccessPolicy(),
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.organizationId, t.productId, t.personId, t.purpose),
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
    connectionId: uuid("connection_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    ownerId: text("owner_id").notNull(),
    visibility: text("visibility", { enum: ["private", "product"] })
      .notNull()
      .default("private"),
    channel: text("channel", { enum: ["gmail", "linkedin"] }).notNull(),
  },
  (t) => [
    serverAccessPolicy(),
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
    connectionId: uuid("connection_id").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    body: text("body").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    serverAccessPolicy(),
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
export const stages = pgTable(
  "stages",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
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
