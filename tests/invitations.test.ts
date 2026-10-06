import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { authorize, type Principal } from "../packages/core/policy";
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
const invitee: Principal = { userId: "fixture-invitee", source: "session" };
const agent: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  readOnly: false,
};
interface Created {
  invitation: {
    id: string;
    email: string;
    role: string;
    productIds: string[];
    expiresAt: string;
    status: string;
  };
  acceptUrl: string;
  emailStatus: string;
}

beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
  local = await createLocalDatabase();
  await seedDemo(local.db);
  await local.db.insert(s.user).values({
    id: invitee.userId,
    name: "Fixture Invitee",
    email: "New.Person@Example.test",
    emailVerified: true,
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  return (await find(name).execute({ db: local.db, principal }, input)) as T;
}
const invite = (input: Record<string, unknown> = {}, principal = admin) =>
  run<Created>("create_invitation", principal, {
    organizationId: org,
    email: "NEW.person@example.test",
    productIds: [demoId(10), demoId(11)],
    ...input,
  });
const tokenOf = (created: Created) =>
  decodeURIComponent(
    new URL(created.acceptUrl).pathname.split("/").pop() ?? "",
  );
const accept = (token: string, principal = invitee) =>
  run("accept_invitation", principal, { token });

describe("creating invitations", () => {
  test("the email is lowercased, expiry defaults to seven days and only a hash of the token is stored", async () => {
    const created = await invite();
    expect(created.invitation).toMatchObject({
      email: "new.person@example.test",
      role: "member",
      productIds: [demoId(10), demoId(11)],
      status: "pending",
    });
    const days =
      (Date.parse(created.invitation.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    expect(new URL(created.acceptUrl).pathname).toMatch(/^\/invite\/.{40,}$/);
    expect(created.emailStatus).toBe("not_configured");
    const token = tokenOf(created);
    const [row] = await local.db
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.id, created.invitation.id));
    expect(row?.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row?.invitedBy).toBe(demoUser);
    const listed = await run<{ invitations: Record<string, unknown>[] }>(
      "list_invitations",
      admin,
      { organizationId: org },
    );
    expect(listed.invitations).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(row?.tokenHash ?? "");
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  test("Resend delivers the accept link when configured and nothing logged contains the token", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fixture_key");
    vi.stubEnv("EMAIL_FROM", "Gravity <invites@example.test>");
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json({ id: "email-fixture" }),
    );
    vi.stubGlobal("fetch", fetch);
    const logged: string[] = [];
    for (const level of ["info", "error", "warn", "log"] as const)
      vi.spyOn(console, level).mockImplementation((...values: unknown[]) => {
        logged.push(values.map(String).join(" "));
      });
    const created = await invite();
    expect(created.emailStatus).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init?.body));
    expect(body.to).toEqual(["new.person@example.test"]);
    expect(body.text).toContain(created.acceptUrl);
    expect(body.text).toContain("Northstar Collective");
    fetch.mockRejectedValueOnce(new Error("provider down"));
    const resent = await run<Created>("resend_invitation", admin, {
      organizationId: org,
      invitationId: created.invitation.id,
    });
    expect(resent.emailStatus).toBe("failed");
    expect(resent.acceptUrl).toContain("/invite/");
    for (const line of logged) {
      expect(line).not.toContain(tokenOf(created));
      expect(line).not.toContain(tokenOf(resent));
    }
  });

  test("only administrators with an all-products grant manage invitations", async () => {
    for (const principal of [
      teammate,
      { ...agent, productIds: [demoId(10)] },
      { ...agent, readOnly: true },
    ])
      await expect(invite({}, principal)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    await expect(
      run("list_invitations", teammate, { organizationId: org }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const created = await invite();
    for (const name of ["resend_invitation", "revoke_invitation"])
      await expect(
        run(name, teammate, {
          organizationId: org,
          invitationId: created.invitation.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("current members, duplicate pending invitations and foreign products are refused", async () => {
    await expect(invite({ email: "Sam@Example.test" })).rejects.toMatchObject({
      code: "ALREADY_MEMBER",
    });
    await invite();
    await expect(invite()).rejects.toMatchObject({
      code: "INVITATION_PENDING",
    });
    await expect(
      invite({ email: "other@example.test", productIds: [demoId(13)] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("email domain allowlists", () => {
  test("the deployment allowlist limits invitations and acceptance", async () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "noveum.ai, Example.org");
    await expect(invite()).rejects.toMatchObject({
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
      status: 403,
    });
    await expect(
      invite({ email: "person@example.org" }),
    ).resolves.toMatchObject({ invitation: { email: "person@example.org" } });
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
    const created = await invite();
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "noveum.ai");
    await expect(accept(tokenOf(created))).rejects.toMatchObject({
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
    });
  });

  test("the workspace allowlist narrows invitations further", async () => {
    await local.db
      .update(s.organizations)
      .set({ allowedEmailDomains: ["noveum.ai"] })
      .where(eq(s.organizations.id, org));
    await expect(invite()).rejects.toMatchObject({
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
    });
    await expect(invite({ email: "Person@Noveum.AI" })).resolves.toMatchObject({
      invitation: { email: "person@noveum.ai" },
    });
  });
});

describe("accepting invitations", () => {
  test("a matching verified email creates the membership and product memberships", async () => {
    const created = await invite();
    const accepted = await accept(tokenOf(created));
    expect(accepted).toMatchObject({
      organizationId: org,
      organizationName: "Northstar Collective",
      role: "member",
      productIds: [demoId(10), demoId(11)],
    });
    const permission = await authorize(local.db, invitee, org);
    expect(permission.membership.role).toBe("member");
    expect(permission.products.map((product) => product.id).sort()).toEqual([
      demoId(10),
      demoId(11),
    ]);
    const [row] = await local.db
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.id, created.invitation.id));
    expect(row?.acceptedBy).toBe(invitee.userId);
    expect(row?.acceptedAt).toBeInstanceOf(Date);
  });

  test("a used invitation is refused", async () => {
    const created = await invite();
    await accept(tokenOf(created));
    await expect(accept(tokenOf(created))).rejects.toMatchObject({
      code: "INVITATION_USED",
      status: 409,
    });
  });

  test("a revoked invitation is refused and cannot be resent", async () => {
    const created = await invite();
    const revoked = await run<Created>("revoke_invitation", admin, {
      organizationId: org,
      invitationId: created.invitation.id,
    });
    expect(revoked.invitation.status).toBe("revoked");
    await expect(accept(tokenOf(created))).rejects.toMatchObject({
      code: "INVITATION_REVOKED",
      status: 410,
    });
    await expect(
      run("resend_invitation", admin, {
        organizationId: org,
        invitationId: created.invitation.id,
      }),
    ).rejects.toMatchObject({ code: "INVITATION_REVOKED" });
  });

  test("an expired invitation is refused until it is resent with a new token", async () => {
    const created = await invite();
    await local.db
      .update(s.invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.invitations.id, created.invitation.id));
    await expect(accept(tokenOf(created))).rejects.toMatchObject({
      code: "INVITATION_EXPIRED",
      status: 410,
    });
    const resent = await run<Created>("resend_invitation", admin, {
      organizationId: org,
      invitationId: created.invitation.id,
    });
    expect(tokenOf(resent)).not.toBe(tokenOf(created));
    await expect(accept(tokenOf(created))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(accept(tokenOf(resent))).resolves.toMatchObject({
      organizationId: org,
    });
  });

  test("the signed-in email must match case-insensitively and be verified", async () => {
    const created = await invite();
    await expect(accept(tokenOf(created), teammate)).rejects.toMatchObject({
      code: "INVITATION_EMAIL_MISMATCH",
      status: 403,
    });
    await local.db
      .update(s.user)
      .set({ emailVerified: false })
      .where(eq(s.user.id, invitee.userId));
    await expect(accept(tokenOf(created))).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
    await expect(
      accept("not-a-real-invitation-token-value"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("an inactive member is reactivated with the invited role and products", async () => {
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(eq(s.memberships.userId, "demo-restricted"));
    await local.db
      .update(s.user)
      .set({ emailVerified: true })
      .where(eq(s.user.id, "demo-restricted"));
    const created = await invite({
      email: "restricted@example.test",
      role: "admin",
      productIds: [],
    });
    await accept(tokenOf(created), {
      userId: "demo-restricted",
      source: "session",
    });
    const permission = await authorize(
      local.db,
      { userId: "demo-restricted", source: "session" },
      org,
    );
    expect(permission.membership).toMatchObject({
      role: "admin",
      active: true,
    });
  });

  test("assistants cannot accept invitations on a person's behalf", async () => {
    const created = await invite();
    await expect(accept(tokenOf(created), agent)).rejects.toMatchObject({
      code: "HUMAN_ACTION_REQUIRED",
    });
    expect(operationRequirements(find("accept_invitation"))).toMatchObject({
      humanSession: true,
    });
    expect(operationAvailable(find("accept_invitation"), agent, "admin")).toBe(
      false,
    );
    for (const name of [
      "create_invitation",
      "resend_invitation",
      "revoke_invitation",
      "list_invitations",
    ])
      expect(operationRequirements(find(name))).toMatchObject({
        administrator: true,
        allProducts: true,
      });
  });
});

describe("agents and invitations", () => {
  test("an agent cannot create or resend an invitation but can list and revoke one", async () => {
    await expect(invite({}, agent)).rejects.toMatchObject({
      code: "HUMAN_ACTION_REQUIRED",
      status: 403,
    });
    const created = await invite();
    await expect(
      run("resend_invitation", agent, {
        organizationId: org,
        invitationId: created.invitation.id,
      }),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      run<{ invitations: unknown[] }>("list_invitations", agent, {
        organizationId: org,
      }),
    ).resolves.toBeTruthy();
    await expect(
      run("revoke_invitation", agent, {
        organizationId: org,
        invitationId: created.invitation.id,
      }),
    ).resolves.toBeTruthy();
    for (const name of ["create_invitation", "resend_invitation"]) {
      expect(operationRequirements(find(name)).humanSession).toBe(true);
      expect(operationAvailable(find(name), agent, "admin")).toBe(false);
    }
    expect(operationRequirements(find("revoke_invitation")).humanSession).toBe(
      false,
    );
  });
});
