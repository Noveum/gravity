// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { serialize } from "../packages/core/dto";
import * as s from "../packages/database/schema";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { apiOperation } from "../packages/operations/catalog";
import { requestJson } from "../src/components/client-api";
import { installCrmHarness, mountCrm, principal } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const report = () => {
  const element = document.querySelector<HTMLElement>(".inline-report");
  if (!element) throw new Error("Missing overview report");
  return within(element);
};

test("revenue reports expose all deal fields and distinguish pipeline from weighted forecast", async () => {
  await harness.local.db
    .update(s.opportunities)
    .set({ amountMinor: 500000, probability: 40 })
    .where(eq(s.opportunities.id, demoId(1101)));
  await harness.local.db
    .update(s.opportunities)
    .set({ amountMinor: null, probability: null })
    .where(eq(s.opportunities.id, demoId(1100)));
  await mountCrm(harness, "/overview");

  const pipelineMetric = screen.getByRole("button", {
    name: `${t.pipelineValue}: $5,000.00`,
  });
  pipelineMetric.focus();
  fireEvent.click(pipelineMetric);
  const pipeline = report();
  const table = pipeline.getByRole("table");
  for (const name of [
    t.dealName,
    t.product,
    t.stage,
    t.owner,
    t.dealAmount,
    t.forecastProbability,
    t.expectedRevenue,
    t.expectedCloseDate,
  ])
    expect(within(table).getByRole("columnheader", { name })).toBeTruthy();
  expect(pipeline.getByText(t.pipelineValueNote)).toBeTruthy();
  expect(within(table).getByText("$5,000.00")).toBeTruthy();
  expect(within(table).getByText("40%")).toBeTruthy();
  expect(within(table).getByText("$2,000.00")).toBeTruthy();
  expect(within(table).getByText("Cedar workflow pilot")).toBeTruthy();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(document.querySelector(".inline-report")).toBeNull();
  expect(document.activeElement).toBe(pipelineMetric);

  fireEvent.click(
    screen.getByRole("button", { name: `${t.expectedRevenue}: $2,000.00` }),
  );
  expect(report().getByText(t.forecastFormula)).toBeTruthy();
  expect(report().getByText(t.forecastIncludedDeals)).toBeTruthy();
  expect(report().queryByText("Cedar workflow pilot")).toBeNull();
  fireEvent.click(
    report().getByRole("button", { name: "Northstar evaluation project" }),
  );
  expect(screen.getByRole("region", { name: t.editOpportunity })).toBeTruthy();
});

test("activity chart shows real series totals and opens the selected day's history", async () => {
  const request = vi.mocked(requestJson);
  const original = request.getMockImplementation();
  request.mockImplementation((url, init) => {
    const params = new URL(url, "http://localhost").searchParams;
    if (params.get("operation") === "messageActivity")
      return apiOperation("crm", "GET", "messageActivity")
        .execute(
          { db: harness.local.db, principal },
          Object.fromEntries(params),
        )
        .then(serialize);
    if (!original) throw new Error("Missing CRM request harness");
    return original(url, init);
  });
  await mountCrm(harness, "/overview");
  const chart = screen.getByRole("group", { name: t.messageActivity });
  const days = within(chart).getAllByRole("button");
  expect(days).toHaveLength(30);
  const active = days.find((day) =>
    day.getAttribute("aria-label")?.includes(`${t.messagesSent} 1`),
  );
  if (!active) throw new Error("Missing fictional sent-message day");
  expect(active.querySelector(".activity-bar.sent")?.textContent).toBe("1");
  expect(screen.queryByText(t.activityEmptyTitle)).toBeNull();
  fireEvent.click(active);
  expect(
    await report().findByText(
      "Here is the evaluation workflow we discussed. Happy to help with the shortlist.",
    ),
  ).toBeTruthy();
  expect(report().getByRole("columnheader", { name: t.channel })).toBeTruthy();
  expect(
    report().getByRole("columnheader", { name: t.activityDate }),
  ).toBeTruthy();
});

test("zero message activity explains the empty state and offers a connection recovery link", async () => {
  await harness.local.db
    .delete(s.messages)
    .where(eq(s.messages.organizationId, demoId(1)));
  await mountCrm(harness, "/overview");
  expect(screen.getByText(t.activityEmptyTitle)).toBeTruthy();
  expect(screen.getByText(t.activityEmptyDescription)).toBeTruthy();
  expect(screen.queryByRole("group", { name: t.messageActivity })).toBeNull();
  expect(
    screen
      .getByRole("link", { name: t.reviewConnections })
      .getAttribute("href"),
  ).toBe("/settings/connections");
  expect(
    screen.getByRole("button", { name: `${t.messagesSent}: 0` }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: `${t.repliesReceived}: 0` }),
  ).toBeTruthy();
});
