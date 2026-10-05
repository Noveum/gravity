import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { publishChange } from "@crm/core/changes";
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
  scopeSchema,
  workspaceSchema,
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
    z.enum([
      "organizations",
      "context",
      "company",
      "revision",
      "snapshot",
      "messageActivity",
      "overview",
    ])
      .optional()
      .parse(query.operation);
    let result: unknown;
    if (query.operation === "organizations")
      result = await service.organizations(principal);
    else {
      const scope = scopeSchema.parse(query);
      if (query.operation === "overview")
        result = await service.overview(principal, {
          ...scope,
          days: z.coerce
            .number()
            .refine((v) => [7, 30, 90].includes(v))
            .default(30)
            .parse(query.days),
          ownerId: query.ownerId,
          channel: z
            .enum(["gmail", "linkedin"])
            .optional()
            .parse(query.channel),
        });
      else if (query.operation === "messageActivity")
        result = await service.messageActivity(
          principal,
          messageActivitySchema.parse(query),
        );
      else if (query.operation === "context")
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
        "workspace",
        "action",
        "folder",
        "commitment",
        "organization",
        "product",
        "person",
        "schedule",
        "opportunity",
        "pipeline",
      ])
      .parse(body.operation);
    const nameSchema = z.string().trim().min(1).max(100);
    const result =
      operation === "opportunity"
        ? await service.saveOpportunity(
            principal,
            opportunitySchema.parse(body),
          )
        : operation === "pipeline"
          ? await service.createPipeline(principal, pipelineSchema.parse(body))
          : operation === "workspace"
            ? await service.createWorkspace(
                principal,
                workspaceSchema.parse(body),
              )
            : operation === "schedule"
              ? await service.scheduleAction(
                  principal,
                  scheduleActionSchema.parse(body),
                )
              : operation === "person"
                ? await service.createPerson(
                    principal,
                    personSchema.parse(body),
                  )
                : operation === "action"
                  ? await service.changeAction(
                      principal,
                      actionChangeSchema.parse(body),
                    )
                  : operation === "folder"
                    ? await service.createFolder(
                        principal,
                        folderSchema.parse(body),
                      )
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
    const affected = result as { organizationId?: string; id?: string };
    publishChange(
      (operation === "workspace"
        ? affected.organizationId
        : operation === "organization"
          ? affected.id
          : body.organizationId) || "",
    );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
