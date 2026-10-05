import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { publishChange } from "@crm/core/changes";
import { scopeSchema } from "@crm/core/crm";
import { errorResponse, limitedBody } from "@crm/core/http";
import {
  contactPreferencesSchema,
  contactRulesSchema,
  enrollmentChangeSchema,
  enrollSchema,
  OutreachService,
  relationshipChangeSchema,
  sequenceUpdateSchema,
  touchApproveSchema,
  touchDraftSchema,
  touchQuerySchema,
  touchReopenSchema,
  touchSentSchema,
  touchSkipSchema,
  touchSnoozeSchema,
} from "@crm/core/outreach";
import { getDatabase } from "@crm/database/client";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const principal = await currentPrincipal(request.headers);
    const service = new OutreachService(await getDatabase());
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const operation = z
      .enum(["due", "queue", "touch", "rules"])
      .default("due")
      .parse(query.operation);
    const scope = scopeSchema.parse(query);
    if (operation === "touch")
      return Response.json(
        await service.touch(principal, touchQuerySchema.parse(query)),
        { headers },
      );
    if (operation === "queue")
      return Response.json(await service.queue(principal, scope), { headers });
    if (operation === "rules")
      return Response.json(
        await service.contactRules(principal, scope.organizationId),
        { headers },
      );
    return Response.json(await service.dueTouches(principal, scope), {
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const service = new OutreachService(await getDatabase());
    const body = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 100000)),
    );
    if (body.operation === "advance") {
      const scope = scopeSchema.parse(body);
      const advanced = await service.advanceEnrollments(principal, scope);
      if (advanced.created || advanced.completed || advanced.paused)
        publishChange(scope.organizationId);
      return Response.json(advanced, { headers });
    }
    const operations = {
      enroll: () => service.enroll(principal, enrollSchema.parse(body)),
      draft: () => service.editDraft(principal, touchDraftSchema.parse(body)),
      approve: () => service.approve(principal, touchApproveSchema.parse(body)),
      sent: () => service.markSent(principal, touchSentSchema.parse(body)),
      skip: () => service.skip(principal, touchSkipSchema.parse(body)),
      reopen: () => service.reopen(principal, touchReopenSchema.parse(body)),
      snooze: () => service.snooze(principal, touchSnoozeSchema.parse(body)),
      enrollment: () =>
        service.changeEnrollment(principal, enrollmentChangeSchema.parse(body)),
      relationship: () =>
        service.changeRelationship(
          principal,
          relationshipChangeSchema.parse(body),
        ),
      sequence: () =>
        service.updateSequence(principal, sequenceUpdateSchema.parse(body)),
      rules: () =>
        service.updateContactRules(principal, contactRulesSchema.parse(body)),
      contact: () =>
        service.setContactPreferences(
          principal,
          contactPreferencesSchema.parse(body),
        ),
    };
    const operation = z
      .enum(Object.keys(operations) as [keyof typeof operations])
      .parse(body.operation);
    const result = await operations[operation]();
    publishChange(z.uuid().parse(body.organizationId));
    return Response.json(result, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
