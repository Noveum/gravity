import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { gravityIdentity } from "../packages/brand/identity";
import t from "../packages/i18n/translations/en.json";
import manifest from "../src/app/manifest";

test("basic deployments do not require scheduled cron while the hosted profile preserves its schedule", async () => {
  const basic = JSON.parse(await readFile("vercel.json", "utf8"));
  const scheduled = JSON.parse(await readFile("vercel.scheduled.json", "utf8"));
  const { crons, ...settings } = scheduled;
  expect(basic).toEqual(settings);
  expect(crons).toEqual([
    { path: "/api/integrations/cron", schedule: "*/5 * * * *" },
  ]);
  expect(basic.git.deploymentEnabled).toBe(false);
});

test("the fallback favicon contains valid PNGs in four browser sizes", async () => {
  const icon = await readFile("src/app/favicon.ico");
  expect(icon.readUInt16LE(0)).toBe(0);
  expect(icon.readUInt16LE(2)).toBe(1);
  expect(icon.readUInt16LE(4)).toBe(4);
  for (const [index, size] of [16, 32, 48, 64].entries()) {
    const entry = 6 + index * 16;
    const offset = icon.readUInt32LE(entry + 12);
    const length = icon.readUInt32LE(entry + 8);
    expect(icon[entry]).toBe(size);
    expect(icon[entry + 1]).toBe(size);
    expect(icon.subarray(offset, offset + 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(icon.readUInt32BE(offset + 16)).toBe(size);
    expect(icon.readUInt32BE(offset + 20)).toBe(size);
    expect(offset + length).toBeLessThanOrEqual(icon.length);
  }
});

test("the manifest names Gravity and references real app icons without private instance URLs", async () => {
  const data = manifest();
  expect(data.name).toBe(t.brand);
  expect(data.start_url).toBe("/actions");
  expect(data.icons).toHaveLength(2);
  for (const icon of data.icons ?? []) {
    const image = await readFile(`public${icon.src}`);
    expect(icon.sizes).toBe(
      `${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`,
    );
    expect(image.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  }
  const browser = await readFile("src/app/icon.svg", "utf8");
  expect(browser).toContain("prefers-color-scheme:dark");
  for (const path of [
    "src/app/icon.svg",
    "public/brand/gravity-mark.svg",
    "public/brand/gravity-mark-dark.svg",
  ])
    expect(await readFile(path, "utf8")).toContain(gravityIdentity.path);
});
