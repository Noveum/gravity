import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { jwt } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { DomainError } from "../core/policy";
import type { Database } from "../database/client";
import { mcpGrants, oauthSelections } from "../database/schema";
import { currentFlowKey } from "./flow";

export function appUrl() {
  const configured = process.env.APP_URL;
  if (process.env.NODE_ENV === "production" && !configured)
    throw new DomainError("AUTH_UNAVAILABLE", 503);
  const url = new URL(configured ?? "http://127.0.0.1:3014");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  )
    throw new DomainError("AUTH_UNAVAILABLE", 503);
  return url.origin;
}
export const resourceUrl = () => `${appUrl()}/mcp`;
export function authPlugins(db?: Database) {
  return [
    jwt(),
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource: resourceUrl(),
      scopes: ["openid", "profile", "offline_access", "crm:read", "crm:write"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      accessTokenExpiresIn: 300,
      ...(db
        ? {
            postLogin: {
              page: "/authorize",
              shouldRedirect: async ({
                session,
              }: {
                session: { id: string };
              }) => {
                const key = currentFlowKey();
                if (!key) return true;
                const [selection] = await db
                  .select({ grantId: oauthSelections.grantId })
                  .from(oauthSelections)
                  .innerJoin(
                    mcpGrants,
                    eq(oauthSelections.grantId, mcpGrants.id),
                  )
                  .where(
                    and(
                      eq(oauthSelections.sessionId, session.id),
                      eq(oauthSelections.flowKey, key),
                      eq(mcpGrants.active, true),
                    ),
                  );
                return !selection;
              },
              consentReferenceId: async ({
                session,
              }: {
                session: { id: string };
              }) => {
                const key = currentFlowKey();
                if (!key) throw new Error("ORGANIZATION_SELECTION_REQUIRED");
                const [selection] = await db
                  .select()
                  .from(oauthSelections)
                  .where(
                    and(
                      eq(oauthSelections.sessionId, session.id),
                      eq(oauthSelections.flowKey, key),
                    ),
                  );
                if (!selection)
                  throw new Error("ORGANIZATION_SELECTION_REQUIRED");
                return selection.grantId;
              },
            },
            customAccessTokenClaims: async ({
              user,
              referenceId,
            }: {
              user?: { id: string } | null;
              referenceId?: string;
            }) => {
              if (!user || !referenceId)
                throw new Error("ORGANIZATION_GRANT_REQUIRED");
              const [grant] = await db
                .select()
                .from(mcpGrants)
                .where(
                  and(
                    eq(mcpGrants.id, referenceId),
                    eq(mcpGrants.userId, user.id),
                    eq(mcpGrants.active, true),
                  ),
                );
              if (!grant) throw new Error("ORGANIZATION_GRANT_REQUIRED");
              return { crm_grant_id: grant.id };
            },
          }
        : {}),
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
  ];
}
