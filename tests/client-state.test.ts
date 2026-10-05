import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  createRefreshCoordinator,
  productSnapshot,
} from "../packages/core/client-state";
import { CrmService } from "../packages/core/crm";
import { serialize } from "../packages/core/dto";
import { RecordService } from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as schema from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CrmService;
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new CrmService(local.db);
});
afterAll(async () => local.client.close());

describe("instant authorized product projection", () => {
  test("matches server filtering, preserves canonical people and leaves the source intact", async () => {
    const principal = { userId: demoUser, source: "demo" as const };
    const full = serialize(
      await service.snapshot(principal, { organizationId: demoId(1) }),
    );
    for (const product of full.products) {
      const projected = productSnapshot(full, product.id);
      const sql = serialize(
        await service.snapshot(principal, {
          organizationId: demoId(1),
          productId: product.id,
        }),
      );
      for (const key of [
        "relationships",
        "people",
        "companies",
        "actions",
        "sequences",
        "enrollments",
        "folders",
        "assets",
        "assetStages",
        "stages",
        "meetings",
        "opportunities",
        "pipelines",
        "messageStats",
        "touchStats",
      ] as const) {
        expect(projected[key]).toEqual(sql[key]);
      }
    }
    expect(productSnapshot(full, "")).toBe(full);
    expect(full.products).toHaveLength(3);
    expect(full.relationships.some((row) => row.productId === demoId(12))).toBe(
      true,
    );
  });
  test("the archived lists follow the brand filter like the server does", async () => {
    const principal = { userId: demoUser, source: "demo" as const };
    const records = new RecordService(local.db);
    for (const id of [201, 204]) {
      const [row] = await local.db
        .select()
        .from(schema.people)
        .where(eq(schema.people.id, demoId(id)));
      await records.archivePerson(principal, {
        organizationId: demoId(1),
        personId: demoId(id),
        version: row?.version ?? 1,
        archived: true,
      });
    }
    const [vale] = await local.db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, demoId(105)));
    await records.archiveCompany(principal, {
      organizationId: demoId(1),
      companyId: demoId(105),
      version: vale?.version ?? 1,
      archived: true,
    });
    const full = serialize(
      await service.snapshot(principal, { organizationId: demoId(1) }),
    );
    expect(full.archived.people).toHaveLength(2);
    for (const product of full.products) {
      const server = serialize(
        await service.snapshot(principal, {
          organizationId: demoId(1),
          productId: product.id,
        }),
      );
      expect(productSnapshot(full, product.id).archived).toEqual(
        server.archived,
      );
    }
    expect(
      productSnapshot(full, demoId(12)).archived.people.map((row) => row.id),
    ).toEqual([]);
  });
  test("cannot widen a restricted user's products or enumerate unknown scopes", async () => {
    const restricted = serialize(
      await service.snapshot(
        { userId: "demo-restricted", source: "session" },
        { organizationId: demoId(1) },
      ),
    );
    for (const id of [demoId(10), demoId(13), "missing-product"]) {
      const projected = productSnapshot(restricted, id);
      expect(projected.products.map((p) => p.id)).toEqual([demoId(11)]);
      for (const key of [
        "relationships",
        "people",
        "companies",
        "actions",
        "sequences",
        "enrollments",
        "folders",
        "assets",
        "assetStages",
        "stages",
        "meetings",
        "opportunities",
        "pipelines",
        "messageStats",
        "touchStats",
      ] as const)
        expect(projected[key]).toEqual([]);
    }
  });
});

describe("realtime refresh coalescing", () => {
  test("an overlapping burst waits for the current read and only runs the latest queued scope", async () => {
    const refresh = createRefreshCoordinator();
    let finish!: () => void;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const superseded = vi.fn(async () => {});
    const latest = vi.fn(async () => {});
    const pending = refresh(first);
    expect(refresh(superseded)).toBe(pending);
    expect(refresh(latest)).toBe(pending);
    expect(latest).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(first).toHaveBeenCalledTimes(1);
    expect(superseded).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    await refresh(latest);
    expect(latest).toHaveBeenCalledTimes(2);
  });
  test("a failed read releases the coordinator for an explicit retry", async () => {
    const refresh = createRefreshCoordinator();
    await expect(
      refresh(async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    const retry = vi.fn(async () => {});
    await refresh(retry);
    expect(retry).toHaveBeenCalledOnce();
  });
});
