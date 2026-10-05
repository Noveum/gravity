import { afterEach, expect, test, vi } from "vitest";

const scheduled = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after: scheduled }));

import { databaseOptions } from "../packages/database/config";
import { allowIdleDatabaseRelease } from "../packages/database/lifecycle";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  scheduled.mockReset();
});

test("local scripts and builds do not require a Next request lifecycle", () => {
  vi.stubEnv("VERCEL_URL", "fictional-build.vercel.app");
  vi.stubEnv("VERCEL_REGION", "");
  allowIdleDatabaseRelease();
  expect(scheduled).not.toHaveBeenCalled();
});

test("a completed Vercel response retains execution beyond the driver's idle-release timer", async () => {
  vi.stubEnv("VERCEL_URL", "fictional.vercel.app");
  vi.stubEnv("VERCEL_REGION", "hnd1");
  vi.useFakeTimers();
  allowIdleDatabaseRelease();
  const work = scheduled.mock.calls[0][0]() as Promise<void>;
  let finished = false;
  void work.then(() => {
    finished = true;
  });
  const idleSeconds = databaseOptions("postgres://app:fixture@localhost/db", {
    DATABASE_SSL_MODE: "disable",
  }).idle_timeout as number;
  await vi.advanceTimersByTimeAsync(idleSeconds * 1000);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(101);
  await work;
  expect(finished).toBe(true);
});
