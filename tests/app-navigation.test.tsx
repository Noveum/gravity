// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { CrmService, personSchema } from "../packages/core/crm";
import { type ClientSnapshot, serialize } from "../packages/core/dto";
import { createLocalDatabase } from "../packages/database/client";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { requestJson } from "../src/components/client-api";
import { CrmApp } from "../src/components/crm-app";

vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CrmService;
let snapshot: ClientSnapshot;
const principal = { userId: demoUser, source: "demo" as const };
const organizations = [
  { id: demoId(1), name: "Northstar Collective", timezone: "UTC" },
  { id: demoId(2), name: "Lunar Studio", timezone: "UTC" },
];
const request = vi.mocked(requestJson);
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new CrmService(local.db);
  snapshot = serialize(
    await service.snapshot(principal, { organizationId: demoId(1) }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "EventSource",
    class extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      onopen = null;
      onerror = null;
      close() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterAll(async () => {
  await local.client.close();
  vi.unstubAllGlobals();
});
afterEach(cleanup);
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (url) => {
    const params = new URL(url, "http://localhost").searchParams;
    const organizationId = params.get("organizationId") || demoId(1);
    if (params.get("operation") === "context")
      return serialize(
        await service.context(
          principal,
          organizationId,
          params.get("relationshipId") || "",
        ),
      );
    if (params.get("operation") === "company")
      return serialize(
        await service.companyContext(
          principal,
          { organizationId },
          params.get("companyId") || "",
        ),
      );
    return serialize(await service.snapshot(principal, { organizationId }));
  });
});
function mount() {
  render(
    <CrmApp
      initial={snapshot}
      organizations={organizations}
      initialOrganizationId={demoId(1)}
      userId={demoUser}
      demo
    />,
  );
}

test("go-to navigation lands on a title from which J and Enter open the first visible record", async () => {
  mount();
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: "p" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: t.people, level: 1 }),
    ),
  );
  fireEvent.keyDown(screen.getByRole("heading", { name: t.people, level: 1 }), {
    key: "j",
  });
  const first = screen.getByRole("button", { name: "Mira Chen" });
  expect(document.activeElement).toBe(first);
  fireEvent.click(first);
  await waitFor(() =>
    expect(
      screen.getByRole("complementary", { name: t.recordDetails }),
    ).toBeTruthy(),
  );
  fireEvent.keyDown(first, { key: "Escape" });
  expect(
    screen.queryByRole("complementary", { name: t.recordDetails }),
  ).toBeNull();
  expect(document.activeElement).toBe(first);
});

test("product switching changes records synchronously without another snapshot read or blank view", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: t.people }));
  await waitFor(() =>
    expect(
      request.mock.calls.filter(([url]) => !url.includes("operation=")).length,
    ).toBe(1),
  );
  await act(async () => {});
  request.mockClear();
  fireEvent.change(screen.getByRole("combobox", { name: t.product }), {
    target: { value: demoId(11) },
  });
  expect(screen.getByRole("button", { name: "Jonah Reed" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Leena Rao" })).toBeNull();
  expect(screen.queryByText(t.loading, { exact: true })).toBeNull();
  expect(
    request.mock.calls.filter(([url]) => !url.includes("operation=")),
  ).toHaveLength(0);
});

test("a delayed previous-organization snapshot cannot reappear after switching organizations", async () => {
  let release!: (data: ClientSnapshot) => void;
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  request.mockImplementation((url, init) =>
    url === `/api/crm?organizationId=${demoId(1)}`
      ? new Promise((resolve) => {
          release = resolve;
        })
      : regular(url, init),
  );
  mount();
  fireEvent.change(screen.getByRole("combobox", { name: t.workspace }), {
    target: { value: demoId(2) },
  });
  expect(screen.queryByText("Mira Chen")).toBeNull();
  await act(async () => release(snapshot));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Design Partners" }),
    ).toBeTruthy(),
  );
  expect(screen.queryByText("Mira Chen")).toBeNull();
  expect(screen.queryByRole("option", { name: "AI Platform" })).toBeNull();
});

test("a confirmed action updates the queue before refresh and an older read cannot undo it", async () => {
  mount();
  const row = () =>
    screen.queryByRole("button", {
      name: /Ellis Park.*Verify role and buying context/,
    });
  await waitFor(() => expect(row()).toBeTruthy());
  fireEvent.click(row() as HTMLButtonElement);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: t.markDone }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await act(async () => {});
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  let releaseOld!: (data: ClientSnapshot) => void;
  let releaseNew!: (data: ClientSnapshot) => void;
  let reads = 0;
  request.mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      return serialize(await service.changeAction(principal, input));
    }
    if (url === `/api/crm?organizationId=${demoId(1)}`) {
      reads++;
      return new Promise((resolve) => {
        if (reads === 1) releaseOld = resolve;
        else releaseNew = resolve;
      });
    }
    return regular(url, init);
  });
  fireEvent.click(screen.getByRole("button", { name: t.refresh }));
  fireEvent.click(screen.getByRole("button", { name: t.markDone }));
  await waitFor(() => expect(row()).toBeNull());
  expect(reads).toBe(1);
  await act(async () => releaseOld(snapshot));
  await waitFor(() => expect(reads).toBe(2));
  expect(row()).toBeNull();
  await act(async () =>
    releaseNew(
      serialize(
        await service.snapshot(principal, { organizationId: demoId(1) }),
      ),
    ),
  );
  expect(row()).toBeNull();
});

test("modifier Enter saves the draft once without approval or a false version conflict", async () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: /Leena Rao.*Prepare the pilot proposal/,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: t.markDone })).toBeTruthy(),
  );
  fireEvent.keyDown(document.body, { key: "3" });
  const draft = screen.getByRole("textbox", { name: t.draftLabel });
  fireEvent.change(draft, {
    target: { value: "Fictional keyboard draft save" },
  });
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  let release!: (data: ClientSnapshot) => void;
  request.mockImplementation(async (url, init) => {
    if (init?.method === "POST")
      return serialize(
        await service.changeAction(principal, JSON.parse(String(init.body))),
      );
    if (url === `/api/crm?organizationId=${demoId(1)}`)
      return new Promise((resolve) => {
        release = resolve;
      });
    return regular(url, init);
  });
  fireEvent.keyDown(draft, { key: "Enter", ctrlKey: true });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(t.updated),
  );
  expect(screen.queryByText(t.errors.CONFLICT)).toBeNull();
  expect(
    (screen.getByRole("button", { name: t.saveDraft }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const writes = request.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0][1]?.body)).command).toBe("save");
  const fresh = serialize(
    await service.snapshot(principal, { organizationId: demoId(1) }),
  );
  expect(
    fresh.actions.find((action) => action.id === demoId(602))?.approvedHash,
  ).toBeNull();
  await act(async () => release(fresh));
});

test("creating a person for another product refreshes the full snapshot before opening the new record", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: t.people }));
  fireEvent.change(screen.getByRole("combobox", { name: t.product }), {
    target: { value: demoId(10) },
  });
  fireEvent.keyDown(document.body, { key: "c" });
  const dialog = within(screen.getByRole("dialog", { name: t.addPerson }));
  await waitFor(() =>
    expect(dialog.getByLabelText(t.name).matches(":disabled")).toBe(false),
  );
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  request.mockImplementation(async (url, init) =>
    init?.method === "POST"
      ? service.createPerson(
          principal,
          personSchema.parse(JSON.parse(String(init.body))),
        )
      : regular(url, init),
  );
  fireEvent.change(dialog.getByRole("combobox", { name: t.product }), {
    target: { value: demoId(12) },
  });
  fireEvent.change(dialog.getByLabelText(t.name), {
    target: { value: "Fictional cross-product keyboard buyer" },
  });
  fireEvent.keyDown(dialog.getByLabelText(t.name), {
    key: "Enter",
    ctrlKey: true,
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    screen.getByRole("button", {
      name: "Fictional cross-product keyboard buyer",
    }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("combobox", { name: t.product }) as HTMLSelectElement)
      .value,
  ).toBe(demoId(12));
});
