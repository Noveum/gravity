// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();

test("a contact's deal opens directly, previews weighted revenue and persists all forecast fields", async () => {
  await mountCrm(harness, `/people/${demoId(200)}`);
  fireEvent.click(
    await screen.findByRole("button", { name: /Northstar evaluation project/ }),
  );
  const dialog = screen.getByRole("region", { name: t.editOpportunity });
  fireEvent.change(within(dialog).getByLabelText(t.amount), {
    target: { value: "1234.56" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.probability), {
    target: { value: "50" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.expectedCloseDate), {
    target: { value: "2030-02-03" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.tags), {
    target: { value: "enterprise" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.dealDescription), {
    target: { value: "Fictional scoped evaluation" },
  });
  expect(
    within(dialog).getByRole("status", { name: t.expectedRevenue }).textContent,
  ).toContain("$617.28");
  fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: /opportunity/ })).toBeNull(),
  );
  expect(harness.posts.find((post) => post.operation === "deal")).toMatchObject(
    {
      amountMinor: 123456,
      probability: 50,
      expectedCloseDate: "2030-02-03",
      tags: ["enterprise"],
      description: "Fictional scoped evaluation",
      version: 1,
    },
  );
  const row = await screen.findByRole("button", {
    name: /Northstar evaluation project/,
  });
  await waitFor(() => expect(row.textContent).toContain("$1,234.56"));
  expect(row.textContent).toContain("$617.28");
});

test("creating a deal from a relationship preselects its person, product, pipeline and owner", async () => {
  await mountCrm(harness, `/people/${demoId(201)}`);
  fireEvent.click(await screen.findByRole("button", { name: t.newDeal }));
  const dialog = screen.getByRole("region", { name: t.newOpportunity });
  expect(within(dialog).getByLabelText(t.person)).toHaveProperty(
    "value",
    demoId(301),
  );
  expect(within(dialog).getByLabelText(t.amount)).toHaveProperty("value", "");
  fireEvent.change(within(dialog).getByLabelText(t.name), {
    target: { value: "Fictional pilot" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.amount), {
    target: { value: "5000" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.probability), {
    target: { value: "40" },
  });
  expect(
    within(dialog).getByRole("status", { name: t.expectedRevenue }).textContent,
  ).toContain("$2,000.00");
  fireEvent.click(within(dialog).getByRole("button", { name: t.create }));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: /opportunity/ })).toBeNull(),
  );
  expect(harness.posts.find((post) => post.operation === "deal")).toMatchObject(
    {
      productId: demoId(11),
      relationshipId: demoId(301),
      amountMinor: 500000,
      probability: 40,
    },
  );
});

test("invalid currency has an input error; unknown, zero, won and lost forecasts stay distinct", async () => {
  await mountCrm(harness, "/opportunities");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Northstar evaluation project",
    }),
  );
  const dialog = screen.getByRole("region", { name: t.editOpportunity });
  expect(
    within(dialog).getByRole("status", { name: t.expectedRevenue }).textContent,
  ).toContain(t.forecastUnknown);
  fireEvent.change(within(dialog).getByLabelText(t.amount), {
    target: { value: "100.25" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.currency), {
    target: { value: "ZZZ" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
  expect(
    await within(dialog).findByText(t.errors.INVALID_INPUT),
  ).toHaveProperty("textContent", t.errors.INVALID_INPUT);
  expect(harness.posts).toHaveLength(0);
  fireEvent.change(within(dialog).getByLabelText(t.currency), {
    target: { value: "USD" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.probability), {
    target: { value: "0" },
  });
  expect(
    within(dialog).getByRole("status", { name: t.expectedRevenue }).textContent,
  ).toContain("$0.00");
  const won = within(dialog).getByRole("option", {
    name: "Won",
  }) as HTMLOptionElement;
  fireEvent.change(within(dialog).getByLabelText(t.stage), {
    target: { value: won.value },
  });
  expect(within(dialog).getByLabelText(t.probability)).toHaveProperty(
    "value",
    "100",
  );
  expect(
    within(dialog).getByRole("status", { name: t.expectedRevenue }).textContent,
  ).toContain("$100.25");
  const lost = within(dialog).getByRole("option", {
    name: "Lost",
  }) as HTMLOptionElement;
  fireEvent.change(within(dialog).getByLabelText(t.stage), {
    target: { value: lost.value },
  });
  expect(
    within(dialog).getByRole("status", { name: t.expectedRevenue }).textContent,
  ).toContain("$0.00");
});

test("switching products clears an incompatible pipeline and stage instead of hiding the board", async () => {
  const [pipeline] = await harness.local.db
    .select()
    .from(s.pipelines)
    .where(eq(s.pipelines.productId, demoId(10)));
  if (!pipeline) throw new Error("missing pipeline fixture");
  await mountCrm(
    harness,
    `/opportunities?pipeline=${pipeline.id}&stage=${demoId(801)}`,
  );
  fireEvent.change(screen.getByRole("combobox", { name: t.product }), {
    target: { value: demoId(11) },
  });
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(screen.getByRole("combobox", { name: t.pipeline })).toHaveProperty(
    "value",
    "",
  );
  fireEvent.click(screen.getByRole("button", { name: t.inlineEditing.board }));
  expect(screen.getByText(t.inlineEditing.noOpportunities)).toBeTruthy();
});

test("overview forecasts use deals, exclude contact estimates and disclose incomplete coverage", async () => {
  const [deal] = await harness.local.db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.relationshipId, demoId(300)));
  if (!deal) throw new Error("missing opportunity fixture");
  await harness.local.db
    .update(s.opportunities)
    .set({ amountMinor: 500000, probability: 40 })
    .where(eq(s.opportunities.id, deal.id));
  await harness.local.db
    .update(s.opportunities)
    .set({ probability: null })
    .where(eq(s.opportunities.id, demoId(1100)));
  await harness.local.db
    .update(s.people)
    .set({ amountMinor: 9000000 })
    .where(eq(s.people.id, demoId(200)));
  await mountCrm(harness, "/overview");
  expect(
    screen.getByRole("button", { name: `${t.expectedRevenue}: $2,000.00` }),
  ).toBeTruthy();
  expect(screen.getByText(/1 of 2 open deals included/)).toBeTruthy();
});
