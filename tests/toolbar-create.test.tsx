// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();

test.each([
  ["/companies", t.newCompany],
  ["/meetings", t.newMeeting],
])(
  "%s shows a toolbar button that opens its inline editor",
  async (path, name) => {
    await mountCrm(harness, path);
    const button = screen.getByRole("button", { name });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("C");
    fireEvent.click(button);
    expect(await screen.findByRole("region", { name })).toBeTruthy();
  },
);
