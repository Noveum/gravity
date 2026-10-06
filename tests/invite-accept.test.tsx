// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import {
  browserNavigation,
  RequestError,
  requestJson,
} from "../src/components/client-api";
import {
  InviteAccept,
  inviteTokenKey,
  LegacyInviteRedirect,
} from "../src/components/invite-accept";

vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const request = vi.mocked(requestJson);
const token = "a".repeat(64);
const organizationId = "00000000-0000-4000-8000-000000000001";
const preview = {
  organizationId,
  organizationName: "Fictional Team",
  email: "teammate@example.test",
  role: "member",
  products: ["Fictional Product"],
  alreadyMember: false,
};
function visit(hash: string) {
  window.history.replaceState(null, "", `/invite${hash}`);
}
const body = (call: number) =>
  JSON.parse(String(request.mock.calls[call]?.[1]?.body));
beforeEach(() => {
  sessionStorage.clear();
  visit(`#${token}`);
});
afterEach(() => {
  cleanup();
  request.mockReset();
  vi.restoreAllMocks();
});

test("acceptance shows the actual workspace and access, requires one explicit submit and switches workspace", async () => {
  request.mockResolvedValueOnce(preview);
  let finish: ((value: unknown) => void) | undefined;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const navigate = vi
    .spyOn(browserNavigation, "assign")
    .mockImplementation(() => {});
  render(<InviteAccept />);
  expect(
    screen
      .getByRole("button", { name: t.acceptInvitation })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    await screen.findByRole("heading", { name: preview.organizationName }),
  ).toBeTruthy();
  expect(screen.getByText("Fictional Product")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0]).toBe("/api/crm");
  expect(body(0)).toEqual({ operation: "invitation-preview", token });
  const accept = screen.getByRole("button", { name: t.acceptInvitation });
  fireEvent.click(accept);
  fireEvent.click(accept);
  expect(request).toHaveBeenCalledTimes(2);
  expect(body(1)).toEqual({ operation: "invitation-accept", token });
  await act(async () => finish?.({ organizationId }));
  expect(navigate).toHaveBeenCalledWith(
    `/api/workspace?organizationId=${organizationId}`,
  );
  expect(sessionStorage.getItem(inviteTokenKey)).toBeNull();
});

test("the token is read from the fragment, kept in session storage and removed from the address bar", async () => {
  request.mockResolvedValueOnce(preview);
  render(<InviteAccept />);
  await screen.findByRole("heading", { name: preview.organizationName });
  expect(window.location.pathname).toBe("/invite");
  expect(window.location.hash).toBe("");
  expect(sessionStorage.getItem(inviteTokenKey)).toBe(token);
  for (const [url] of request.mock.calls)
    expect(String(url)).not.toContain(token);
});

test("a signed-out visitor signs in with a callback that never carries the token, then the stored token previews", async () => {
  request.mockRejectedValueOnce(new RequestError("UNAUTHORIZED"));
  const navigate = vi
    .spyOn(browserNavigation, "assign")
    .mockImplementation(() => {});
  const view = render(<InviteAccept />);
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      `/sign-in?callbackURL=${encodeURIComponent("/invite")}`,
    ),
  );
  expect(String(navigate.mock.calls[0]?.[0])).not.toContain(token);
  view.unmount();
  visit("");
  request.mockResolvedValueOnce(preview);
  render(<InviteAccept />);
  await screen.findByRole("heading", { name: preview.organizationName });
  expect(body(1)).toEqual({ operation: "invitation-preview", token });
});

test("a mismatched account cannot accept and can sign out with the invitation callback intact", async () => {
  request.mockRejectedValueOnce(new Error("INVITE_EMAIL_MISMATCH"));
  request.mockRejectedValueOnce(new Error("FORBIDDEN"));
  request.mockResolvedValueOnce({});
  const navigate = vi
    .spyOn(browserNavigation, "assign")
    .mockImplementation(() => {});
  render(<InviteAccept />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    t.errors.INVITE_EMAIL_MISMATCH,
  );
  expect(
    screen
      .getByRole("button", { name: t.acceptInvitation })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: t.inviteSignOut }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(t.errors.FORBIDDEN),
  );
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t.inviteSignOut }));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      `/sign-in?callbackURL=${encodeURIComponent("/invite")}`,
    ),
  );
  expect(request.mock.calls[1]?.[0]).toBe("/api/auth/sign-out");
  expect(sessionStorage.getItem(inviteTokenKey)).toBe(token);
});

test("an invitee who is already an active member is pointed to the workspace instead", async () => {
  request.mockResolvedValueOnce({ ...preview, alreadyMember: true });
  render(<InviteAccept />);
  expect(
    await screen.findByRole("heading", {
      name: t.inviteAlreadyMemberTitle.replace(
        "{workspace}",
        preview.organizationName,
      ),
    }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", {
        name: t.inviteOpenWorkspace.replace(
          "{workspace}",
          preview.organizationName,
        ),
      })
      .getAttribute("href"),
  ).toBe(`/api/workspace?organizationId=${organizationId}`);
  expect(screen.queryByRole("button", { name: t.acceptInvitation })).toBeNull();
  expect(sessionStorage.getItem(inviteTokenKey)).toBeNull();
});

test("invalid links and expired acceptance responses cannot navigate or silently join", async () => {
  const navigate = vi
    .spyOn(browserNavigation, "assign")
    .mockImplementation(() => {});
  visit("");
  const view = render(<InviteAccept />);
  expect(screen.queryByRole("button", { name: t.inviteSignOut })).toBeNull();
  expect(
    screen.getByRole("link", { name: t.backToWorkspace }).getAttribute("href"),
  ).toBe("/overview");
  expect((await screen.findByRole("alert")).textContent).toBe(
    t.errors.INVITE_UNAVAILABLE,
  );
  view.unmount();
  visit("#not-a-token");
  const damaged = render(<InviteAccept />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    t.errors.INVITE_UNAVAILABLE,
  );
  expect(request).not.toHaveBeenCalled();
  damaged.unmount();
  visit(`#${token}`);
  request.mockResolvedValueOnce(preview);
  request.mockRejectedValueOnce(new Error("INVITE_UNAVAILABLE"));
  render(<InviteAccept />);
  await screen.findByRole("heading", { name: preview.organizationName });
  fireEvent.click(screen.getByRole("button", { name: t.acceptInvitation }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    t.errors.INVITE_UNAVAILABLE,
  );
  expect(navigate).not.toHaveBeenCalled();
});

test("a link already sent as /invite/<token> moves the token into the fragment before anything else", async () => {
  const replace = vi
    .spyOn(browserNavigation, "replace")
    .mockImplementation(() => {});
  render(<LegacyInviteRedirect token={token} />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(`/invite#${token}`));
  expect(request).not.toHaveBeenCalled();
});
