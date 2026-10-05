import { currentPrincipal } from "@crm/auth/server";
import { CrmService } from "@crm/core/crm";
import { errorResponse } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase } from "@crm/database/client";
import { z } from "zod";
import { homePath, routeFor } from "@/components/routes";
import {
  brandCookie,
  preferenceCookie,
  workspaceCookie,
} from "@/components/workspace-preference";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function destination(next: string | null) {
  if (!next?.startsWith("/") || next.startsWith("//")) return homePath;
  const pathname = next.split(/[?#]/)[0] ?? "";
  return routeFor(pathname) ? next : homePath;
}

function redirectTo(location: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "private, no-store",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams;
  const next = destination(query.get("next"));
  try {
    const principal = await currentPrincipal(request.headers);
    const organizations = await new CrmService(
      await getDatabase(),
    ).organizations(principal);
    const organization = organizations.find(
      (item) =>
        item.slug === query.get("workspace") ||
        item.id === query.get("organizationId"),
    );
    if (!organization) return redirectTo(next);
    const productId = z.uuid().safeParse(query.get("productId"));
    const secure = url.protocol === "https:";
    return redirectTo(next, [
      preferenceCookie(workspaceCookie, organization.slug, secure),
      preferenceCookie(
        brandCookie,
        productId.success ? productId.data : "",
        secure,
      ),
    ]);
  } catch (error) {
    if (error instanceof DomainError && error.status === 401)
      return redirectTo(
        `/sign-in?callbackURL=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
      );
    return errorResponse(error);
  }
}
