// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/app/globals.css", "utf8");
  document.head.append(style);
});

test("a list timeline keeps the same left inset as the person timeline", () => {
  document.body.innerHTML = `<section class="record-timeline"><ul class="timeline"><li class="timeline-event">A</li></ul></section><div class="timeline"></div>`;
  const list = document.querySelector("ul.timeline") as HTMLElement;
  const block = document.querySelector("div.timeline") as HTMLElement;
  expect(getComputedStyle(list).paddingLeft).toBe("6px");
  expect(getComputedStyle(list).paddingLeft).toBe(
    getComputedStyle(block).paddingLeft,
  );
});

test("group headers in the record timeline span the padded column edge to edge", () => {
  document.body.innerHTML = `<section class="record-timeline"><section class="activity-group"><h4 class="group-title">Upcoming</h4></section></section>`;
  const header = document.querySelector(".group-title") as HTMLElement;
  const style = getComputedStyle(header);
  expect(style.marginLeft).toBe("-24px");
  expect(style.marginRight).toBe("-24px");
  expect(style.paddingLeft).toBe("24px");
  expect(style.position).toBe("sticky");
  expect(style.top).toBe("0px");
  const column = getComputedStyle(
    document.querySelector(".record-timeline") as HTMLElement,
  );
  expect(column.paddingTop).toBe("0px");
  expect(
    getComputedStyle(document.querySelector(".activity-group") as HTMLElement)
      .marginTop,
  ).toBe("12px");
});
