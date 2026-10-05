import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { integrationAvailability } from "../connectors/service";
import { CrmService } from "../core/crm";
import { authorize, DomainError, type Principal } from "../core/policy";
import type { Database } from "../database/client";
import { mcpGrants, oauthClient, session } from "../database/schema";
import { downloadAsset } from "../storage/files";

// Call only after the OAuth library has verified signature, issuer, audience and scope.
export async function principalForVerifiedToken(db: Database, claims: unknown) {
  const identity = z
    .object({
      sub: z.string(),
      crm_grant_id: z.uuid(),
      client_id: z.string(),
      sid: z.string(),
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
  return principalForGrant(db, identity.data.sub, identity.data.crm_grant_id);
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
    productIds: grant.productIds,
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
            permissions: ["crm:read"],
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
        async () =>
          result({
            readContext: true,
            readCompanyContext: true,
            readMaterials: true,
            materialPdfExtraction: false,
            sendMessages: false,
            approveDrafts: false,
            gmailSync: integrationAvailability().gmail,
            linkedinSync: integrationAvailability().linkedin,
            calendarSync: integrationAvailability().calendar,
            firefliesSync: integrationAvailability().fireflies,
            accountConnectionRequired: true,
            integrationManagement: "human-only",
            syncCadence: "scheduled-five-minute-pages",
            organizationBound: true,
          }),
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
        async ({ companyId, productId }) => {
          const context = await service.companyContext(
            principal,
            { organizationId, productId },
            companyId,
          );
          if (context.company.archivedAt)
            throw new DomainError("NOT_FOUND", 404);
          return result(context);
        },
      );
      server.registerTool(
        "get_person_context",
        {
          description:
            "Read a product relationship, permitted conversation, evidence, actions, and coverage gaps. Missing history is not evidence of no history.",
          inputSchema: z.object({ relationshipId: z.uuid() }),
          annotations: { readOnlyHint: true },
        },
        async ({ relationshipId }) => {
          const context = await service.context(
            principal,
            organizationId,
            relationshipId,
          );
          if (context.person?.archivedAt)
            throw new DomainError("NOT_FOUND", 404);
          return result(context);
        },
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
      return server;
    },
    { legacy: "stateless" },
  );
}
