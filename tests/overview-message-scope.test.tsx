// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { useLayoutEffect } from "react";
import { expect, test, vi } from "vitest";
import { type ClientSnapshot, serialize } from "../packages/core/dto";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { apiOperation } from "../packages/operations/catalog";
import { requestJson } from "../src/components/client-api";
import { useWorkspaceData } from "../src/components/crm/crm-context";
import { OverviewView } from "../src/components/views/overview-view";
import { installCrmHarness, principal } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
vi.mock("../src/components/crm/crm-context", async (original) => ({
  ...(await original<typeof import("../src/components/crm/crm-context")>()),
  useWorkspaceData: vi.fn(),
}));

const harness = installCrmHarness();
const preview =
  "Here is the evaluation workflow we discussed. Happy to help with the shortlist.";
const report = () => {
  const element = document.querySelector<HTMLElement>(".inline-report");
  if (!element) throw new Error("Missing overview report");
  return within(element);
};
const snapshot = async () =>
  serialize(
    await harness.service.snapshot(principal, {
      organizationId: demoId(1),
    }),
  );
function workspace(data: ClientSnapshot) {
  const context: Partial<ReturnType<typeof useWorkspaceData>> = {
    userId: demoUser,
    organizationId: demoId(1),
    productId: "",
    data,
    sourceData: data,
    timeZone: "UTC",
    personFor: (id: string) =>
      data.people.find(
        (person) =>
          person.id ===
          data.relationships.find((relationship) => relationship.id === id)
            ?.personId,
      ),
    product: (id: string) => data.products.find((product) => product.id === id),
    openPerson: vi.fn(),
    openRecordDialog: vi.fn(),
  };
  vi.mocked(useWorkspaceData).mockReturnValue(
    context as ReturnType<typeof useWorkspaceData>,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a visibility refresh hides message previews before passive effects and awaits current authorization", async () => {
  const pending = deferred<unknown>();
  let refreshed = false;
  let pendingQuery = new URLSearchParams();
  vi.mocked(requestJson).mockImplementation(async (url) => {
    const params = new URL(url, "http://localhost").searchParams;
    if (refreshed) {
      pendingQuery = params;
      return pending.promise;
    }
    return serialize(
      await apiOperation("crm", "GET", "messageActivity").execute(
        { db: harness.local.db, principal },
        Object.fromEntries(params),
      ),
    );
  });
  const before = await snapshot();
  workspace(before);
  const captured: { scope: string; preview: boolean; loading: boolean }[] = [];
  function BeforeEffects({ scope }: { scope: string }) {
    useLayoutEffect(() => {
      const drawer = document.querySelector(".inline-report");
      captured.push({
        scope,
        preview: drawer?.textContent?.includes(preview) ?? false,
        loading: drawer?.querySelector('[role="status"]') !== null,
      });
    }, [scope]);
    return null;
  }
  const mounted = render(
    <>
      <OverviewView />
      <BeforeEffects scope={before.asOf} />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: `${t.messagesSent}: 1` }));
  expect(await report().findByText(preview)).toBeTruthy();

  // The previously shared thread is now private to a different current member.
  await harness.local.db
    .update(s.conversations)
    .set({ visibility: "private", ownerId: "demo-teammate" })
    .where(eq(s.conversations.id, demoId(710)));
  const after = await snapshot();
  expect(after.messageStats).toHaveLength(before.messageStats.length - 2);
  refreshed = true;
  workspace(after);
  mounted.rerender(
    <>
      <OverviewView />
      <BeforeEffects scope={after.asOf} />
    </>,
  );
  expect(captured.at(-1)).toEqual({
    scope: after.asOf,
    preview: false,
    loading: true,
  });
  expect(report().queryByText(preview)).toBeNull();
  expect(report().getByRole("button", { name: t.nextPage })).toHaveProperty(
    "disabled",
    true,
  );
  expect(pendingQuery.get("_snapshot")).toBe(after.asOf);

  const authorized = serialize(
    await apiOperation("crm", "GET", "messageActivity").execute(
      { db: harness.local.db, principal },
      Object.fromEntries(pendingQuery),
    ),
  );
  await act(async () => pending.resolve(authorized));
  expect(report().getByText(t.noReportRows)).toBeTruthy();
  expect(report().queryByText(preview)).toBeNull();
});

test("an obsolete message request cannot replace the current snapshot's response", async () => {
  const obsolete = deferred<unknown>();
  const current = deferred<unknown>();
  const signals: (AbortSignal | null | undefined)[] = [];
  vi.mocked(requestJson).mockImplementation((_url, init) => {
    signals.push(init?.signal);
    return signals.length === 1 ? obsolete.promise : current.promise;
  });
  const before = await snapshot();
  workspace(before);
  const mounted = render(<OverviewView />);
  fireEvent.click(screen.getByRole("button", { name: `${t.messagesSent}: 1` }));
  const after = {
    ...before,
    asOf: new Date(Date.parse(before.asOf) + 1).toISOString(),
  };
  workspace(after);
  mounted.rerender(<OverviewView />);
  expect(signals).toHaveLength(2);
  expect(signals[0]?.aborted).toBe(true);
  await act(async () => current.resolve({ items: [], hasMore: false }));
  expect(report().getByText(t.noReportRows)).toBeTruthy();

  // Deliberately emulate a transport that still resolves after cancellation.
  await act(async () =>
    obsolete.resolve({
      items: [
        {
          id: demoId(9999),
          relationshipId: demoId(300),
          productId: demoId(10),
          direction: "outbound",
          channel: "gmail",
          occurredAt: before.asOf,
          preview,
        },
      ],
      hasMore: true,
    }),
  );
  expect(report().queryByText(preview)).toBeNull();
  expect(report().getByText(t.noReportRows)).toBeTruthy();
  expect(report().getByRole("button", { name: t.nextPage })).toHaveProperty(
    "disabled",
    true,
  );
});
