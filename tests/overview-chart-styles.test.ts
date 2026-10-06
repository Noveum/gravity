// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
});

test("each activity day's bar stack fills the day so its bars have a width", () => {
  document.body.innerHTML = `<div class="activity-chart"><button type="button" class="chart-day"><span class="bar-stack"><span class="activity-bar received" style="height: 40%"></span><span class="activity-bar sent" style="height: 20%"></span></span></button></div>`;
  const stack = document.querySelector(".bar-stack") as HTMLElement;
  expect(getComputedStyle(stack).width).toBe("100%");
  for (const bar of document.querySelectorAll<HTMLElement>(".activity-bar"))
    expect(getComputedStyle(bar).width).toBe("100%");
});

test("the received series and the won meter use the chart token in both themes", () => {
  expect(css).not.toMatch(/#44b592/i);
  for (const selector of [
    ".received-dot",
    ".activity-bar.received",
    ".stage-won .stage-meter",
  ]) {
    const rule = new RegExp(
      `\\}\\s*${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`,
    ).exec(css);
    expect(rule?.[1], selector).toContain(
      "background: var(--gravity-chart-positive)",
    );
  }
  const light = getComputedStyle(document.documentElement)
    .getPropertyValue("--gravity-chart-positive")
    .trim();
  document.documentElement.classList.add("dark");
  const dark = getComputedStyle(document.documentElement)
    .getPropertyValue("--gravity-chart-positive")
    .trim();
  document.documentElement.classList.remove("dark");
  expect(light).toMatch(/^#[0-9a-f]{6}$/i);
  expect(dark).toMatch(/^#[0-9a-f]{6}$/i);
  expect(dark).not.toBe(light);
});
