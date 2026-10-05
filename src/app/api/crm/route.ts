import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { publishChange } from "@crm/core/changes";
import {
  actionChangeSchema,
  actionPlanSchema,
  CrmService,
  folderSchema,
  meetingChangeSchema,
  personSchema,
  scheduleActionSchema,
  scopeSchema,
  workspaceSchema,
} from "@crm/core/crm";
import { errorResponse, limitedBody } from "@crm/core/http";
import {
  companyArchiveSchema,
  companySchema,
  meetingSchema,
  opportunityChangeSchema,
  opportunityCreateSchema,
  personArchiveSchema,
  personUpdateSchema,
  RecordService,
} from "@crm/core/records";
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
      "person",
      "company",
      "revision",
      "snapshot",
    ])
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
      else if (query.operation === "person")
        result = await service.personContext(
          principal,
          scope.organizationId,
          z.uuid().parse(query.personId),
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
    const database = await getDatabase();
    const service = new CrmService(database);
    const body = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 50000)),
    );
    const nameSchema = z.string().trim().min(1).max(100);
    const records = new RecordService(database);
    const operations = {
      workspace: () =>
        service.createWorkspace(principal, workspaceSchema.parse(body)),
      schedule: () =>
        service.scheduleAction(principal, scheduleActionSchema.parse(body)),
      person: () => service.createPerson(principal, personSchema.parse(body)),
      action: () =>
        service.changeAction(principal, actionChangeSchema.parse(body)),
      plan: () => service.planActions(principal, actionPlanSchema.parse(body)),
      folder: () => service.createFolder(principal, folderSchema.parse(body)),
      commitment: () =>
        service.acceptCommitment(principal, meetingChangeSchema.parse(body)),
      organization: () =>
        service.createOrganization(principal, nameSchema.parse(body.name)),
      product: () =>
        service.createProduct(
          principal,
          z.uuid().parse(body.organizationId),
          nameSchema.parse(body.name),
        ),
      "person-update": () =>
        records.updatePerson(principal, personUpdateSchema.parse(body)),
      "person-archive": () =>
        records.archivePerson(principal, personArchiveSchema.parse(body)),
      company: () => records.saveCompany(principal, companySchema.parse(body)),
      "company-archive": () =>
        records.archiveCompany(principal, companyArchiveSchema.parse(body)),
      meeting: () => records.saveMeeting(principal, meetingSchema.parse(body)),
      opportunity: () =>
        records.createOpportunity(
          principal,
          opportunityCreateSchema.parse(body),
        ),
      "opportunity-change": () =>
        records.changeOpportunity(
          principal,
          opportunityChangeSchema.parse(body),
        ),
    };
    const operation = z
      .enum(Object.keys(operations) as [keyof typeof operations])
      .parse(body.operation);
    const result = await operations[operation]();
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
