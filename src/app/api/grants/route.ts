import { flowKey } from "@crm/auth/flow";
import {
  assertMutationOrigin,
  currentPrincipal,
  getAuth,
} from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import {
  allProductsGrant,
  authorize,
  DomainError,
  grantedProductIds,
  isAllProductsGrant,
} from "@crm/core/policy";
import { getDatabase } from "@crm/database/client";
import {
  mcpGrants,
  oauthClient,
  oauthSelections,
  organizations,
} from "@crm/database/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new DomainError("UNAUTHORIZED", 401);
    const query = z
      .string()
      .min(1)
      .max(10000)
      .parse(new URL(request.url).searchParams.get("oauth_query"));
    const params = new URLSearchParams(query);
    const db = await getDatabase();
    const [selection] = await db
      .select({ grant: mcpGrants, organization: organizations })
      .from(oauthSelections)
      .innerJoin(mcpGrants, eq(oauthSelections.grantId, mcpGrants.id))
      .innerJoin(organizations, eq(mcpGrants.organizationId, organizations.id))
      .where(
        and(
          eq(oauthSelections.sessionId, session.session.id),
          eq(oauthSelections.flowKey, flowKey(query)),
          eq(mcpGrants.userId, session.user.id),
          eq(mcpGrants.active, true),
        ),
      );
    if (!selection) throw new DomainError("NOT_FOUND", 404);
    const { products } = await authorize(
      db,
      {
        userId: session.user.id,
        source: "mcp",
        organizationId: selection.grant.organizationId,
        productIds: grantedProductIds(selection.grant.productIds),
        readOnly: true,
      },
      selection.grant.organizationId,
    );
    const [client] = await db
      .select({ name: oauthClient.name })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, params.get("client_id") ?? ""));
    return Response.json(
      {
        organization: selection.organization.name,
        allProducts: isAllProductsGrant(selection.grant.productIds),
        products: products.map((p) => p.name),
        clientName: client?.name ?? params.get("client_id"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new DomainError("UNAUTHORIZED", 401);
    const body = z
      .object({
        organizationId: z.uuid(),
        productIds: z.array(z.uuid()).max(100),
        allProducts: z.boolean().default(false),
        oauth_query: z.string().min(1).max(10000),
      })
      .parse(
        JSON.parse(new TextDecoder().decode(await limitedBody(request, 20000))),
      );
    const db = await getDatabase();
    const principal = { userId: session.user.id, source: "session" as const };
    const { products } = await authorize(db, principal, body.organizationId);
    if (
      (!body.allProducts && !body.productIds.length) ||
      body.productIds.some(
        (id) => !products.some((product) => product.id === id),
      )
    )
      throw new DomainError("FORBIDDEN", 403);
    const grant = await db.transaction(async (tx) => {
      const [grant] = await tx
        .insert(mcpGrants)
        .values({
          organizationId: body.organizationId,
          productIds: body.allProducts ? allProductsGrant : body.productIds,
          userId: principal.userId,
        })
        .returning();
      await tx
        .insert(oauthSelections)
        .values({
          sessionId: session.session.id,
          grantId: grant.id,
          flowKey: flowKey(body.oauth_query),
        })
        .onConflictDoUpdate({
          target: [oauthSelections.sessionId, oauthSelections.flowKey],
          set: { grantId: grant.id },
        });
      return grant;
    });
    return Response.json({ grantId: grant.id });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const db = await getDatabase();
    const body = z
      .object({ grantId: z.uuid() })
      .parse(
        JSON.parse(new TextDecoder().decode(await limitedBody(request, 2000))),
      );
    const [grant] = await db
      .update(mcpGrants)
      .set({ active: false })
      .where(
        and(
          eq(mcpGrants.id, body.grantId),
          eq(mcpGrants.userId, principal.userId),
        ),
      )
      .returning();
    if (!grant) throw new DomainError("NOT_FOUND", 404);
    return Response.json({ revoked: true });
  } catch (error) {
    return errorResponse(error);
  }
}
