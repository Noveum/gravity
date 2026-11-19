import { expect, test } from "vitest";
import nextConfig from "../next.config";
import { assetHeadersFile } from "../worker/asset-headers";

test("static assets on Workers get every header next.config.ts sets", async () => {
  const rules = await nextConfig.headers();
  const file = assetHeadersFile(rules);
  expect(file.split("\n")[0]).toBe("/*");
  for (const { key, value } of rules.flatMap((rule) => rule.headers))
    expect(file).toContain(`\n  ${key}: ${value}\n`);
  expect(file).toContain("X-Frame-Options: DENY");
});

test("a header source the assets file cannot express fails the build", () => {
  expect(() =>
    assetHeadersFile([
      { source: "/api/:path*", headers: [{ key: "X-A", value: "1" }] },
    ]),
  ).toThrow("/api/:path*");
});
