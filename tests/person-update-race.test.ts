import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { personUpdateSchema, RecordService } from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, seedDemo } from "../packages/database/seed";
import { databaseWithLockInterleave } from "./support/lock-interleave";

test.each(["membership", "product grant"])(
  "person updates recheck %s revocation after the organization lock wait",
  async (revoked) => {
    const local = await createLocalDatabase();
    try {
      await seedDemo(local.db);
      const [person] = await local.db
        .select()
        .from(s.people)
        .where(eq(s.people.id, demoId(200)));
      const race = databaseWithLockInterleave(local.db, async (tx, sql) => {
        expect(sql).toContain('"organizations"');
        if (revoked === "membership")
          await tx
            .update(s.memberships)
            .set({ active: false })
            .where(
              and(
                eq(s.memberships.organizationId, demoId(1)),
                eq(s.memberships.userId, "demo-restricted"),
              ),
            );
        else
          await tx
            .delete(s.productMemberships)
            .where(
              and(
                eq(s.productMemberships.organizationId, demoId(1)),
                eq(s.productMemberships.userId, "demo-restricted"),
                eq(s.productMemberships.productId, demoId(11)),
              ),
            );
      });
      await expect(
        new RecordService(race.database).updatePerson(
          { userId: "demo-restricted", source: "session" },
          personUpdateSchema.parse({
            organizationId: demoId(1),
            productId: demoId(11),
            personId: person.id,
            version: person.version,
            name: "Fictional revoked edit",
            title: person.title,
            email: person.email,
            otherEmails: person.otherEmails,
            phone: person.phone,
            linkedinUrl: person.linkedinUrl,
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(race.didInterleave()).toBe(true);
      const [unchanged] = await local.db
        .select()
        .from(s.people)
        .where(eq(s.people.id, person.id));
      expect(unchanged).toEqual(person);
    } finally {
      await local.client.close();
    }
  },
);
