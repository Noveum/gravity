import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { publishChange } from "@crm/core/changes";
import {
  actionChangeSchema,
  CrmService,
  folderSchema,
  meetingChangeSchema,
  personSchema,
  scheduleActionSchema,
  scopeSchema,
} from "@crm/core/crm";
import { errorResponse, limitedBody } from "@crm/core/http";
import { getDatabase } from "@crm/database/client";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const principal = await currentPrincipal(request.headers);
    const service = new CrmService(await getDatabase());
    const query = Object.fromEntries(new URL(request.url).searchParams);
    z.enum(["organizations", "context", "company", "revision", "snapshot"])
      .optional()
      .parse(query.operation);
    let result: unknown;
    if (query.operation === "organizations")
      result = await service.organizations(principal);
    else {
      const scope = scopeSchema.parse(query);
      if (query.operation === "context")
        result = await service.context(
          principal,
          scope.organizationId,
          z.uuid().parse(query.relationshipId),
        );
      else if (query.operation === "company")
        result = await service.companyContext(
          principal,
          scope,
          z.uuid().parse(query.companyId),
        );
      else if (query.operation === "revision")
        result = {
          revision: await service.revision(principal, scope.organizationId),
        };
      else result = await service.snapshot(principal, scope);
    }
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const service = new CrmService(await getDatabase());
    const body = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 50000)),
    );
    const operation = z
      .enum([
        "action",
        "folder",
        "commitment",
        "organization",
        "product",
        "person",
        "schedule",
      ])
      .parse(body.operation);
    const nameSchema = z.string().trim().min(1).max(100);
    const result =
      operation === "schedule"
        ? await service.scheduleAction(
            principal,
            scheduleActionSchema.parse(body),
          )
        : operation === "person"
          ? await service.createPerson(principal, personSchema.parse(body))
          : operation === "action"
            ? await service.changeAction(
                principal,
                actionChangeSchema.parse(body),
              )
            : operation === "folder"
              ? await service.createFolder(principal, folderSchema.parse(body))
              : operation === "commitment"
                ? await service.acceptCommitment(
                    principal,
                    meetingChangeSchema.parse(body),
                  )
                : operation === "organization"
                  ? await service.createOrganization(
                      principal,
                      nameSchema.parse(body.name),
                    )
                  : await service.createProduct(
                      principal,
                      z.uuid().parse(body.organizationId),
                      nameSchema.parse(body.name),
                    );
    publishChange(body.organizationId || (result as { id?: string }).id || "");
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
