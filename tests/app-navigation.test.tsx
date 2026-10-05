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
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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
import { label, requestJson } from "../src/components/client-api";
import { CrmApp } from "../src/components/crm-app";
import { CompanyRecord } from "../src/components/records/company-record";
import { PersonRecord } from "../src/components/records/person-record";
import { type Route, routeFor } from "../src/components/routes";
import { ActionsView } from "../src/components/views/actions-view";
import { CompaniesView } from "../src/components/views/companies-view";
import { ConnectionsView } from "../src/components/views/connections-view";
import { MaterialsView } from "../src/components/views/materials-view";
import { MeetingsView } from "../src/components/views/meetings-view";
import { OpportunitiesView } from "../src/components/views/opportunities-view";
import { OutreachView } from "../src/components/views/outreach-view";
import { PeopleView } from "../src/components/views/people-view";
import { SequencesView } from "../src/components/views/sequences-view";
import { SettingsView } from "../src/components/views/settings-view";
import { usePathname, visit } from "./support/memory-router";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CrmService;
let snapshot: ClientSnapshot;
const principal = { userId: demoUser, source: "demo" as const };
const organizations = [
  {
    id: demoId(1),
    name: "Northstar Collective",
    slug: "northstar",
    timezone: "UTC",
  },
  { id: demoId(2), name: "Lunar Studio", slug: "lunar", timezone: "UTC" },
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
  visit("/actions");
  for (const cookie of document.cookie.split("; ")) {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
    document.cookie = `${cookie.split("=")[0]}=; Max-Age=0; Path=/`;
  }
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
function page(route: Route | null): ReactNode {
  if (!route) return null;
  if (route.recordId)
    return route.section === "people" ? (
      <PersonRecord key={route.recordId} personId={route.recordId} />
    ) : (
      <CompanyRecord key={route.recordId} companyId={route.recordId} />
    );
  const views = {
    actions: ActionsView,
    people: PeopleView,
    companies: CompaniesView,
    sequences: SequencesView,
    meetings: MeetingsView,
    opportunities: OpportunitiesView,
    materials: MaterialsView,
    outreach: OutreachView,
    integrations: ConnectionsView,
    settings: SettingsView,
  };
  const View = views[route.section];
  return <View />;
}
function Routed() {
  return page(routeFor(usePathname()));
}
function mount(path = "") {
  if (path) visit(path);
  render(
    <CrmApp
      initial={snapshot}
      organizations={organizations}
      initialOrganizationId={demoId(1)}
      userId={demoUser}
      demo
    >
      <Routed />
    </CrmApp>,
  );
}
const heading = (name: string, level = 1) =>
  screen.getByRole("heading", { name, level });

test("go-to navigation lands on a title from which J moves, Space peeks and Enter opens the record page", async () => {
  mount();
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: "p" });
  await waitFor(() => expect(document.activeElement).toBe(heading(t.people)));
  expect(window.location.pathname).toBe("/people");
  fireEvent.keyDown(heading(t.people), { key: "j" });
  const first = screen.getByRole("link", { name: "Mira Chen" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: " " });
  await waitFor(() =>
    expect(
      screen.getByRole("complementary", { name: t.recordDetails }),
    ).toBeTruthy(),
  );
  expect(window.location.pathname).toBe("/people");
  fireEvent.keyDown(first, { key: "Escape" });
  expect(
    screen.queryByRole("complementary", { name: t.recordDetails }),
  ).toBeNull();
  expect(document.activeElement).toBe(first);
  await userEvent.setup().keyboard("{Enter}");
  await waitFor(() =>
    expect(window.location.pathname).toBe(`/people/${demoId(200)}`),
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(heading("Mira Chen", 2)),
  );
  expect(
    screen.queryByRole("complementary", { name: t.recordDetails }),
  ).toBeNull();
});

test("product switching changes records synchronously without another snapshot read or blank view", async () => {
  mount();
  fireEvent.click(screen.getByRole("link", { name: t.people }));
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
  expect(screen.getByRole("link", { name: "Jonah Reed" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Leena Rao" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: t.searchShort }));
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
  fireEvent.click(screen.getByRole("link", { name: t.people }));
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
    screen.getByRole("link", {
      name: "Fictional cross-product keyboard buyer",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("complementary", { name: t.recordDetails }),
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
          slug: "fictional-ui-onboarding",
          timezone: "UTC",
        },
      ]}
      initialOrganizationId={created.organizationId}
      initialProductId={created.productId}
      userId={demoUser}
      demo
      mcpEndpoint="https://gravity.example.test/mcp"
    >
      <Routed />
    </CrmApp>,
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
  fireEvent.click(screen.getByRole("link", { name: t.connectTools }));
  expect(window.location.pathname).toBe("/connections");
  expect(heading(t.integrations)).toBeTruthy();
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
  fireEvent.click(screen.getByRole("link", { name: t.settings }));
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
  fireEvent.click(screen.getByRole("link", { name: t.settings }));
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
  const people = screen.getByRole("link", { name: t.people });
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
    screen.getByRole("link", { name: t.people }).getAttribute("aria-label"),
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
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  expect(sidebar?.dataset.drawer).toBe("closed");
  fireEvent.click(screen.getByRole("button", { name: t.openNavigation }));
  expect(sidebar?.dataset.drawer).toBe("open");
  fireEvent.click(screen.getByRole("link", { name: t.companies }));
  expect(sidebar?.dataset.drawer).toBe("closed");
  expect(window.location.pathname).toBe("/companies");
});

test("results arrive as dismissible toasts instead of a footer status strip", async () => {
  mount();
  expect(document.querySelector("footer")).toBeNull();
  expect(screen.queryByText(t.demoDetail, { exact: true })).toBeNull();
  const notifications = screen.getByRole("region", { name: t.notifications });
  const alerts = within(notifications).getByRole("alert");
  const statuses = within(notifications).getByRole("status");
  expect(alerts.children).toHaveLength(0);
  expect(statuses.children).toHaveLength(0);
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
  await waitFor(() => expect(alerts.children).toHaveLength(1));
  expect(alerts.textContent).toBe(t.errors.INTERNAL_ERROR);
  request.mockImplementation(async (url, init) =>
    init?.method === "POST"
      ? serialize(
          await service.changeAction(principal, JSON.parse(String(init.body))),
        )
      : regular(url, init),
  );
  fireEvent.click(screen.getByRole("button", { name: t.markDone }));
  await waitFor(() => expect(statuses.children).toHaveLength(1));
  expect(statuses.textContent).toBe(t.updated);
  fireEvent.click(within(statuses).getByRole("button", { name: t.dismiss }));
  expect(statuses.children).toHaveLength(0);
  expect(alerts.children).toHaveLength(1);
});

test("deep links render the view or record they name", async () => {
  const views: [string, string, string][] = [
    ["/actions", "actions", t.actions],
    ["/people", "people", t.people],
    ["/companies", "companies", t.companies],
    ["/sequences", "sequences", t.sequences],
    ["/meetings", "meetings", t.meetings],
    ["/opportunities", "opportunities", t.opportunities],
    ["/materials", "materials", t.materials],
    ["/outreach", "outreach", t.outreach],
    ["/connections", "integrations", t.integrations],
    ["/settings", "settings", t.settings],
  ];
  mount("/actions");
  expect(
    screen.getByRole("complementary", { name: t.recordDetails }),
  ).toBeTruthy();
  cleanup();
  for (const [path, section, name] of views) {
    mount(path);
    expect(heading(name).textContent).toBe(name);
    const current = document.querySelectorAll<HTMLElement>(
      '.sidebar [aria-current="page"]',
    );
    expect([...current].map((link) => link.dataset.navItem)).toEqual([section]);
    expect(current[0]?.getAttribute("href")).toBe(path);
    cleanup();
  }
  mount("/outreach");
  expect(screen.getByRole("heading", { name: t.outreachSoon })).toBeTruthy();
  cleanup();
  mount(`/people/${demoId(200)}`);
  expect(heading("Mira Chen", 2)).toBeTruthy();
  const crumbs = within(screen.getByRole("navigation", { name: t.breadcrumb }));
  expect(
    crumbs.getByRole("link", { name: t.people }).getAttribute("href"),
  ).toBe("/people");
  expect(crumbs.getByText("Mira Chen")).toBeTruthy();
  const timeline = screen.getByRole("region", { name: t.activity });
  expect(
    await within(timeline).findByText(
      "We can review the evaluation setup on Monday. Please send your shortlist.",
    ),
  ).toBeTruthy();
  cleanup();
  mount(`/companies/${demoId(100)}`);
  expect(heading("Northstar Labs", 2)).toBeTruthy();
  expect(
    await within(screen.getByRole("region", { name: t.activity })).findByRole(
      "button",
      { name: "Follow-up 2 paused by a reply" },
    ),
  ).toBeTruthy();
  cleanup();
  mount(`/people/${demoId(9999)}`);
  expect(
    screen.getByRole("heading", { name: t.recordUnavailable }),
  ).toBeTruthy();
});

test("sidebar links push history so Back and Forward return to the previous view", async () => {
  mount("/actions");
  fireEvent.click(screen.getByRole("link", { name: t.people }));
  expect(window.location.pathname).toBe("/people");
  expect(heading(t.people)).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Mira Chen" }));
  expect(window.location.pathname).toBe(`/people/${demoId(200)}`);
  expect(heading("Mira Chen", 2)).toBeTruthy();
  act(() => window.history.back());
  await waitFor(() => expect(window.location.pathname).toBe("/people"));
  expect(heading(t.people)).toBeTruthy();
  act(() => window.history.back());
  await waitFor(() => expect(window.location.pathname).toBe("/actions"));
  expect(heading(t.actions)).toBeTruthy();
  act(() => window.history.forward());
  await waitFor(() => expect(window.location.pathname).toBe("/people"));
  expect(
    screen.getByRole("link", { name: t.people }).getAttribute("aria-current"),
  ).toBe("page");
});

test("a reload on a record page keeps the record, its relationship and the reviewed draft", async () => {
  mount(`/people/${demoId(200)}?relationship=${demoId(306)}`);
  const relationship = () =>
    screen.getByRole("button", { name: /API Marketplace/, pressed: true });
  await waitFor(() => expect(relationship()).toBeTruthy());
  cleanup();
  mount();
  expect(window.location.search).toBe(`?relationship=${demoId(306)}`);
  expect(heading("Mira Chen", 2)).toBeTruthy();
  await waitFor(() => expect(relationship()).toBeTruthy());
  cleanup();
  mount(
    `/people/${demoId(200)}?relationship=${demoId(300)}&action=${demoId(600)}`,
  );
  const saved = snapshot.actions.find((action) => action.id === demoId(600));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: t.draftLabel,
      })) as HTMLTextAreaElement
    ).value,
  ).toBe(saved?.draft);
  cleanup();
  mount();
  expect(
    (
      (await screen.findByRole("textbox", {
        name: t.draftLabel,
      })) as HTMLTextAreaElement
    ).value,
  ).toBe(saved?.draft);
  expect(
    screen.getByRole("button", { name: t.draft }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("heading", { name: saved?.title })).toBeTruthy();
});

test("Enter on an action opens its person on the draft and the peek offers the same page", async () => {
  mount("/actions");
  const row = await screen.findByRole("button", {
    name: /Mira Chen.*Follow-up 2 paused by a reply/,
  });
  fireEvent.keyDown(row, { key: " " });
  fireEvent.click(row);
  const peek = await screen.findByRole("complementary", {
    name: t.recordDetails,
  });
  expect(
    within(peek).getByRole("link", { name: t.openRecord }).getAttribute("href"),
  ).toBe(
    `/people/${demoId(200)}?relationship=${demoId(300)}&action=${demoId(600)}`,
  );
  expect(window.location.pathname).toBe("/actions");
  row.focus();
  fireEvent.keyDown(row, { key: "Enter" });
  expect(window.location.pathname).toBe(`/people/${demoId(200)}`);
  expect(window.location.search).toBe(
    `?relationship=${demoId(300)}&action=${demoId(600)}`,
  );
  expect(
    await screen.findByRole("textbox", { name: t.draftLabel }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("complementary", { name: t.recordDetails }),
  ).toBeNull();
});

test("saved views are links whose filter lives in the URL", async () => {
  mount("/people");
  fireEvent.click(screen.getByRole("link", { name: t.replies }));
  expect(window.location.pathname).toBe("/actions");
  expect(window.location.search).toBe("?kind=reply");
  const actionRows = () =>
    [...document.querySelectorAll(".action-row")].map(
      (row) => row.querySelector(".row-kind")?.textContent,
    );
  expect(actionRows().length).toBeGreaterThan(0);
  expect(new Set(actionRows())).toEqual(new Set([t.reply]));
  expect(
    screen.getByRole("link", { name: t.replies }).getAttribute("aria-current"),
  ).toBe("true");
  cleanup();
  mount();
  expect(
    (screen.getByRole("combobox", { name: t.actionType }) as HTMLSelectElement)
      .value,
  ).toBe("reply");
  expect(
    screen.queryByRole("complementary", { name: t.recordDetails }),
  ).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: t.actionType }), {
    target: { value: "" },
  });
  expect(window.location.search).toBe("");
  expect(new Set(actionRows()).size).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole("link", { name: t.waiting }));
  expect(window.location.search).toBe("?waiting=1");
  expect(
    screen.getByRole("button", { name: `${t.waiting}: ${t.clearFilters}` }),
  ).toBeTruthy();
});

test("switching workspace remembers its slug and leaves a record of the old workspace", async () => {
  mount(`/companies/${demoId(100)}`);
  expect(heading("Northstar Labs", 2)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
  );
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Lunar Studio" }));
  expect(window.location.pathname).toBe("/companies");
  expect(document.cookie).toContain("gravity-workspace=lunar");
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Moonlit Design" })).toBeTruthy(),
  );
  fireEvent.change(screen.getByRole("combobox", { name: t.product }), {
    target: { value: demoId(13) },
  });
  expect(document.cookie).toContain(`gravity-brand=${demoId(13)}`);
});

test("related work on a record page reveals the meeting in its own view", async () => {
  mount(`/people/${demoId(200)}`);
  fireEvent.click(
    await screen.findByRole("button", { name: /Evaluation review/ }),
  );
  expect(window.location.pathname).toBe("/meetings");
  const meeting = screen
    .getByRole("heading", { name: "Evaluation review" })
    .closest("article");
  expect(meeting?.classList.contains("record-highlight")).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(meeting));
  act(() => window.history.back());
  await waitFor(() =>
    expect(window.location.pathname).toBe(`/people/${demoId(200)}`),
  );
});

test("the workspace menu opens above a collapsed sidebar and still switches organization", async () => {
  mount();
  fireEvent.keyDown(document.body, { key: "[" });
  expect(document.documentElement.dataset.sidebar).toBe("collapsed");
  fireEvent.click(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
  );
  const menu = screen.getByRole("menu");
  expect(document.getElementById("navigation-panel")?.contains(menu)).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Lunar Studio" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: `${t.switchOrganization}: Lunar Studio`,
      }),
    ).toBeTruthy(),
  );
});

test("the narrow-screen drawer takes focus, keeps Tab inside, makes the page inert and gives focus back on Escape", async () => {
  setCompactScreen(true);
  mount();
  const sidebar = document.getElementById("navigation-panel") as HTMLElement;
  const main = document.querySelector("main") as HTMLElement;
  const trigger = screen.getByRole("button", { name: t.openNavigation });
  expect(main.hasAttribute("inert")).toBe(false);
  fireEvent.click(trigger);
  expect(sidebar.dataset.drawer).toBe("open");
  expect(sidebar.contains(document.activeElement)).toBe(true);
  expect(main.hasAttribute("inert")).toBe(true);
  const drawer = screen.getByRole("dialog", { name: t.navigationDrawer });
  expect(drawer).toBe(sidebar);
  expect(drawer.getAttribute("aria-modal")).toBe("true");
  const focusable = [
    ...sidebar.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)"),
  ].filter((element) => !element.closest("[hidden]"));
  const first = focusable[0] as HTMLElement;
  const last = focusable.at(-1) as HTMLElement;
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  const inertWhenFocused: boolean[] = [];
  trigger.addEventListener("focus", () =>
    inertWhenFocused.push(main.hasAttribute("inert")),
  );
  fireEvent.keyDown(last, { key: "Escape" });
  expect(sidebar.dataset.drawer).toBe("closed");
  expect(document.activeElement).toBe(trigger);
  expect(inertWhenFocused).toEqual([false]);
  expect(main.hasAttribute("inert")).toBe(false);
  expect(sidebar.getAttribute("role")).toBeNull();
  fireEvent.keyDown(document.body, { key: "[" });
  expect(sidebar.contains(document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: t.closeNavigation }));
  expect(document.activeElement).toBe(trigger);
  expect(inertWhenFocused).toEqual([false, false]);
});

test("a collapsed sidebar still exposes the sync status, and the shell carries no dead markup", async () => {
  mount();
  fireEvent.keyDown(document.body, { key: "[" });
  const sidebar = document.getElementById("navigation-panel") as HTMLElement;
  const candidates = within(sidebar).getAllByText(t.reconnecting);
  const visible = candidates.filter(
    (element) =>
      !element.closest('[aria-hidden="true"], .nav-label-text, [hidden]'),
  );
  expect(visible.length).toBeGreaterThan(0);
  expect(document.querySelector("[data-collapsed]")).toBeNull();
  const collapse = screen.getByRole("button", { name: t.toggleSidebar });
  const controlled = collapse.getAttribute("aria-controls");
  if (controlled)
    expect(document.getElementById(controlled)?.contains(collapse)).toBe(false);
  const navigation = sidebar.querySelector(`nav[aria-label="${t.myWork}"]`);
  for (const id of ["settings", "integrations"])
    expect(
      navigation?.querySelector(`a[data-nav-item="${id}"]`)?.textContent,
    ).toBe(label(id));
});

test("the header search pill is named by the text it shows", async () => {
  mount();
  const header = screen.getByRole("banner");
  const pill = within(header).getByRole("button", { name: t.searchShort });
  expect(pill.textContent?.startsWith(t.searchShort)).toBe(true);
  fireEvent.click(pill);
  expect(screen.getByRole("dialog", { name: t.commands })).toBeTruthy();
});
