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
import { errorResponse } from "../packages/core/http";
import { DomainError, type Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import {
  apiOperation,
  operationRequirements,
  operations,
} from "../packages/operations/catalog";
import {
  browserNavigation,
  RequestError,
  requestJson,
} from "../src/components/client-api";
import { signInDestination } from "../src/components/sign-in-destination";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let viewer: Principal | null = null;
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const request = vi.mocked(requestJson);

import LegacyInvitePage from "../src/app/invite/[token]/page";
import InvitePage, { metadata } from "../src/app/invite/page";

const admin: Principal = { userId: demoUser, source: "demo" };
const invitee: Principal = { userId: "fixture-invitee", source: "session" };
const storageKey = "gravity-invite-token";

beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
  vi.stubEnv("APP_URL", "https://gravity.example.test");
  viewer = null;
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  request.mockReset();
  request.mockImplementation(async (url, init) => {
    expect(url).toBe("/api/crm");
    expect(init?.method).toBe("POST");
    const input = JSON.parse(String(init?.body));
    try {
      if (!viewer) throw new DomainError("UNAUTHORIZED", 401);
      return await apiOperation("crm", "POST", input.operation).execute(
        { db: local.db, principal: viewer },
        input,
      );
    } catch (error) {
      const data = await errorResponse(error).json();
      throw new RequestError(data.error, data.details ?? {});
    }
  });
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
  vi.restoreAllMocks();
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
  const link = new URL(created.acceptUrl);
  return {
    id: created.invitation.id,
    link,
    token: decodeURIComponent(link.hash.slice(1)),
  };
}
function open(link: URL) {
  window.history.replaceState(null, "", `${link.pathname}${link.hash}`);
  render(<InvitePage />);
}
const bodies = () =>
  request.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

test("the emailed link carries the token only in the fragment", async () => {
  const { link, token } = await invitation();
  expect(link.pathname).toBe("/invite");
  expect(link.search).toBe("");
  expect(token.length).toBeGreaterThan(20);
  expect(link.href).not.toContain(`/invite/${token}`);
  expect(metadata).toMatchObject({
    title: `${t.invitePageTitle} · ${t.brand}`,
    robots: { index: false, follow: false },
  });
  const preview = operations.find((item) => item.name === "preview_invitation");
  if (!preview) throw new Error("MISSING_OPERATION");
  expect(preview.method).toBe("POST");
  expect(operationRequirements(preview).humanSession).toBe(true);
});

test("a signed-out visitor keeps the token in session storage and signs in without it in any URL", async () => {
  const { link, token } = await invitation();
  open(link);
  const signIn = await screen.findByRole("link", { name: t.inviteSignIn });
  expect(screen.getByText(t.inviteSignInTitle)).toBeTruthy();
  expect(screen.queryByText(/Northstar Collective/)).toBeNull();
  expect(sessionStorage.getItem(storageKey)).toBe(token);
  expect(window.location.hash).toBe("");
  expect(window.location.pathname).toBe("/invite");
  const href = signIn.getAttribute("href") ?? "";
  expect(href).not.toContain(token);
  const target = new URL(href, "http://localhost");
  expect(target.pathname).toBe("/sign-in");
  expect(signInDestination(target.searchParams, "http://localhost")).toBe(
    "/invite",
  );
  expect(bodies()).toEqual([{ operation: "invitation-preview", token }]);
});

test("after signing in the stored token previews and accepts the invitation", async () => {
  const { token } = await invitation();
  sessionStorage.setItem(storageKey, token);
  viewer = invitee;
  const assign = vi
    .spyOn(browserNavigation, "assign")
    .mockImplementation(() => {});
  open(new URL("https://gravity.example.test/invite"));
  expect(
    await screen.findByText(
      t.inviteTitle.replace("{workspace}", "Northstar Collective"),
    ),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: t.inviteDecline })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t.inviteAccept }));
  const workspace = `/api/workspace?organizationId=${demoId(1)}&next=%2Factions`;
  await waitFor(() => expect(assign).toHaveBeenCalledWith(workspace));
  expect(bodies()).toEqual([
    { operation: "invitation-preview", token },
    { operation: "invitation-accept", token },
  ]);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  const link = await screen.findByRole("link", {
    name: t.inviteOpenWorkspace.replace("{workspace}", "Northstar Collective"),
  });
  expect(link.getAttribute("href")).toBe(workspace);
  const [membership] = await local.db
    .select()
    .from(s.memberships)
    .where(eq(s.memberships.userId, invitee.userId));
  expect(membership?.active).toBe(true);
});

test("an invitee who is already an active member is pointed to the workspace instead", async () => {
  const { link } = await invitation();
  await local.db.insert(s.memberships).values({
    organizationId: demoId(1),
    userId: invitee.userId,
    role: "member",
  });
  viewer = invitee;
  open(link);
  expect(
    await screen.findByText(
      t.inviteAlreadyMemberTitle.replace("{workspace}", "Northstar Collective"),
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: t.inviteAccept })).toBeNull();
  const workspace = screen.getByRole("link", {
    name: t.inviteOpenWorkspace.replace("{workspace}", "Northstar Collective"),
  });
  expect(workspace.getAttribute("href")).toBe(
    `/api/workspace?organizationId=${demoId(1)}&next=%2Factions`,
  );
});

test("an unusable invitation explains why and offers no accept button", async () => {
  const { id, link } = await invitation();
  await local.db
    .update(s.invitations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(s.invitations.id, id));
  viewer = invitee;
  open(link);
  expect(await screen.findByText(t.errors.INVITATION_EXPIRED)).toBeTruthy();
  expect(screen.queryByRole("button", { name: t.inviteAccept })).toBeNull();
  cleanup();
  viewer = { userId: "demo-teammate", source: "session" };
  await local.db
    .update(s.invitations)
    .set({ expiresAt: new Date(Date.now() + 86400000) })
    .where(eq(s.invitations.id, id));
  open(link);
  expect(
    await screen.findByText(t.errors.INVITATION_EMAIL_MISMATCH),
  ).toBeTruthy();
  expect(screen.queryByText(/Northstar Collective/)).toBeNull();
});

test("a visit without any token, or with a damaged or unknown one, says the link is not usable", async () => {
  viewer = invitee;
  open(new URL("https://gravity.example.test/invite"));
  expect(await screen.findByText(t.inviteUnavailableTitle)).toBeTruthy();
  expect(screen.getByText(t.inviteNotFound)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  for (const token of ["short", "x".repeat(43)]) {
    cleanup();
    sessionStorage.clear();
    open(new URL(`https://gravity.example.test/invite#${token}`));
    expect(await screen.findByText(t.inviteNotFound)).toBeTruthy();
  }
});

test("a link already sent as /invite/<token> moves the token into the fragment before anything else", async () => {
  const replace = vi
    .spyOn(browserNavigation, "replace")
    .mockImplementation(() => {});
  render(
    await LegacyInvitePage({ params: Promise.resolve({ token: "abc/123" }) }),
  );
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith("/invite#abc%2F123"),
  );
  expect(request).not.toHaveBeenCalled();
});
