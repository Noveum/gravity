// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { InviteAccept } from "../src/components/invite-accept";
import { browserNavigation } from "../src/components/shell/user-menu";

vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const request = vi.mocked(requestJson);
const token = "a".repeat(64);
const organizationId = "00000000-0000-4000-8000-000000000001";
const preview = {
  organizationName: "Fictional Team",
  email: "teammate@example.test",
  role: "member",
  products: ["Fictional Product"],
};
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
  render(<InviteAccept token={token} />);
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
  const accept = screen.getByRole("button", { name: t.acceptInvitation });
  fireEvent.click(accept);
  fireEvent.click(accept);
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
    operation: "invitation-accept",
    token,
  });
  await act(async () => finish?.({ organizationId }));
  expect(navigate).toHaveBeenCalledWith(
    `/api/workspace?organizationId=${organizationId}`,
  );
});

test("a mismatched account cannot accept and can sign out with the invitation callback intact", async () => {
  request.mockRejectedValueOnce(new Error("INVITE_EMAIL_MISMATCH"));
  request.mockResolvedValueOnce({});
  const navigate = vi
    .spyOn(browserNavigation, "assign")
    .mockImplementation(() => {});
  render(<InviteAccept token={token} />);
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
    expect(navigate).toHaveBeenCalledWith(
      `/sign-in?callbackURL=${encodeURIComponent(`/invite/${token}`)}`,
    ),
  );
  expect(request.mock.calls[1]?.[0]).toBe("/api/auth/sign-out");
});

test("invalid links and expired acceptance responses cannot navigate or silently join", async () => {
  const navigate = vi
    .spyOn(browserNavigation, "assign")
    .mockImplementation(() => {});
  const view = render(<InviteAccept token="" />);
  expect(screen.getByRole("alert").textContent).toBe(
    t.errors.INVITE_UNAVAILABLE,
  );
  expect(request).not.toHaveBeenCalled();
  view.unmount();
  request.mockResolvedValueOnce(preview);
  request.mockRejectedValueOnce(new Error("INVITE_UNAVAILABLE"));
  render(<InviteAccept token={token} />);
  await screen.findByRole("heading", { name: preview.organizationName });
  fireEvent.click(screen.getByRole("button", { name: t.acceptInvitation }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    t.errors.INVITE_UNAVAILABLE,
  );
  expect(navigate).not.toHaveBeenCalled();
});
