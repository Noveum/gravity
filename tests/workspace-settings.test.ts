import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  operationAvailable,
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const agent: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  readOnly: false,
};

beforeEach(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterEach(async () => {
  await local.client.close();
});

function find(name: string) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw new Error(`MISSING_OPERATION:${name}`);
  return operation;
}
async function run<T = Record<string, unknown>>(
  name: string,
  principal: Principal,
  input: Record<string, unknown>,
) {
  return (await find(name).execute(
    { db: local.db, principal },
    { organizationId: org, ...input },
  )) as T;
}
async function organization(id = org) {
  const [row] = await local.db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.id, id));
  if (!row) throw new Error("organization fixture");
  return row;
}

describe("update_workspace", () => {
  test("renames the workspace and records a change event", async () => {
    const updated = await run("update_workspace", admin, {
      name: "  Northstar Studio  ",
    });
    expect(updated).toMatchObject({ id: org, name: "Northstar Studio" });
    expect((await organization()).name).toBe("Northstar Studio");
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.type, "workspace.updated"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityId: org, productId: null });
  });

  test("accepts an IANA time zone and refuses offsets and unknown zones", async () => {
    await run("update_workspace", admin, { timezone: "America/New_York" });
    expect((await organization()).timezone).toBe("America/New_York");
    for (const timezone of ["+05:30", "Mars/Olympus", "GMT+5:30", ""])
      await expect(
        run("update_workspace", admin, { timezone }),
      ).rejects.toThrow();
    expect((await organization()).timezone).toBe("America/New_York");
  });

  test("changes the slug only to a unique URL safe value", async () => {
    await run("update_workspace", admin, { slug: "northstar-studio" });
    expect((await organization()).slug).toBe("northstar-studio");
    for (const slug of ["Has Spaces", "UPPER", "-edge", "edge-", "a", "a--b"])
      await expect(run("update_workspace", admin, { slug })).rejects.toThrow();
    await expect(
      run("update_workspace", admin, { slug: "lunar" }),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN", status: 409 });
    expect((await organization()).slug).toBe("northstar-studio");
  });

  test("a slug taken between the check and the write is reported as taken", async () => {
    await local.client.exec(`
      create function take_slug_first() returns trigger language plpgsql as $$
      begin
        if old.id = '${org}' and new.slug is distinct from old.slug then
          update organizations set slug = new.slug where id = '${demoId(2)}';
        end if;
        return new;
      end $$;
      create trigger take_slug_first before update on organizations
        for each row execute function take_slug_first();
    `);
    await expect(
      run("update_workspace", admin, { slug: "raced-slug" }),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN", status: 409 });
    expect((await organization()).slug).toBe("northstar");
  });

  test("normalizes the workspace email domain allowlist", async () => {
    const updated = await run<{ allowedEmailDomains: string[] }>(
      "update_workspace",
      admin,
      {
        allowedEmailDomains: [
          "Example.TEST",
          "@example.test",
          " partner.example.test ",
        ],
      },
    );
    expect(updated.allowedEmailDomains).toEqual([
      "example.test",
      "partner.example.test",
    ]);
    expect((await organization()).allowedEmailDomains).toEqual([
      "example.test",
      "partner.example.test",
    ]);
    const listed = await run<{ id: string; allowedEmailDomains: string[] }[]>(
      "list_organizations",
      admin,
      {},
    );
    expect(listed.find((item) => item.id === org)).toMatchObject({
      allowedEmailDomains: ["example.test", "partner.example.test"],
    });
    for (const domain of ["not a domain", "example", "exa_mple.test", "a@b.c"])
      await expect(
        run("update_workspace", admin, { allowedEmailDomains: [domain] }),
      ).rejects.toThrow();
    await run("update_workspace", admin, { allowedEmailDomains: [] });
    expect((await organization()).allowedEmailDomains).toEqual([]);
  });

  test("needs at least one field", async () => {
    await expect(run("update_workspace", admin, {})).rejects.toThrow();
  });

  test("needs an administrator with an all-products grant", async () => {
    for (const principal of [
      teammate,
      { ...agent, productIds: [demoId(10)] },
      { ...agent, readOnly: true },
    ])
      await expect(
        run("update_workspace", principal, { name: "Taken over" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run("update_workspace", agent, { name: "Agent rename" }),
    ).resolves.toMatchObject({ name: "Agent rename" });
    expect(operationRequirements(find("update_workspace"))).toMatchObject({
      administrator: true,
      allProducts: true,
    });
    expect(
      operationAvailable(
        find("update_workspace"),
        { ...agent, productIds: [demoId(10)] },
        "admin",
      ),
    ).toBe(false);
  });
});

describe("create_organization", () => {
  test("stores the chosen time zone and defaults to UTC", async () => {
    const zoned = await run<{ id: string }>("create_organization", admin, {
      name: "Zoned Fixture",
      timezone: "Asia/Tokyo",
    });
    expect((await organization(zoned.id)).timezone).toBe("Asia/Tokyo");
    const plain = await run<{ id: string }>("create_organization", admin, {
      name: "Plain Fixture",
    });
    expect((await organization(plain.id)).timezone).toBe("UTC");
    await expect(
      run("create_organization", admin, {
        name: "Bad Fixture",
        timezone: "Nowhere/Land",
      }),
    ).rejects.toThrow();
  });
});
