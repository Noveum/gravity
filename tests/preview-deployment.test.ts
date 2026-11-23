import { afterEach, expect, test, vi } from "vitest";
import { appUrl } from "../packages/auth/options";
import { previewAppUrl, runWithAppUrl } from "../packages/auth/origin";
import { previewAlias } from "../scripts/preview-alias";

const app = "https://gravity-pr.example-1a4.workers.dev";
afterEach(() => vi.unstubAllEnvs());

test("a branch becomes an alias that fits one DNS label with the Worker name", () => {
  expect(
    previewAlias("claude/crm-cloudflare-workers-00dac9", "gravity-pr"),
  ).toBe("claude-crm-cloudflare-workers-00dac9");
  expect(previewAlias("Fix/Sign_In--Page", "gravity-pr")).toBe(
    "fix-sign-in-page",
  );
  expect(previewAlias("123-hotfix", "gravity-pr")).toBe("branch-123-hotfix");
  const long = previewAlias(`feature/${"a-".repeat(60)}`, "gravity-pr");
  expect(`${long}-gravity-pr`.length).toBeLessThanOrEqual(63);
  expect(long).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
  expect(() => previewAlias("///", "gravity-pr")).toThrow(
    "PREVIEW_BRANCH_REQUIRED",
  );
});

test("only a version preview URL of the configured Worker becomes its own origin", () => {
  expect(
    previewAppUrl(
      "https://my-branch-gravity-pr.example-1a4.workers.dev/sign-in?x=1",
      app,
    ),
  ).toBe("https://my-branch-gravity-pr.example-1a4.workers.dev");
  for (const url of [
    `${app}/sign-in`,
    "https://gravity-pr.example-1a4.workers.dev.evil.example/",
    "https://my-branch-gravity.example-1a4.workers.dev/",
    "https://a.b-gravity-pr.example-1a4.workers.dev/",
    "https://-gravity-pr.example-1a4.workers.dev/",
    "http://my-branch-gravity-pr.example-1a4.workers.dev/",
    "https://my-branch-gravity-pr.example-1a4.workers.dev:8443/",
    "https://gravity.example.test/",
  ])
    expect(previewAppUrl(url, app)).toBeUndefined();
  expect(
    previewAppUrl(
      "https://my-branch-gravity.example.test/",
      "https://gravity.example.test",
    ),
  ).toBeUndefined();
  expect(
    previewAppUrl("https://x-gravity-pr.example-1a4.workers.dev/"),
  ).toBeUndefined();
});

test("a preview origin replaces APP_URL only inside its own request", async () => {
  vi.stubEnv("APP_URL", app);
  const preview = "https://my-branch-gravity-pr.example-1a4.workers.dev";
  const inside = runWithAppUrl(preview, async () => {
    await Promise.resolve();
    return appUrl();
  });
  expect(appUrl()).toBe(app);
  expect(await inside).toBe(preview);
  expect(runWithAppUrl(undefined, () => appUrl())).toBe(app);
});
