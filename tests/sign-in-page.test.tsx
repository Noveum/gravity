import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DomainError } from "../packages/core/policy";

const principal = vi.fn();
let demo = false;
vi.mock("@crm/auth/server", () => ({
  currentPrincipal: (...args: unknown[]) => principal(...args),
}));
vi.mock("@crm/database/client", () => ({ isDemoMode: () => demo }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
}));

import Page from "../src/app/sign-in/page";

beforeEach(() => {
  demo = false;
  principal.mockReset();
  vi.stubEnv("APP_URL", "https://crm.example.test");
});
afterEach(() => vi.unstubAllEnvs());

test("authenticated visits leave sign-in for the workspace or a safe callback", async () => {
  principal.mockResolvedValue({ userId: "real-session", source: "session" });
  for (const [callbackURL, expected] of [
    [undefined, "/actions"],
    ["/onboarding?from=login", "/onboarding?from=login"],
    ["https://evil.example", "/actions"],
    ["/sign-in?callbackURL=/sign-in", "/actions"],
    ["/%73ign-in/", "/actions"],
  ]) {
    await expect(
      Page({ searchParams: Promise.resolve({ callbackURL }) }),
    ).rejects.toThrow(`REDIRECT:${expected}`);
  }
});

test("authenticated MCP visits preserve signed values and repeated parameters for product selection", async () => {
  principal.mockResolvedValue({ userId: "real-session", source: "session" });
  const request = {
    sig: "signed value",
    client_id: "assistant",
    ba_param: ["scope", "state"],
    scope: "crm:read offline_access",
    redirect_uri: "http://127.0.0.1:9999/callback",
  };
  const expected = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (Array.isArray(value))
      for (const item of value) expected.append(key, item);
    else expected.append(key, value);
  }
  await expect(
    Page({ searchParams: Promise.resolve(request) }),
  ).rejects.toThrow(`REDIRECT:/authorize?${expected}`);
});

test("anonymous and unconfigured visits retain login while unexpected failures are surfaced", async () => {
  for (const code of ["UNAUTHORIZED", "AUTH_UNAVAILABLE"]) {
    principal.mockRejectedValueOnce(new DomainError(code, 401));
    expect(await Page({ searchParams: Promise.resolve({}) })).toBeTruthy();
  }
  principal.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "database unavailable",
  );
  demo = true;
  principal.mockClear();
  expect(await Page({ searchParams: Promise.resolve({}) })).toBeTruthy();
  expect(principal).not.toHaveBeenCalled();
});
