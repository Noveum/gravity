// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { RequestError, requestJson } from "../src/components/client-api";
import { installCrmHarness, mountCrm } from "./support/crm-harness";
import { chooseSelect } from "./support/select-control";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("a slow planner does not delay reading an existing outreach queue", async () => {
  const request = vi.mocked(requestJson);
  const respond = request.getMockImplementation();
  if (!respond) throw new Error("Missing request fixture");
  request.mockImplementation(
    <T,>(url: string, init?: RequestInit): Promise<T> => {
      if (
        init?.method === "POST" &&
        JSON.parse(String(init.body)).operation === "advance"
      )
        return new Promise<never>(() => {});
      return respond(url, init) as Promise<T>;
    },
  );
  await mountCrm(harness, "/outreach/drafts");
  expect(
    await screen.findByRole("button", { name: /^Noor Haddad, / }),
  ).toBeTruthy();
  expect(harness.posts).toEqual([]);
});

test("a forbidden planning write leaves existing outreach readable", async () => {
  const request = vi.mocked(requestJson);
  const respond = request.getMockImplementation();
  if (!respond) throw new Error("Missing request fixture");
  request.mockImplementation(
    <T,>(url: string, init?: RequestInit): Promise<T> => {
      if (
        init?.method === "POST" &&
        JSON.parse(String(init.body)).operation === "advance"
      )
        return Promise.reject(new RequestError("FORBIDDEN"));
      return respond(url, init) as Promise<T>;
    },
  );
  await mountCrm(harness, "/outreach/drafts");
  expect(
    await screen.findByRole("button", { name: /^Noor Haddad, / }),
  ).toBeTruthy();
  expect(screen.queryByText(t.outreachLoadError)).toBeNull();
});

test("an empty saved view explains genuine absence and can recover across products", async () => {
  await mountCrm(harness, "/actions?kind=commitment");
  await chooseSelect(
    screen.getByRole("combobox", { name: t.product }),
    "AI Platform",
  );
  expect(await screen.findByText(t.actionEmpty.promisesTitle)).toBeTruthy();
  expect(screen.getByText(t.actionEmpty.promisesDetail)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: t.actionEmpty.viewAllProducts }),
  );
  expect(await screen.findByText("Prepare the pilot proposal")).toBeTruthy();
  expect(window.location.search).toContain("kind=commitment");
});

test("outreach distinguishes a filtered empty view and clearing filters recovers its rows", async () => {
  await mountCrm(harness, "/outreach/drafts?minimum=1000000");
  expect(await screen.findByText(t.outreachFilteredDetail)).toBeTruthy();
  const recovery = screen
    .getByText(t.outreachFilteredDetail)
    .closest(".empty-state");
  if (!recovery) throw new Error("Missing empty-state recovery");
  fireEvent.click(recovery.querySelector("button") as HTMLButtonElement);
  expect(
    await screen.findByRole("button", { name: /^Noor Haddad, / }),
  ).toBeTruthy();
  expect(window.location.search).toBe("");
});

test("explicit outreach sorting survives row rendering", async () => {
  await mountCrm(harness, "/outreach/drafts?sort=name_desc");
  await screen.findByRole("button", { name: /^Noor Haddad, / });
  await waitFor(() => {
    const names = [
      ...document.querySelectorAll(".touch-row > .action-row .row-name"),
    ].map((row) => row.textContent ?? "");
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
  });
});

test.each([
  [
    "/actions?kind=reply",
    t.actionEmpty.filteredDetail,
    "Answer the API format question",
  ],
  ["/outreach/drafts", t.outreachFilteredDetail, /^Noor Haddad, /],
])(
  "a custom-field rule distinguishes filtered absence and clears from %s",
  async (path, detail, recovered) => {
    const rule = JSON.stringify([
      {
        label: "Fictional missing field",
        type: "text",
        operator: "eq",
        value: "unmatched",
      },
    ]);
    await mountCrm(
      harness,
      `${path}${path.includes("?") ? "&" : "?"}fieldFilters=${encodeURIComponent(rule)}`,
    );
    const empty = (await screen.findByText(detail)).closest(".empty-state");
    if (!empty) throw new Error("Missing custom-field empty-state recovery");
    expect(empty.textContent).toContain(t.noResults);
    fireEvent.click(empty.querySelector("button") as HTMLButtonElement);
    if (typeof recovered === "string")
      expect(await screen.findByText(recovered)).toBeTruthy();
    else
      expect(
        await screen.findByRole("button", { name: recovered }),
      ).toBeTruthy();
    expect(window.location.search).not.toContain("fieldFilters");
    if (path.includes("kind=reply"))
      expect(window.location.search).toContain("kind=reply");
  },
);

test("a failed product-scoped load cannot reuse another product's queue", async () => {
  await mountCrm(harness, "/outreach/drafts");
  await screen.findByRole("button", { name: /^Noor Haddad, / });
  const request = vi.mocked(requestJson);
  const respond = request.getMockImplementation();
  if (!respond) throw new Error("Missing request fixture");
  request.mockImplementation(
    <T,>(url: string, init?: RequestInit): Promise<T> => {
      if (url.includes("productId=") && url.startsWith("/api/outreach?"))
        return Promise.reject(new RequestError("FORBIDDEN"));
      return respond(url, init) as Promise<T>;
    },
  );
  await chooseSelect(
    screen.getByRole("combobox", { name: t.product }),
    "Services",
  );
  expect(await screen.findByText(t.outreachLoadError)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Noor Haddad, / })).toBeNull();
});
