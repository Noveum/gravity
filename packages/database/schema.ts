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
  uuid,
} from "drizzle-orm/pg-core";

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

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: createdAt(),
});
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
  (t) => [unique().on(t.organizationId, t.userId)],
);
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
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.name),
  ],
);
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
);
export const companies = pgTable(
  "companies",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    domain: text("domain"),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.organizationId, t.id)],
);
export const people = pgTable(
  "people",
  {
    id: id(),
    organizationId: organizationId(),
    companyId: uuid("company_id"),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    email: text("email"),
    summary: text("summary").notNull().default(""),
    createdAt: createdAt(),
    version: version(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
  ],
);
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
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.productId, t.id),
    unique().on(t.organizationId, t.productId, t.personId, t.purpose),
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
);
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
        }[]
      >()
      .notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.productId, t.id),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
  ],
);
export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    relationshipId: uuid("relationship_id").notNull(),
    sequenceId: uuid("sequence_id").notNull(),
    status: text("status", {
      enum: ["running", "paused_reply", "completed", "stopped"],
    }).notNull(),
    step: integer("step").notNull().default(1),
    version: version(),
  },
  (t) => [
    unique().on(t.organizationId, t.productId, t.id),
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
);
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
);
export const connections = pgTable(
  "connections",
  {
    id: id(),
    organizationId: organizationId(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider", { enum: ["gmail", "unipile"] }).notNull(),
    externalAccountId: text("external_account_id").notNull(),
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
    unique().on(t.organizationId, t.id),
    unique().on(t.provider, t.externalAccountId),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
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
);
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
);
export const stages = pgTable(
  "stages",
  {
    id: id(),
    organizationId: organizationId(),
    productId: productId(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.productId, t.id),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
  ],
);
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
);
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
);
export const assetStages = pgTable(
  "asset_stages",
  {
    organizationId: organizationId(),
    productId: productId(),
    assetId: uuid("asset_id").notNull(),
    stageId: uuid("stage_id").notNull(),
  },
  (t) => [
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
);
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
    foreignKey({
      columns: [t.organizationId, t.productId, t.relationshipId],
      foreignColumns: [
        relationships.organizationId,
        relationships.productId,
        relationships.id,
      ],
    }),
  ],
);
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
);
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
);
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
);

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
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const oauthSelections = pgTable(
  "oauth_selections",
  {
    sessionId: text("session_id").notNull(),
    flowKey: text("flow_key").notNull(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => mcpGrants.id),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.flowKey] })],
);
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
    unique().on(t.connectionId, t.providerEventId),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
  ],
);
