import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { actionChangeSchema, CrmService } from "../packages/core/crm";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { databaseWithLockInterleave } from "./support/lock-interleave";

const scope = { organizationId: demoId(1), productId: demoId(11) };
const actor = { userId: "demo-restricted", source: "session" as const };
const administrator = { userId: demoUser, source: "session" as const };
const commands = ["approve", "save", "complete", "rework"] as const;
const cases = commands.flatMap((command) =>
  (["membership", "product grant"] as const).map(
    (revoked) => [command, revoked] as const,
  ),
);

test.each(cases)(
  "%s action changes recheck %s revocation after the organization lock wait",
  async (command, revoked) => {
    const local = await createLocalDatabase();
    try {
      await seedDemo(local.db);
      const service = new CrmService(local.db);
      const actionId = demoId(601);
      if (command !== "approve") {
        await service.changeAction(administrator, {
          ...scope,
          actionId,
          version: 1,
          command: "approve",
          draft: "A fictional reviewed answer for the API evaluation.",
        });
      }
      if (command === "rework")
        await local.db
          .update(s.actions)
          .set({ status: "blocked", kind: "approval" })
          .where(eq(s.actions.id, actionId));
      const [original] = await local.db
        .select()
        .from(s.actions)
        .where(eq(s.actions.id, actionId));
      if (command !== "approve") expect(original.approvedHash).toBeTruthy();
      const beforeEvents = await local.db
        .select()
        .from(s.changeEvents)
        .where(eq(s.changeEvents.entityId, actionId));
      const race = databaseWithLockInterleave(local.db, async (tx, sql) => {
        expect(sql).toContain('"organizations"');
        if (revoked === "membership")
          await tx
            .update(s.memberships)
            .set({ active: false })
            .where(
              and(
                eq(s.memberships.organizationId, scope.organizationId),
                eq(s.memberships.userId, actor.userId),
              ),
            );
        else
          await tx
            .delete(s.productMemberships)
            .where(
              and(
                eq(s.productMemberships.organizationId, scope.organizationId),
                eq(s.productMemberships.userId, actor.userId),
                eq(s.productMemberships.productId, scope.productId),
              ),
            );
      });
      let failure: unknown;
      try {
        await new CrmService(race.database).changeAction(
          actor,
          actionChangeSchema.parse({
            ...scope,
            actionId,
            version: original.version,
            command,
            ...(command === "save"
              ? {
                  draft: "A fictional edit attempted after access was revoked.",
                }
              : {}),
          }),
        );
      } catch (error) {
        failure = error;
      }
      expect(race.didInterleave()).toBe(true);
      const [after] = await local.db
        .select()
        .from(s.actions)
        .where(eq(s.actions.id, actionId));
      const afterEvents = await local.db
        .select()
        .from(s.changeEvents)
        .where(eq(s.changeEvents.entityId, actionId));
      expect.soft(failure).toMatchObject({ code: "FORBIDDEN" });
      expect.soft(after).toEqual(original);
      expect.soft(afterEvents).toEqual(beforeEvents);
    } finally {
      await local.client.close();
    }
  },
);
