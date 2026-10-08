// @vitest-environment jsdom
import { createHmac } from "node:crypto";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  type YoduEventPage,
  YoduService,
  type YoduSources,
} from "../packages/connectors/yodu";
import { type JsonValue, serialize } from "../packages/core/dto";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { YoduLifecyclePanel } from "../src/components/records/yodu-lifecycle";
import { YoduSettings } from "../src/components/yodu-settings";
import { installCrmHarness, principal } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (original) => ({
  ...(await original<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
const harness = installCrmHarness();
const scope = { organizationId: demoId(1), productId: demoId(10) };
beforeEach(() => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("APP_URL", "https://gravity.example.test");
});
afterEach(() => vi.unstubAllEnvs());

async function settings(productId = scope.productId) {
  const data = serialize(
    await harness.service.snapshot(principal, {
      organizationId: scope.organizationId,
    }),
  );
  const changed = vi.fn(async () => {});
  const view = render(
    <YoduSettings
      data={data}
      organizationId={scope.organizationId}
      productId={productId}
      demo={false}
      onChanged={changed}
      timeZone="UTC"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: t.connectionSetup }));
  return { ...view, changed, data };
}
async function signedEvent(
  sourceId: string,
  secret: string,
  eventId = "fictional-payment",
) {
  const raw = new TextEncoder().encode(
    JSON.stringify({
      eventId,
      externalSubjectId: "fictional-workspace",
      kind: "payment",
      occurredAt: "2026-10-06T12:34:56.789Z",
    }),
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
  return new YoduService(harness.local.db).ingest(
    sourceId,
    raw,
    `t=${timestamp},v1=${digest}`,
  );
}
test("source setup, versioned association and contact evidence use the business registry without leaking saved secrets", async () => {
  const { changed } = await settings();
  const create = await screen.findByRole("button", { name: t.yodu.create });
  const createForm = within(create.closest("form") as HTMLFormElement);
  fireEvent.change(createForm.getByLabelText(t.yodu.sourceLabel), {
    target: { value: "Fictional authoritative backend" },
  });
  fireEvent.click(create);
  const password = (await screen.findByLabelText(
    t.signingSecret,
  )) as HTMLInputElement;
  const secret = password.value;
  expect(secret).toBeTruthy();
  expect(password.type).toBe("password");
  expect(changed).toHaveBeenCalledTimes(1);
  const [stored] = await harness.local.db.select().from(s.yoduSources);
  expect(stored.encryptedSecret).not.toContain(secret);
  fireEvent.click(screen.getByRole("button", { name: t.done }));
  expect(screen.queryByLabelText(t.signingSecret)).toBeNull();
  await signedEvent(stored.id, secret);
  fireEvent.click(screen.getByRole("button", { name: t.yodu.refresh }));
  expect(await screen.findByText(t.yodu.kinds.payment)).toBeTruthy();
  expect(screen.getByText(t.yodu.proof)).toBeTruthy();
  const mapping = within(
    screen.getByLabelText(t.yodu.subject).closest("form") as HTMLFormElement,
  );
  fireEvent.change(mapping.getByLabelText(t.yodu.subject), {
    target: { value: "fictional-workspace" },
  });
  fireEvent.change(mapping.getByLabelText(t.yodu.relationship), {
    target: { value: demoId(300) },
  });
  fireEvent.click(mapping.getByRole("button", { name: t.yodu.bind }));
  await waitFor(() =>
    expect(harness.posts.at(-1)?.operation).toBe("yodu-bind-subject"),
  );
  const binding = await waitFor(async () => {
    const [row] = await harness.local.db.select().from(s.yoduBindings);
    expect(row.relationshipId).toBe(demoId(300));
    return row;
  });
  const reassociation = within(
    (
      await screen.findByText(
        "Fictional authoritative backend · fictional-workspace",
      )
    ).closest("form") as HTMLFormElement,
  );
  fireEvent.change(reassociation.getByLabelText(t.yodu.relationship), {
    target: { value: demoId(304) },
  });
  fireEvent.click(reassociation.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(harness.posts.at(-1)).toMatchObject({
      expectedVersion: binding.version,
      relationshipId: demoId(304),
    }),
  );
  await waitFor(async () => {
    const [row] = await harness.local.db.select().from(s.yoduBindings);
    expect(row.version).toBe(binding.version + 1);
  });
  const rotatedSecret = secret;
  fireEvent.click(screen.getByRole("button", { name: t.yodu.rotate }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText(t.signingSecret) as HTMLInputElement).value,
    ).not.toBe(rotatedSecret),
  );
  fireEvent.click(screen.getByRole("button", { name: t.done }));
  const cards = screen
    .getByText(t.yodu.kinds.payment)
    .closest("article") as HTMLElement;
  const evidence = within(cards);
  const occurredTime = cards.querySelector("time");
  expect(occurredTime?.getAttribute("datetime")).toBe(
    "2026-10-06T12:34:56.789Z",
  );
  expect(occurredTime?.textContent).toContain("12:34:56.789");
  expect(evidence.getByText("2026-10-06T12:34:56.789Z")).toBeTruthy();
  expect(evidence.getByText("fictional-payment")).toBeTruthy();
  expect(evidence.getByText(stored.id)).toBeTruthy();
  expect(evidence.getByText("1")).toBeTruthy();
  expect(
    (await new YoduService(harness.local.db).sources(principal, scope)).sources,
  ).not.toContainEqual(expect.objectContaining({ signingSecret: secret }));
  render(
    <YoduLifecyclePanel
      {...scope}
      relationshipId={demoId(304)}
      timeZone="UTC"
    />,
  );
  const contactEvidence = within(
    screen.getByRole("region", { name: t.yodu.title }),
  );
  expect(await contactEvidence.findByText(t.yodu.kinds.payment)).toBeTruthy();
  expect(contactEvidence.getByText("fictional-payment")).toBeTruthy();
  expect(contactEvidence.queryByLabelText(t.signingSecret)).toBeNull();
});

test("current member access leaves source evidence readable and removes administrator controls", async () => {
  await harness.local.db
    .update(s.memberships)
    .set({ role: "member" })
    .where(
      and(
        eq(s.memberships.organizationId, scope.organizationId),
        eq(s.memberships.userId, demoUser),
      ),
    );
  await harness.local.db
    .insert(s.productMemberships)
    .values({ ...scope, userId: demoUser })
    .onConflictDoNothing();
  await settings();
  expect(await screen.findByText(t.yodu.adminNote)).toBeTruthy();
  expect(screen.queryByRole("button", { name: t.yodu.create })).toBeNull();
  expect(screen.queryByRole("button", { name: t.yodu.rotate })).toBeNull();
  expect(screen.queryByLabelText(t.signingSecret)).toBeNull();
  expect(harness.posts).toEqual([]);
});

test("a customer association beyond the first 200 remains editable in Connections without event receipts", async () => {
  const saved = await new YoduService(harness.local.db).createSource(
    principal,
    {
      ...scope,
      sourceId: crypto.randomUUID(),
      label: "Fictional paged backend",
    },
  );
  await harness.local.db.insert(s.yoduBindings).values(
    Array.from({ length: 201 }, (_, index) => ({
      ...scope,
      sourceId: saved.id,
      externalSubjectId: `fictional-ui-empty-${String(index).padStart(3, "0")}`,
      relationshipId: demoId(300),
      createdBy: demoUser,
    })),
  );
  await settings();
  fireEvent.click(
    await screen.findByRole("button", { name: t.yodu.loadMoreBindings }),
  );
  const last = within(
    (
      await screen.findByText(
        "Fictional paged backend · fictional-ui-empty-200",
      )
    ).closest("form") as HTMLFormElement,
  );
  expect(
    screen.queryByRole("button", { name: t.yodu.loadMoreBindings }),
  ).toBeNull();
  fireEvent.change(last.getByLabelText(t.yodu.relationship), {
    target: { value: demoId(304) },
  });
  fireEvent.click(last.getByRole("button", { name: t.save }));
  await waitFor(() =>
    expect(harness.posts.at(-1)).toMatchObject({
      operation: "yodu-bind-subject",
      externalSubjectId: "fictional-ui-empty-200",
      expectedVersion: 1,
      relationshipId: demoId(304),
    }),
  );
  await waitFor(async () => {
    const [binding] = await harness.local.db
      .select()
      .from(s.yoduBindings)
      .where(
        and(
          eq(s.yoduBindings.sourceId, saved.id),
          eq(s.yoduBindings.externalSubjectId, "fictional-ui-empty-200"),
        ),
      );
    expect(binding).toMatchObject({ version: 2, relationshipId: demoId(304) });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function page(
  label: string,
  relationshipId = demoId(300),
): JsonValue<YoduEventPage> {
  return {
    events: [
      {
        id: demoId(1000),
        sourceId: demoId(1001),
        sourceLabel: label,
        sourceEnabled: true,
        externalSubjectId: "fictional-workspace",
        providerEventId: label,
        kind: "signup",
        occurredAt: "2026-10-06T12:34:56.789Z",
        receivedAt: "2026-10-08T10:00:00.000Z",
        payloadHash: "ab".repeat(32),
        sourceVersion: 1,
        relationshipId,
        bindingVersion: 1,
        verification: "signed_source_attestation",
      },
    ],
    nextCursor: null,
    coverage: { complete: true, pageSize: 50 },
  };
}
test("changing a relationship or live revision supersedes an in-flight evidence request", async () => {
  const old = deferred<JsonValue<YoduEventPage>>();
  const initial = deferred<JsonValue<YoduEventPage>>();
  const fresh = deferred<JsonValue<YoduEventPage>>();
  vi.mocked(requestJson)
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(() => initial.promise)
    .mockImplementationOnce(() => fresh.promise);
  const view = render(
    <YoduLifecyclePanel
      {...scope}
      relationshipId={demoId(300)}
      timeZone="UTC"
      revision="before"
    />,
  );
  view.rerender(
    <YoduLifecyclePanel
      {...scope}
      relationshipId={demoId(304)}
      timeZone="UTC"
      revision="before"
    />,
  );
  view.rerender(
    <YoduLifecyclePanel
      {...scope}
      relationshipId={demoId(304)}
      timeZone="UTC"
      revision="after"
    />,
  );
  expect(requestJson).toHaveBeenCalledTimes(3);
  await act(async () =>
    fresh.resolve(page("Fictional current fact", demoId(304))),
  );
  expect(await screen.findByText("Fictional current fact")).toBeTruthy();
  await act(async () => {
    old.resolve(page("Fictional old contact"));
    initial.resolve(page("Fictional stale revision", demoId(304)));
  });
  expect(screen.queryByText("Fictional old contact")).toBeNull();
  expect(screen.queryByText("Fictional stale revision")).toBeNull();
  expect(screen.getByText("Fictional current fact")).toBeTruthy();
});

test("switching products during settings reads discards prior-product sources and receipts", async () => {
  const oldSources = deferred<JsonValue<YoduSources>>();
  const oldEvents = deferred<JsonValue<YoduEventPage>>();
  vi.mocked(requestJson).mockImplementation((url) => {
    const query = new URL(String(url), "http://localhost").searchParams;
    if (query.get("productId") === scope.productId)
      return query.get("operation") === "yodu-sources"
        ? oldSources.promise
        : oldEvents.promise;
    return Promise.resolve(
      query.get("operation") === "yodu-sources"
        ? {
            sources: [],
            bindings: [],
            bindingsTruncated: false,
            nextBindingsCursor: null,
            configured: true,
            canManage: true,
          }
        : page("Fictional second product"),
    );
  });
  await settings("");
  fireEvent.change(screen.getByLabelText(t.product), {
    target: { value: demoId(11) },
  });
  expect(await screen.findByText("Fictional second product")).toBeTruthy();
  await act(async () => {
    oldSources.resolve({
      sources: [
        {
          id: demoId(1001),
          ...scope,
          label: "Fictional prior source",
          enabled: true,
          version: 1,
          createdAt: "2026-10-08T10:00:00Z",
          webhookUrl: "https://gravity.example.test/api/webhooks/yodu",
          verification: "signed_source_attestation",
        },
      ],
      bindings: [],
      bindingsTruncated: false,
      nextBindingsCursor: null,
      configured: true,
      canManage: true,
    });
    oldEvents.resolve(page("Fictional prior event"));
  });
  expect(screen.queryByText("Fictional prior source")).toBeNull();
  expect(screen.queryByText("Fictional prior event")).toBeNull();
});
