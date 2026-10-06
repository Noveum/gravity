// @vitest-environment jsdom

import { randomUUID } from "node:crypto";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { RequestError, requestJson } from "../src/components/client-api";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const own = demoId(1970);
const teammates = demoId(1971);
const reconciles: Record<string, unknown>[] = [];

beforeEach(async () => {
  reconciles.length = 0;
  const connection = randomUUID();
  await harness.local.db.insert(s.connections).values({
    id: connection,
    organizationId: demoId(1),
    productId: demoId(11),
    ownerId: "demo-teammate",
    provider: "unipile",
    externalAccountId: "fixture-teammate-linkedin",
    status: "connected",
  });
  const base = {
    organizationId: demoId(1),
    sourceVersion: 1,
    requestHash: "fixture",
    draft: "Fixture",
    status: "unknown" as const,
    createdAt: new Date(Date.now() - 600000),
  };
  await harness.local.db.insert(s.deliveries).values([
    {
      ...base,
      id: own,
      productId: demoId(10),
      relationshipId: demoId(304),
      ownerId: demoUser,
      connectionId: demoId(700),
      touchId: demoId(1304),
      idempotencyKey: "fixture-own-delivery",
      channel: "gmail",
      recipient: "person4@example.test",
    },
    {
      ...base,
      id: teammates,
      productId: demoId(11),
      relationshipId: demoId(305),
      ownerId: "demo-teammate",
      connectionId: connection,
      touchId: demoId(1310),
      idempotencyKey: "fixture-teammate-delivery",
      channel: "linkedin",
      recipient: "https://www.linkedin.com/in/fixture/",
    },
  ]);
  const harnessed = vi.mocked(requestJson).getMockImplementation();
  vi.mocked(requestJson).mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.operation === "reconcile-delivery") {
        reconciles.push(body);
        return { id: body.deliveryId, status: "sent", errorCode: null };
      }
    }
    if (!harnessed) throw new Error("harness");
    return harnessed(url, init);
  });
});

async function checks() {
  await mountCrm(harness, "/outreach/sent");
  return screen.findByRole("group", {
    name: `${t.deliveryChecks}: 2`,
  });
}
const personRow = (group: HTMLElement, name: string) => {
  const row = within(group)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(name));
  if (!row) throw new Error(`row ${name}`);
  return row;
};

describe("deliveries that need a check", () => {
  test("the Sent tab lists unresolved deliveries with the actions each one allows", async () => {
    const group = await checks();
    const mine = personRow(group, "Amara Stone");
    expect(mine.textContent).toContain(t.deliveryStatus.unknown);
    expect(
      within(mine).getByRole("button", { name: `${t.reconcile}: Amara Stone` }),
    ).toBeTruthy();
    expect(
      within(mine).getByRole("button", { name: `${t.resolve}: Amara Stone` }),
    ).toBeTruthy();
    const theirs = personRow(group, "Sam Rivera");
    expect(within(theirs).queryByRole("button", { name: /^Reconcile/ })).toBe(
      null,
    );
    expect(
      within(theirs).getByRole("button", { name: /^Resolve/ }),
    ).toBeTruthy();
  });

  test("Reconcile asks the provider for the receipt without resending", async () => {
    const group = await checks();
    fireEvent.click(
      within(personRow(group, "Amara Stone")).getByRole("button", {
        name: `${t.reconcile}: Amara Stone`,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: t.reconcileTitle.replace("{name}", "Amara Stone"),
    });
    expect(within(dialog).queryByLabelText(t.reconcileMessageId)).toBe(null);
    fireEvent.click(within(dialog).getByRole("button", { name: t.reconcile }));
    await screen.findByText(t.reconciled.replace("{name}", "Amara Stone"));
    expect(reconciles).toEqual([
      expect.objectContaining({
        operation: "reconcile-delivery",
        deliveryId: own,
      }),
    ]);
    expect(reconciles[0]).not.toHaveProperty("idempotencyKey");
  });

  test("an admin resolves a stuck delivery with an outcome, a reason and an explicit confirmation", async () => {
    const group = await checks();
    const theirs = personRow(group, "Sam Rivera");
    fireEvent.click(within(theirs).getByRole("button", { name: /^Resolve/ }));
    const dialog = await screen.findByRole("dialog", {
      name: /^Resolve the send/,
    });
    fireEvent.change(within(dialog).getByLabelText(t.resolveOutcome), {
      target: { value: "failed" },
    });
    fireEvent.change(within(dialog).getByLabelText(t.resolveReason), {
      target: { value: "absent_in_provider" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t.resolve }));
    expect(
      screen.getByRole("dialog", { name: /^Resolve the send/ }),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText(t.resolveConfirm));
    fireEvent.click(within(dialog).getByRole("button", { name: t.resolve }));
    await waitFor(async () => {
      const [row] = await harness.local.db
        .select()
        .from(s.deliveries)
        .where(eq(s.deliveries.id, teammates));
      expect(row).toMatchObject({
        status: "failed",
        errorCode: "RESOLVED_ABSENT_IN_PROVIDER",
      });
    });
    expect(
      await screen.findByRole("group", { name: `${t.deliveryChecks}: 1` }),
    ).toBeTruthy();
  });

  test("a delivery the provider accepted can only be resolved as sent", async () => {
    await harness.local.db
      .update(s.deliveries)
      .set({ status: "accepted", externalMessageId: "fixture-accepted" })
      .where(eq(s.deliveries.id, teammates));
    const group = await checks();
    const theirs = personRow(group, "Sam Rivera");
    fireEvent.click(within(theirs).getByRole("button", { name: /^Resolve/ }));
    const dialog = await screen.findByRole("dialog", {
      name: /^Resolve the send/,
    });
    const outcome = within(dialog).getByLabelText(
      t.resolveOutcome,
    ) as HTMLSelectElement;
    expect([...outcome.options].map((option) => option.value)).toEqual([
      "sent",
    ]);
  });
});

describe("fetching deliveries", () => {
  const deliveryCalls = () =>
    vi
      .mocked(requestJson)
      .mock.calls.filter(([url]) =>
        String(url).includes("operation=deliveries"),
      );

  test("only the Sent tab asks for deliveries", async () => {
    vi.mocked(requestJson).mockClear();
    await mountCrm(harness, "/outreach/today");
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() =>
      expect(
        vi
          .mocked(requestJson)
          .mock.calls.some(([url]) => String(url).includes("/api/outreach")),
      ).toBe(true),
    );
    expect(deliveryCalls()).toHaveLength(0);
  });

  test("a failed delivery fetch is reported instead of silently emptying the list", async () => {
    const previous = vi.mocked(requestJson).getMockImplementation();
    vi.mocked(requestJson).mockImplementation(async (url, init) => {
      if (String(url).includes("operation=deliveries"))
        throw new RequestError("RATE_LIMITED");
      if (!previous) throw new Error("harness");
      return previous(url, init);
    });
    await mountCrm(harness, "/outreach/sent");
    const alert = await screen.findByText(t.errors.RATE_LIMITED);
    expect(alert.closest('[role="alert"]')).toBeTruthy();
  });
});
