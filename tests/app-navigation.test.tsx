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
import { appearanceBootScript } from "../src/components/appearance-boot";
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
function setCompactScreen(compact: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: compact && query.includes("max-width"),
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}
beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset.sidebar;
  setCompactScreen(false);
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
  fireEvent.click(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
  );
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Lunar Studio" }));
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
  fireEvent.click(screen.getByRole("button", { name: t.commands }));
  fireEvent.click(screen.getByRole("option", { name: t.refresh }));
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

test("a fresh workspace opens its first product and offers working contact and integration paths", async () => {
  const created = await service.createWorkspace(principal, {
    name: "Fictional UI onboarding",
    productName: "Initial product",
    timezone: "UTC",
  });
  const initial = serialize(
    await service.snapshot(principal, {
      organizationId: created.organizationId,
    }),
  );
  render(
    <CrmApp
      initial={initial}
      organizations={[
        {
          id: created.organizationId,
          name: "Fictional UI onboarding",
          timezone: "UTC",
        },
      ]}
      initialOrganizationId={created.organizationId}
      initialProductId={created.productId}
      userId={demoUser}
      demo
      mcpEndpoint="https://gravity.example.test/mcp"
    />,
  );
  expect(
    (screen.getByRole("combobox", { name: t.product }) as HTMLSelectElement)
      .value,
  ).toBe(created.productId);
  expect(screen.getByRole("heading", { name: t.workspaceReady })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t.addPerson }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: t.addPerson })).toBeTruthy(),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(t.name).matches(":disabled")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: t.cancel }));
  fireEvent.click(screen.getByRole("button", { name: t.connectTools }));
  expect(
    screen.getByRole("heading", { name: t.integrations, level: 1 }),
  ).toBeTruthy();
  expect((screen.getByLabelText(t.mcpEndpoint) as HTMLInputElement).value).toBe(
    "https://gravity.example.test/mcp",
  );
  expect(screen.getByRole("heading", { name: t.calendar })).toBeTruthy();
});

test("the header theme toggle persists across a reload and agrees with preferences", async () => {
  mount();
  const toggle = () => screen.getByRole("button", { name: t.toggleTheme });
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle());
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("gravity-theme")).toBe("dark");
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: t.settings }));
  const preference = screen.getByRole("combobox", {
    name: t.appearance,
  }) as HTMLSelectElement;
  expect(preference.value).toBe("dark");
  cleanup();
  document.documentElement.className = "";
  new Function(appearanceBootScript)();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  mount();
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(toggle());
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("gravity-theme")).toBe("light");
  fireEvent.click(screen.getByRole("button", { name: t.settings }));
  fireEvent.change(screen.getByRole("combobox", { name: t.appearance }), {
    target: { value: "system" },
  });
  expect(localStorage.getItem("gravity-theme")).toBe("system");
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
});

test("the bracket key collapses the sidebar, the choice survives a reload, and every destination keeps its name", async () => {
  mount();
  const collapse = () => screen.getByRole("button", { name: t.toggleSidebar });
  expect(collapse().getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(document.body, { key: "[" });
  expect(document.documentElement.dataset.sidebar).toBe("collapsed");
  expect(localStorage.getItem("gravity-sidebar")).toBe("collapsed");
  expect(collapse().getAttribute("aria-expanded")).toBe("false");
  const people = screen.getByRole("button", { name: t.people });
  expect(people.getAttribute("aria-label")).toBe(t.people);
  fireEvent.click(people);
  expect(
    screen.getByRole("heading", { name: t.people, level: 1 }),
  ).toBeTruthy();
  cleanup();
  delete document.documentElement.dataset.sidebar;
  new Function(appearanceBootScript)();
  expect(document.documentElement.dataset.sidebar).toBe("collapsed");
  mount();
  expect(collapse().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(collapse());
  expect(document.documentElement.dataset.sidebar).toBe("expanded");
  expect(collapse().getAttribute("aria-expanded")).toBe("true");
  expect(
    screen.getByRole("button", { name: t.people }).getAttribute("aria-label"),
  ).toBeNull();
});

test("on a narrow screen the bracket key opens the navigation drawer and Escape closes it", async () => {
  setCompactScreen(true);
  mount();
  const sidebar = document.getElementById("navigation-panel");
  expect(sidebar?.dataset.drawer).toBe("closed");
  fireEvent.keyDown(document.body, { key: "[" });
  expect(sidebar?.dataset.drawer).toBe("open");
  expect(localStorage.getItem("gravity-sidebar")).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(sidebar?.dataset.drawer).toBe("closed");
  fireEvent.click(screen.getByRole("button", { name: t.openNavigation }));
  expect(sidebar?.dataset.drawer).toBe("open");
  fireEvent.click(screen.getByRole("button", { name: t.companies }));
  expect(sidebar?.dataset.drawer).toBe("closed");
});

test("results arrive as dismissible toasts instead of a footer status strip", async () => {
  mount();
  expect(document.querySelector("footer")).toBeNull();
  expect(screen.queryByText(t.demoDetail, { exact: true })).toBeNull();
  const notifications = screen.getByRole("region", { name: t.notifications });
  expect(notifications.children).toHaveLength(0);
  const row = () =>
    screen.queryByRole("button", {
      name: /Theo Grant.*Review their promised introduction/,
    });
  await waitFor(() => expect(row()).toBeTruthy());
  fireEvent.click(row() as HTMLButtonElement);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: t.markDone }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  request.mockImplementation(async (url, init) => {
    if (init?.method === "POST") throw new Error("INTERNAL_ERROR");
    return regular(url, init);
  });
  fireEvent.click(screen.getByRole("button", { name: t.markDone }));
  const failure = await within(notifications).findByRole("alert");
  expect(failure.textContent).toBe(t.errors.INTERNAL_ERROR);
  request.mockImplementation(async (url, init) =>
    init?.method === "POST"
      ? serialize(
          await service.changeAction(principal, JSON.parse(String(init.body))),
        )
      : regular(url, init),
  );
  fireEvent.click(screen.getByRole("button", { name: t.markDone }));
  const success = await within(notifications).findByRole("status");
  expect(success.textContent).toBe(t.updated);
  fireEvent.click(within(success).getByRole("button", { name: t.dismiss }));
  expect(within(notifications).queryByRole("status")).toBeNull();
  expect(within(notifications).getByRole("alert")).toBeTruthy();
});
