import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { integrationAvailability } from "../connectors/service";
import { publishChange } from "../core/changes";
import {
  actionChangeSchema,
  CrmService,
  folderSchema,
  meetingChangeSchema,
  messageActivitySchema,
  opportunitySchema,
  personSchema,
  pipelineSchema,
  scheduleActionSchema,
} from "../core/crm";
import {
  authorize,
  DomainError,
  grantedProductIds,
  type Principal,
} from "../core/policy";
import type { Database } from "../database/client";
import { mcpGrants, oauthClient, session } from "../database/schema";
import { downloadAsset, uploadAsset } from "../storage/files";

// Call only after the OAuth library has verified signature, issuer, audience and scope.
export async function principalForVerifiedToken(db: Database, claims: unknown) {
  const identity = z
    .object({
      sub: z.string(),
      crm_grant_id: z.uuid(),
      client_id: z.string(),
      sid: z.string(),
      scope: z.string().default(""),
    })
    .safeParse(claims);
  if (!identity.success) throw new DomainError("UNAUTHORIZED", 401);
  const [client] = await db
    .select()
    .from(oauthClient)
    .where(eq(oauthClient.clientId, identity.data.client_id));
  const [activeSession] = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, identity.data.sid),
        eq(session.userId, identity.data.sub),
        gt(session.expiresAt, new Date()),
      ),
    );
  if (!client || client.disabled || !activeSession)
    throw new DomainError("UNAUTHORIZED", 401);
  const principal = await principalForGrant(
    db,
    identity.data.sub,
    identity.data.crm_grant_id,
  );
  // Only a cryptographically verified OAuth scope can enable writes. Legacy grants remain read-only.
  return {
    ...principal,
    readOnly: !identity.data.scope.split(" ").includes("crm:write"),
  };
}

export async function principalForGrant(
  db: Database,
  userId: string,
  grantId: string,
): Promise<Principal> {
  const [grant] = await db
    .select()
    .from(mcpGrants)
    .where(
      and(
        eq(mcpGrants.id, grantId),
        eq(mcpGrants.userId, userId),
        eq(mcpGrants.active, true),
      ),
    );
  if (!grant) throw new DomainError("FORBIDDEN", 403);
  const principal: Principal = {
    userId,
    organizationId: grant.organizationId,
    productIds: grantedProductIds(grant.productIds),
    source: "mcp",
    readOnly: true,
  };
  await authorize(db, principal, grant.organizationId);
  return principal;
}
export function mcpHandler(
  db: Database,
  principal: Principal,
  organizationId: string,
) {
  const service = new CrmService(db);
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  return createMcpHandler(
    () => {
      const server = new McpServer({
        name: "gravity-by-noveum",
        version: "0.1.0",
      });
      server.registerTool(
        "get_me",
        {
          description:
            "Read the current identity and immutable organization/product grant.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        async () =>
          result({
            userId: principal.userId,
            organizationId,
            productIds: principal.productIds,
            permissions:
              principal.readOnly === false
                ? ["crm:read", "crm:write"]
                : ["crm:read"],
            allProducts: principal.productIds === undefined,
          }),
      );
      server.registerTool(
        "get_capabilities",
        {
          description:
            "Discover implemented operations and explicit integration gaps.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        async () => {
          const { membership } = await authorize(db, principal, organizationId);
          return result({
            readContext: true,
            readCompanyContext: true,
            readMaterials: true,
            readSalesAnalytics: true,
            writeDeals: principal.readOnly === false,
            materialPdfExtraction: false,
            sendMessages: false,
            approveDrafts: principal.readOnly === false,
            writeRecords: principal.readOnly === false,
            createProducts:
              principal.readOnly === false &&
              principal.productIds === undefined &&
              membership.role === "admin",
            gmailSync: integrationAvailability().gmail,
            linkedinSync: integrationAvailability().linkedin,
            calendarSync: integrationAvailability().calendar,
            firefliesSync: integrationAvailability().fireflies,
            accountConnectionRequired: true,
            integrationManagement: "human-only",
            syncCadence: "scheduled-five-minute-pages",
            organizationBound: true,
          });
        },
      );
      server.registerTool(
        "list_products",
        {
          description:
            "List products readable under this grant and current membership.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        async () =>
          result((await authorize(db, principal, organizationId)).products),
      );
      server.registerTool(
        "list_next_actions",
        {
          description: "Read pending actions without executing them.",
          inputSchema: z.object({ productId: z.uuid().optional() }),
          annotations: { readOnlyHint: true },
        },
        async ({ productId }) =>
          result(
            (
              await service.snapshot(principal, { organizationId, productId })
            ).actions.filter((action) => action.status !== "completed"),
          ),
      );
      server.registerTool(
        "search_records",
        {
          description:
            "Search readable people and companies in the selected products.",
          inputSchema: z.object({
            query: z.string().min(1).max(200),
            productId: z.uuid().optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        async ({ query, productId }) => {
          const snapshot = await service.snapshot(principal, {
            organizationId,
            productId,
          });
          const term = query.toLowerCase();
          return result({
            people: snapshot.people.filter((p) =>
              `${p.name} ${p.title} ${p.email ?? ""}`
                .toLowerCase()
                .includes(term),
            ),
            companies: snapshot.companies.filter((c) =>
              `${c.name} ${c.domain ?? ""}`.toLowerCase().includes(term),
            ),
            relationships: snapshot.relationships,
            asOf: snapshot.asOf,
          });
        },
      );
      server.registerTool(
        "get_company_context",
        {
          description:
            "Read a company and its permitted contacts, relationships and related work.",
          inputSchema: z.object({
            companyId: z.uuid(),
            productId: z.uuid().optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        async ({ companyId, productId }) =>
          result(
            await service.companyContext(
              principal,
              { organizationId, productId },
              companyId,
            ),
          ),
      );
      server.registerTool(
        "get_person_context",
        {
          description:
            "Read a product relationship, permitted conversation, evidence, actions, and coverage gaps. Missing history is not evidence of no history.",
          inputSchema: z.object({ relationshipId: z.uuid() }),
          annotations: { readOnlyHint: true },
        },
        async ({ relationshipId }) =>
          result(
            await service.context(principal, organizationId, relationshipId),
          ),
      );
      server.registerTool(
        "list_materials",
        {
          description:
            "Find product materials and stage associations. Draft materials need human review before use.",
          inputSchema: z.object({
            productId: z.uuid(),
            stageId: z.uuid().optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        async ({ productId, stageId }) => {
          const snapshot = await service.snapshot(principal, {
            organizationId,
            productId,
          });
          return result({
            folders: snapshot.folders,
            assets: snapshot.assets.filter(
              (asset) =>
                !stageId ||
                snapshot.assetStages.some(
                  (link) =>
                    link.assetId === asset.id && link.stageId === stageId,
                ),
            ),
            stageAssociations: snapshot.assetStages,
          });
        },
      );
      server.registerTool(
        "read_material",
        {
          description:
            "Read a private text/Markdown material with its source ID and version. PDF text extraction is not implemented.",
          inputSchema: z.object({ assetId: z.uuid() }),
          annotations: { readOnlyHint: true },
        },
        async ({ assetId }) => {
          const { asset, bytes } = await downloadAsset(
            db,
            principal,
            organizationId,
            assetId,
          );
          if (!asset.mimeType.startsWith("text/"))
            return result({
              assetId,
              name: asset.name,
              version: asset.version,
              status: asset.status,
              contentAvailable: false,
              reason: "PDF_EXTRACTION_NOT_IMPLEMENTED",
            });
          return result({
            assetId,
            name: asset.name,
            version: asset.version,
            status: asset.status,
            sha256: asset.sha256,
            text: new TextDecoder().decode(bytes.subarray(0, 50000)),
            truncated: bytes.length > 50000,
          });
        },
      );
      server.registerTool(
        "get_workspace",
        {
          description:
            "Read permitted CRM records, relationships, sequences, meetings, materials and versions. Organization and product restrictions apply.",
          inputSchema: z.object({ productId: z.uuid().optional() }),
          annotations: { readOnlyHint: true },
        },
        async ({ productId }) =>
          result(
            await service.snapshot(principal, { organizationId, productId }),
          ),
      );
      server.registerTool(
        "get_overview",
        {
          description:
            "Read live sales and outreach analytics: current pipeline and pending follow-ups, period message counts, won/lost outcomes, team activity and missing deal fields. Currencies are separate; drafts are not sent messages.",
          inputSchema: z.object({
            productId: z.uuid().optional(),
            days: z
              .union([z.literal(7), z.literal(30), z.literal(90)])
              .default(30),
            ownerId: z.string().optional(),
            channel: z.enum(["gmail", "linkedin"]).optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        async (input) =>
          result(
            await service.overview(principal, { ...input, organizationId }),
          ),
      );
      server.registerTool(
        "get_message_activity",
        {
          description:
            "Page through synced message activity behind analytics, respecting product and private conversation access. Times use the organization's timezone.",
          inputSchema: z
            .object(messageActivitySchema.shape)
            .omit({ organizationId: true }),
          annotations: { readOnlyHint: true },
        },
        async (input) =>
          result(
            await service.messageActivity(
              principal,
              messageActivitySchema.parse({ ...input, organizationId }),
            ),
          ),
      );
      if (principal.readOnly === false) {
        const changed = async (operation: Promise<unknown>) => {
          const value = await operation;
          publishChange(organizationId);
          return result(value);
        };
        server.registerTool(
          "save_deal",
          {
            description:
              "Create or update a deal with value, currency, owner, probability, expected close date, stage, outcome and context. Updates require the current ID and version; the product and relationship cannot be moved.",
            inputSchema: z
              .object(opportunitySchema.shape)
              .omit({ organizationId: true }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          async (input) =>
            changed(
              service.saveOpportunity(
                principal,
                opportunitySchema.parse({ ...input, organizationId }),
              ),
            ),
        );
        server.registerTool(
          "create_pipeline",
          {
            description:
              "Create a separate product sales pipeline with open, won and lost stages. Requires organization admin access to that product.",
            inputSchema: pipelineSchema.omit({ organizationId: true }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          async (input) =>
            changed(
              service.createPipeline(principal, { ...input, organizationId }),
            ),
        );
        server.registerTool(
          "create_person",
          {
            description:
              "Create a person and product relationship, or add an existing person to a product. Optionally create a research task.",
            inputSchema: z
              .object(personSchema.shape)
              .omit({ organizationId: true }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          async (input) =>
            changed(
              service.createPerson(
                principal,
                personSchema.parse({ ...input, organizationId }),
              ),
            ),
        );
        server.registerTool(
          "schedule_next_action",
          {
            description:
              "Schedule a next action for a product relationship and assign its owner. This does not send a message.",
            inputSchema: scheduleActionSchema.omit({ organizationId: true }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          async (input) =>
            changed(
              service.scheduleAction(principal, { ...input, organizationId }),
            ),
        );
        server.registerTool(
          "change_action",
          {
            description:
              "Save a draft, approve, complete, or reopen an action using its current version. Approval is bound to the draft, recipient and channel; editing invalidates it. No messages are sent.",
            inputSchema: actionChangeSchema.omit({ organizationId: true }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          async (input) =>
            changed(
              service.changeAction(principal, { ...input, organizationId }),
            ),
        );
        server.registerTool(
          "accept_meeting_commitment",
          {
            description:
              "Turn a proposed commitment from a held meeting into an assigned follow-up. Supply the current meeting version.",
            inputSchema: meetingChangeSchema.omit({ organizationId: true }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          async (input) =>
            changed(
              service.acceptCommitment(principal, { ...input, organizationId }),
            ),
        );
        server.registerTool(
          "create_material_folder",
          {
            description:
              "Create a product sales-material folder, optionally inside another folder in that product.",
            inputSchema: folderSchema.omit({ organizationId: true }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          async (input) =>
            changed(
              service.createFolder(principal, { ...input, organizationId }),
            ),
        );
        server.registerTool(
          "create_material",
          {
            description:
              "Upload a private plain-text or Markdown sales material into a product folder, with optional sales-stage associations. Content is stored as a draft for review.",
            inputSchema: z.object({
              productId: z.uuid(),
              folderId: z.uuid(),
              stageIds: z.array(z.uuid()).max(100).default([]),
              name: z.string().trim().min(1).max(200),
              mimeType: z
                .enum(["text/plain", "text/markdown"])
                .default("text/markdown"),
              content: z.string().min(1).max(200000),
            }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          async ({ content, ...input }) =>
            changed(
              uploadAsset(db, principal, {
                ...input,
                organizationId,
                bytes: new TextEncoder().encode(content),
              }),
            ),
        );
        server.registerTool(
          "create_product",
          {
            description:
              "Create a product with its default sales stages and material folder. Requires organization admin membership and an all-products grant.",
            inputSchema: z.object({ name: z.string().trim().min(1).max(100) }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          async ({ name }) =>
            changed(service.createProduct(principal, organizationId, name)),
        );
      }
      return server;
    },
    { legacy: "stateless" },
  );
}
