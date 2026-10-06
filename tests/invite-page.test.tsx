// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DomainError, type Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { operations } from "../packages/operations/catalog";
import { requestJson } from "../src/components/client-api";
import { signInDestination } from "../src/components/sign-in-destination";

const principal = vi.fn();
let requestHeaders = new Headers();
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
vi.mock("@crm/auth/server", () => ({
  currentPrincipal: (...args: unknown[]) => principal(...args),
}));
vi.mock("@crm/database/client", async (original) => ({
  ...(await original<typeof import("../packages/database/client")>()),
  getDatabase: async () => local.db,
}));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
}));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const request = vi.mocked(requestJson);

import Page from "../src/app/invite/[token]/page";

const admin: Principal = { userId: demoUser, source: "demo" };
const invitee: Principal = { userId: "fixture-invitee", source: "session" };

beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
  principal.mockReset();
  request.mockReset();
  local = await createLocalDatabase();
  await seedDemo(local.db);
  await local.db.insert(s.user).values({
    id: invitee.userId,
    name: "Fixture Invitee",
    email: "invitee@example.test",
    emailVerified: true,
  });
});
afterEach(async () => {
  cleanup();
  vi.unstubAllEnvs();
  await local.client.close();
});

async function invitation() {
  const operation = operations.find(
    (item) => item.name === "create_invitation",
  );
  if (!operation) throw new Error("MISSING_OPERATION");
  const created = (await operation.execute(
    { db: local.db, principal: admin },
    {
      organizationId: demoId(1),
      email: "invitee@example.test",
      productIds: [demoId(10)],
    },
  )) as { acceptUrl: string; invitation: { id: string } };
  return {
    id: created.invitation.id,
    token: decodeURIComponent(
      new URL(created.acceptUrl).pathname.split("/").pop() ?? "",
    ),
  };
}
async function show(token: string) {
  requestHeaders = new Headers({ "x-gravity-path": `/invite/${token}` });
  render(await Page({ params: Promise.resolve({ token }) }));
}

test("the proxy forwards invitation paths so sign-in can return to them", async () => {
  const { NextRequest } = await import("next/server");
  const { proxy, config } = await import("../src/proxy");
  const response = proxy(new NextRequest("http://localhost/invite/abc123"));
  expect(response.headers.get("x-middleware-request-x-gravity-path")).toBe(
    "/invite/abc123",
  );
  expect(config.matcher).toContain("/invite/:path*");
});

test("a signed-out visitor is asked to sign in and brought back to the invitation", async () => {
  const { token } = await invitation();
  principal.mockRejectedValue(new DomainError("UNAUTHORIZED", 401));
  await show(token);
  expect(screen.getByText(t.inviteSignInTitle)).toBeTruthy();
  expect(screen.queryByText("Northstar Collective")).toBeNull();
  const link = screen.getByRole("link", { name: t.inviteSignIn });
  const target = new URL(link.getAttribute("href") ?? "", "http://localhost");
  expect(target.pathname).toBe("/sign-in");
  expect(signInDestination(target.searchParams, "http://localhost")).toBe(
    `/invite/${token}`,
  );
});

test("a signed-in invitee sees the workspace name and accepts", async () => {
  const { token } = await invitation();
  principal.mockResolvedValue(invitee);
  request.mockResolvedValue({
    organizationId: demoId(1),
    organizationName: "Northstar Collective",
  });
  await show(token);
  expect(screen.getAllByText(/Northstar Collective/).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: t.inviteDecline })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t.inviteAccept }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const [url, init] = request.mock.calls[0] ?? [];
  expect(url).toBe("/api/crm");
  expect(JSON.parse(String(init?.body))).toEqual({
    operation: "invitation-accept",
    token,
  });
  const open = await screen.findByRole("link", {
    name: t.inviteOpenWorkspace.replace("{workspace}", "Northstar Collective"),
  });
  expect(open.getAttribute("href")).toBe(
    `/api/workspace?organizationId=${demoId(1)}&next=%2Factions`,
  );
});

test("an unusable invitation explains why and offers no accept button", async () => {
  const { id, token } = await invitation();
  await local.db
    .update(s.invitations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(s.invitations.id, id));
  principal.mockResolvedValue(invitee);
  await show(token);
  expect(screen.getByText(t.errors.INVITATION_EXPIRED)).toBeTruthy();
  expect(screen.queryByRole("button", { name: t.inviteAccept })).toBeNull();
  cleanup();
  principal.mockResolvedValue({ userId: "demo-teammate", source: "session" });
  await local.db
    .update(s.invitations)
    .set({ expiresAt: new Date(Date.now() + 86400000) })
    .where(eq(s.invitations.id, id));
  await show(token);
  expect(screen.getByText(t.errors.INVITATION_EMAIL_MISMATCH)).toBeTruthy();
  expect(screen.queryByText("Northstar Collective")).toBeNull();
});
