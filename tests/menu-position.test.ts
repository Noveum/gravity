import { expect, test } from "vitest";
import { menuPosition } from "../src/components/ui/menu-position";

test("menus flip above low anchors and fit narrow viewports", () => {
  const position = menuPosition(
    { left: 300, top: 500, bottom: 530 },
    { width: 256, height: 240 },
    { width: 360, height: 600 },
  );
  expect(position).toMatchObject({
    left: 96,
    top: 256,
    width: 256,
    maxHeight: 488,
  });
  const narrow = menuPosition(
    { left: 120, top: 30, bottom: 60 },
    { width: 256, height: 500 },
    { width: 220, height: 300 },
  );
  expect(narrow.left + narrow.width).toBeLessThanOrEqual(212);
  expect(narrow.top + narrow.maxHeight).toBeLessThanOrEqual(292);
  expect(narrow.left).toBe(8);
});
