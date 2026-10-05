import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { integrationAvailability } from "../connectors/service";
import { CrmService } from "../core/crm";
import { errorResponse } from "../core/http";
import {
  authorize,
  DomainError,
  grantedProductIds,
  type Principal,
} from "../core/policy";
import type { Database } from "../database/client";
import { mcpGrants, oauthClient, session } from "../database/schema";
import t from "../i18n/translations/en.json";
import {
  executeMcpOperation,
  operationAvailable,
  operationInput,
  operationRequirements,
  operations,
  permissionAudit,
} from "../operations/catalog";
import { downloadAsset } from "../storage/files";
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
    canSend:
      identity.data.scope.split(" ").includes("crm:send") &&
      identity.data.scope.split(" ").includes("crm:write"),
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
      const server = new McpServer(
        {
          name: "gravity-by-noveum",
          version: "0.3.0",
        },
        { instructions: t.mcpInstructions },
      );
      const writable = principal.readOnly === false;
      const canSend = writable && principal.canSend === true;
      server.registerResource(
        "agent-guide",
        "gravity://agent-guide",
        { mimeType: "text/plain", description: t.mcpInstructions },
        async (uri) => {
          await authorize(db, principal, organizationId);
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "text/plain",
                text: t.mcpInstructions,
              },
            ],
          };
        },
      );
      server.registerResource(
        "permissions",
        "gravity://permissions",
        {
          mimeType: "application/json",
          description:
            "Effective permissions and the complete business-operation catalog.",
        },
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                await permissionAudit({ db, principal }, organizationId),
              ),
            },
          ],
        }),
      );
      for (const [name, key] of [
        ["daily-triage", "triage"],
        ["manage-sequence", "sequence"],
        ["configure-connections", "connections"],
        ["send-approved-message", "send"],
      ] as const) {
        server.registerPrompt(
          name,
          { description: t.mcpPromptDescriptions[key] },
          async () => {
            await authorize(db, principal, organizationId);
            return {
              messages: [
                {
                  role: "user" as const,
                  content: {
                    type: "text" as const,
                    text: `${t.mcpInstructions}\n\n${t.mcpPrompts[key]}`,
                  },
                },
              ],
            };
          },
        );
      }
      for (const operation of operations) {
        if (operation.method !== "GET" && !writable) continue;
        server.registerTool(
          operation.name,
          {
            description: operation.description,
            inputSchema: operationInput(operation),
            annotations: {
              readOnlyHint: operation.method === "GET",
              destructiveHint: operation.destructive,
              idempotentHint: operation.idempotent,
            },
          },
          async (input) => {
            try {
              return result(
                await executeMcpOperation(
                  operation,
                  { db, principal },
                  organizationId,
                  input,
                ),
              );
            } catch (error) {
              return {
                ...result(await errorResponse(error).json()),
                isError: true,
              };
            }
          },
        );
      }
      server.registerTool(
        "get_me",
        {
          description:
            "Read the current identity, immutable organization/product grant and verified OAuth permissions.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        async () => {
          await authorize(db, principal, organizationId);
          return result({
            userId: principal.userId,
            organizationId,
            productIds: principal.productIds,
            permissions: [
              "crm:read",
              ...(writable ? ["crm:write"] : []),
              ...(canSend ? ["crm:send"] : []),
            ],
            allProducts: principal.productIds === undefined,
          });
        },
      );
      server.registerTool(
        "get_capabilities",
        {
          description:
            "Discover every platform operation, its HTTP mapping and write availability. New business APIs automatically become MCP tools through the shared registry.",
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
            writeDeals: writable,
            writeRecords: writable,
            manageSequences: writable,
            manageOutreach: writable,
            manageIntegrations: writable,
            approveDrafts: writable,
            createProducts:
              writable &&
              principal.productIds === undefined &&
              membership.role === "admin",
            materialPdfExtraction: false,
            contractDocuments: true,
            contractSigningWorkflow: false,
            sendMessages: canSend,
            sendChannels: ["gmail", "linkedin"],
            explicitSendRequired: true,
            calendarEventWrites: false,
            messageAttachments: false,
            serverInstructions: true,
            prompts: [
              "daily-triage",
              "manage-sequence",
              "configure-connections",
              "send-approved-message",
            ],
            resources: ["gravity://agent-guide", "gravity://permissions"],
            gmailSync: integrationAvailability().gmail,
            linkedinSync: integrationAvailability().linkedin,
            calendarSync: integrationAvailability().calendar,
            firefliesSync: integrationAvailability().fireflies,
            integrationManagement: "owner-scoped-api-and-mcp",
            accountConnectionRequired: true,
            providerConsentRequired: true,
            organizationBound: true,
            sharedApiRegistry: true,
            operations: operations.map((operation) => ({
              name: operation.name,
              api: `/api/${operation.api}`,
              method: operation.method,
              operation: operation.operation,
              available: operationAvailable(
                operation,
                principal,
                membership.role,
              ),
              requirements: operationRequirements(operation),
              description: operation.description,
            })),
            protocolEndpoints: [
              "authentication",
              "OAuth consent and callbacks",
              "signed provider webhooks",
              "private cron dispatch",
              "browser workspace cookies",
              "SSE change transport",
            ],
          });
        },
      );
      server.registerTool(
        "list_products",
        {
          description:
            "List products permitted by the grant and current membership.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        async () =>
          result((await authorize(db, principal, organizationId)).products),
      );
      server.registerTool(
        "list_next_actions",
        {
          description: "Read pending next actions without executing them.",
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
            "Search permitted people and companies across the selected products.",
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
        "list_materials",
        {
          description:
            "Find permitted product folders, materials and stage associations.",
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
            "Read private text/Markdown material with source/version. PDF text extraction is not implemented; download_material returns PDF bytes.",
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
      // Preserve the original text-material tool while all file types use the shared upload operation.
      if (writable)
        server.registerTool(
          "create_material",
          {
            description:
              "Upload a private plain-text or Markdown draft to a product folder. Use upload_material for PDF/base64 files.",
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
          async ({ content, ...input }) => {
            const operation = operations.find(
              (item) => item.name === "upload_material",
            );
            if (!operation) throw new DomainError("INTERNAL_ERROR", 500);
            return result(
              await executeMcpOperation(
                operation,
                { db, principal },
                organizationId,
                {
                  ...input,
                  dataBase64: Buffer.from(content, "utf8").toString("base64"),
                },
              ),
            );
          },
        );
      return server;
    },
    { legacy: "stateless" },
  );
}
