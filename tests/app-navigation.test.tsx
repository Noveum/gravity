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
import {
  CrmService,
  messageActivitySchema,
  opportunitySchema,
  personSchema,
  pipelineSchema,
} from "../packages/core/crm";
import { type ClientSnapshot, serialize } from "../packages/core/dto";
import { shortcutLabel } from "../packages/core/shortcuts";
import { createLocalDatabase } from "../packages/database/client";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { appearanceBootScript } from "../src/components/appearance-boot";
import { label, requestJson } from "../src/components/client-api";
import { CrmApp } from "../src/components/crm-app";
import { CompanyRecord } from "../src/components/records/company-record";
import { PersonRecord } from "../src/components/records/person-record";
import { type Route, routeFor } from "../src/components/routes";
import * as shellNavigation from "../src/components/shell/navigation";
import { ActionsView } from "../src/components/views/actions-view";
import { AssistantsView } from "../src/components/views/assistants-view";
import { CompaniesView } from "../src/components/views/companies-view";
import { ConnectionsView } from "../src/components/views/connections-view";
import { MaterialsView } from "../src/components/views/materials-view";
import { MeetingsView } from "../src/components/views/meetings-view";
import { OpportunitiesView } from "../src/components/views/opportunities-view";
import { OutreachView } from "../src/components/views/outreach-view";
import { OverviewView } from "../src/components/views/overview-view";
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
const missingContexts = new Set<string>();
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
let compactScreen = false;
const screenListeners = new Set<() => void>();
function setCompactScreen(compact: boolean) {
  compactScreen = compact;
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return compactScreen && query.includes("max-width");
    },
    addEventListener(_type: string, listener: () => void) {
      if (query.includes("max-width")) screenListeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      screenListeners.delete(listener);
    },
  })) as unknown as typeof window.matchMedia;
}
function resizeScreen(compact: boolean) {
  compactScreen = compact;
  act(() => {
    for (const listener of [...screenListeners]) listener();
  });
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
  missingContexts.clear();
  request.mockReset();
  request.mockImplementation(async (url) => {
    if (url.startsWith("/api/outreach")) throw new Error("NOT_FOUND");
    const params = new URL(url, "http://localhost").searchParams;
    const organizationId = params.get("organizationId") || demoId(1);
    if (params.get("operation") === "invitations") return [];
    if (
      params.get("operation") === "context" &&
      missingContexts.has(params.get("relationshipId") ?? "")
    )
      throw new Error("NOT_FOUND");
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
          {
            organizationId,
            ...(params.get("productId")
              ? { productId: params.get("productId") ?? "" }
              : {}),
          },
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
    overview: OverviewView,
    actions: ActionsView,
    people: PeopleView,
    companies: CompaniesView,
    sequences: SequencesView,
    meetings: MeetingsView,
    opportunities: OpportunitiesView,
    materials: MaterialsView,
    outreach: OutreachView,
    integrations: ConnectionsView,
    assistants: AssistantsView,
    settings: SettingsView,
  };
  const View = views[route.section];
  return <View />;
}
function Routed() {
  return page(routeFor(usePathname()));
}
function mount(path = "", demo = true) {
  if (path) visit(path);
  render(
    <CrmApp
      initial={snapshot}
      organizations={organizations}
      initialOrganizationId={demoId(1)}
      userId={demoUser}
      demo={demo}
    >
      <Routed />
    </CrmApp>,
  );
}
const heading = (name: string, level = 1) =>
  screen.getByRole("heading", { name, level });

test("navigation width is keyboard adjustable, persisted and restored after collapse", () => {
  mount();
  const resize = screen.getByRole("separator", { name: t.resizeNavigation });
  expect(resize.getAttribute("aria-controls")).toBe("navigation-panel");
  expect(resize.getAttribute("aria-valuenow")).toBe("232");
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(resize.getAttribute("aria-valuenow")).toBe("242");
  expect(localStorage.getItem("gravity-navigation-width")).toBe("242");
  fireEvent.click(screen.getByRole("button", { name: t.toggleSidebar }));
  expect(
    screen.queryByRole("separator", { name: t.resizeNavigation }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t.toggleSidebar }));
  expect(
    screen
      .getByRole("separator", { name: t.resizeNavigation })
      .getAttribute("aria-valuenow"),
  ).toBe("242");
  cleanup();
  mount();
  expect(
    screen
      .getByRole("separator", { name: t.resizeNavigation })
      .getAttribute("aria-valuenow"),
  ).toBe("242");
});

test("the routed Connections view loads the active scope, shows callback results and opens personal Unipile setup", async () => {
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  request.mockImplementation(async (url, init) =>
    url.startsWith("/api/integrations")
      ? {
          configured: {
            gmail: true,
            calendar: true,
            linkedin: false,
            fireflies: true,
          },
          connections: [],
          items: [],
          reviewTotal: 0,
          nextReviewCursor: null,
        }
      : regular(url, init),
  );
  mount("/connections?integration=connected", false);
  expect(
    screen.getByText(t.integrationMessages.CONNECTION_CONNECTED),
  ).toBeTruthy();
  const setup = await screen.findByRole("button", { name: t.unipileSetUp });
  await waitFor(() => expect(setup.matches(":disabled")).toBe(false));
  const integrationReads = () =>
    request.mock.calls
      .map(([url]) => new URL(url, "https://crm.example.test"))
      .filter((url) => url.pathname === "/api/integrations");
  expect(integrationReads().at(-1)?.searchParams.get("organizationId")).toBe(
    demoId(1),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI Platform" }));
  expect(window.location.pathname).toBe("/overview");
  fireEvent.click(screen.getByRole("link", { name: t.integrations }));
  await waitFor(() =>
    expect(integrationReads().at(-1)?.searchParams.get("productId")).toBe(
      demoId(10),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: t.unipileSetUp }));
  expect(screen.getByLabelText(t.unipileApiKey).getAttribute("type")).toBe(
    "password",
  );
  expect(screen.getByText(t.unipileOwnership)).toBeTruthy();
});

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
    url === `/api/crm?organizationId=${demoId(1)}&compact=true`
      ? new Promise((resolve) => {
          release = resolve;
        })
      : regular(url, init),
  );
  mount();
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
    { key: "Enter" },
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
    if (url === `/api/crm?organizationId=${demoId(1)}&compact=true`) {
      reads++;
      return new Promise((resolve) => {
        if (reads === 1) releaseOld = resolve;
        else releaseNew = resolve;
      });
    }
    return regular(url, init);
  });
  fireEvent.click(
    within(screen.getByRole("banner")).getByRole("button", {
      name: t.searchShort,
    }),
  );
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
    if (url === `/api/crm?organizationId=${demoId(1)}&compact=true`)
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
  expect(preference.textContent).toContain(t.dark);
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
  fireEvent.keyDown(screen.getByRole("combobox", { name: t.appearance }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: t.system }));
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
    ["/overview", "overview", t.overview],
    ["/actions", "actions", t.actions],
    ["/people", "people", t.people],
    ["/companies", "companies", t.companies],
    ["/meetings", "meetings", t.meetings],
    ["/opportunities", "opportunities", t.opportunities],
    ["/materials", "materials", t.materials],
    ["/outreach", "outreach", t.outreach],
    ["/connections", "integrations", t.integrations],
    ["/assistants", "assistants", t.assistants],
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
  await waitFor(() => expect(window.location.pathname).toBe("/outreach/today"));
  expect(
    within(screen.getByRole("navigation", { name: t.outreachTabsLabel }))
      .getByRole("link", { name: t.outreachTabs.today })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    await screen.findByRole("heading", { name: t.outreachLoadError }),
  ).toBeTruthy();
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
  expect(window.location.pathname).toBe("/people");
  fireEvent.click(await screen.findByRole("link", { name: t.openRecord }));
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
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
    { key: "Enter" },
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
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
    { key: "Enter" },
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
  const navigation = sidebar.querySelector(
    `nav[aria-label="${t.mainNavigation}"]`,
  );
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

const writes = () =>
  request.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)));
function persistWrites() {
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  request.mockImplementation(async (url, init) =>
    init?.method === "POST"
      ? serialize(
          await service.changeAction(principal, JSON.parse(String(init.body))),
        )
      : regular(url, init),
  );
}

test("under a remembered brand a person's company still opens as a full record", async () => {
  mount("/people");
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  act(() => visit(`/people/${demoId(200)}`));
  expect(heading("Mira Chen", 2)).toBeTruthy();
  const main = within(screen.getByRole("main"));
  expect(
    await main.findByRole("button", { name: /AI Platform/, pressed: true }),
  ).toBeTruthy();
  expect(main.getByRole("button", { name: /API Marketplace/ })).toBeTruthy();
  fireEvent.click(
    main.getAllByRole("button", { name: "Northstar Labs" })[0] as HTMLElement,
  );
  expect(window.location.pathname).toBe(`/companies/${demoId(100)}`);
  expect(heading("Northstar Labs", 2)).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Mira Chen" })).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: t.activity })).getByRole(
      "button",
      { name: "Coordinate across products" },
    ),
  ).toBeTruthy();
  expect(screen.queryByText(t.errors.NOT_FOUND)).toBeNull();
  expect(screen.queryByText(t.recordUnavailable)).toBeNull();
  const companyReads = request.mock.calls
    .map(([url]) => url)
    .filter((url) => url.includes("operation=company"));
  expect(companyReads.length).toBeGreaterThan(0);
  for (const url of companyReads) expect(url).not.toContain("productId");
});

test("a person whose context is gone shows the unavailable state instead of loading forever", async () => {
  missingContexts.add(demoId(300));
  mount(`/people/${demoId(200)}?relationship=${demoId(300)}`);
  expect(heading("Mira Chen", 2)).toBeTruthy();
  await waitFor(() =>
    expect(screen.getAllByText(t.recordUnavailable).length).toBeGreaterThan(0),
  );
  expect(document.querySelector(".record-page [aria-busy=true]")).toBeNull();
  cleanup();
  mount("/actions");
  const peek = await screen.findByRole("complementary", {
    name: t.recordDetails,
  });
  await waitFor(() =>
    expect(within(peek).getByText(t.recordUnavailable)).toBeTruthy(),
  );
  expect(peek.querySelector("[aria-busy=true]")).toBeNull();
});

test("the company timeline puts upcoming work first and past work newest first", async () => {
  mount(`/companies/${demoId(100)}`);
  const activity = screen.getByRole("region", { name: t.activity });
  await within(activity).findByRole("button", {
    name: "Coordinate across products",
  });
  const groups = within(activity).getAllByRole("region");
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
    t.upcoming,
    t.past,
  ]);
  const titles = (group: HTMLElement) =>
    within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
  expect(titles(groups[0] as HTMLElement)).toEqual(["Evaluation review"]);
  const past = within(groups[1] as HTMLElement).getAllByRole("listitem");
  const times = past.map((item) => Number(item.dataset.at));
  expect(times).toEqual([...times].sort((a, b) => b - a));
});

test("switching workspace drops an owner filter that names a member of the old workspace", async () => {
  mount("/actions?owner=demo-teammate&kind=reply");
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
    { key: "Enter" },
  );
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Lunar Studio" }));
  expect(window.location.pathname).toBe("/actions");
  expect(window.location.search).toBe("?kind=reply");
});

test("a stale draft on a record page warns, and reload brings back the saved text", async () => {
  mount(
    `/people/${demoId(201)}?relationship=${demoId(301)}&action=${demoId(601)}`,
  );
  const draft = (await screen.findByRole("textbox", {
    name: t.draftLabel,
  })) as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: "Fictional local edit" } });
  const current = serialize(
    await service.snapshot(principal, { organizationId: demoId(1) }),
  ).actions.find((action) => action.id === demoId(601));
  await service.changeAction(principal, {
    organizationId: demoId(1),
    actionId: demoId(601),
    version: current?.version ?? 1,
    command: "save",
    draft: "Fictional teammate rewrite",
  });
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  fireEvent.click(await screen.findByRole("option", { name: t.refresh }));
  const callout = await screen.findByRole("button", { name: t.reloadDraft });
  expect(screen.getAllByText(t.errors.CONFLICT).length).toBeGreaterThan(0);
  expect(draft.value).toBe("Fictional local edit");
  fireEvent.click(callout);
  expect(
    (screen.getByRole("textbox", { name: t.draftLabel }) as HTMLTextAreaElement)
      .value,
  ).toBe("Fictional teammate rewrite");
  expect(screen.queryByRole("button", { name: t.reloadDraft })).toBeNull();
});

test("the record page saves, approves and reworks drafts through the same commands", async () => {
  mount(
    `/people/${demoId(202)}?relationship=${demoId(302)}&action=${demoId(602)}`,
  );
  persistWrites();
  fireEvent.click(await screen.findByRole("button", { name: t.draft }));
  fireEvent.change(screen.getByRole("textbox", { name: t.draftLabel }), {
    target: { value: "Fictional record page proposal" },
  });
  fireEvent.click(screen.getByRole("button", { name: t.saveDraft }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: t.approveDraft,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: t.approveDraft }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes().map((write) => write.command)).toEqual(["save", "approve"]);
  await waitFor(() => expect(screen.getByText(t.approved)).toBeTruthy());
  cleanup();
  request.mockClear();
  mount(
    `/people/${demoId(200)}?relationship=${demoId(300)}&action=${demoId(600)}`,
  );
  persistWrites();
  fireEvent.change(await screen.findByRole("textbox", { name: t.draftLabel }), {
    target: { value: "Fictional answer with the shortlist" },
  });
  fireEvent.click(screen.getByRole("button", { name: t.rework }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]).toMatchObject({
    command: "rework",
    actionId: demoId(600),
    draft: "Fictional answer with the shortlist",
  });
  const reworked = serialize(
    await service.snapshot(principal, { organizationId: demoId(1) }),
  ).actions.find((action) => action.id === demoId(600));
  expect(reworked).toMatchObject({ status: "open", kind: "reply" });
});

test("typing a draft re-renders the draft, not the whole shell", async () => {
  mount(
    `/people/${demoId(201)}?relationship=${demoId(301)}&action=${demoId(601)}`,
  );
  const draft = await screen.findByRole("textbox", { name: t.draftLabel });
  await act(async () => {});
  const shellRenders = vi.spyOn(shellNavigation, "breadcrumbsFor");
  for (const value of ["F", "Fi", "Fic"])
    fireEvent.change(draft, { target: { value } });
  expect((draft as HTMLTextAreaElement).value).toBe("Fic");
  expect(shellRenders).not.toHaveBeenCalled();
  shellRenders.mockRestore();
});

test("widening the window past the narrow breakpoint closes the drawer and releases the page", async () => {
  setCompactScreen(true);
  mount();
  const sidebar = document.getElementById("navigation-panel") as HTMLElement;
  const main = document.querySelector("main") as HTMLElement;
  fireEvent.click(screen.getByRole("button", { name: t.openNavigation }));
  expect(sidebar.dataset.drawer).toBe("open");
  expect(main.hasAttribute("inert")).toBe(true);
  resizeScreen(false);
  expect(sidebar.dataset.drawer).toBe("closed");
  expect(main.hasAttribute("inert")).toBe(false);
  expect(sidebar.getAttribute("role")).toBeNull();
  expect(sidebar.hasAttribute("aria-modal")).toBe(false);
});

test("the workspace menu opened from the drawer lives inside the drawer", async () => {
  setCompactScreen(true);
  mount();
  fireEvent.click(screen.getByRole("button", { name: t.openNavigation }));
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `${t.switchOrganization}: Northstar Collective`,
    }),
    { key: "Enter" },
  );
  const drawer = document.getElementById("navigation-panel") as HTMLElement;
  const menu = document.querySelector('[role="menu"]');
  expect(menu).not.toBeNull();
  expect(drawer.contains(menu)).toBe(true);
  fireEvent.keyDown(
    menu?.querySelector('[role="menuitemradio"]') as HTMLElement,
    {
      key: "Escape",
    },
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(drawer.dataset.drawer).toBe("open");
  expect(
    drawer.querySelector(`nav[aria-label="${t.mainNavigation}"]`),
  ).not.toBeNull();
});

test("a company record stacks its people and opportunities as sibling sections without an extra wrapper", async () => {
  mount(`/companies/${demoId(100)}`);
  await screen.findByRole("heading", { name: t.opportunities });
  const attributes = document.querySelector(
    ".record-attributes",
  ) as HTMLElement;
  expect(attributes.querySelector(".related-work")).toBeNull();
  const sections = [...attributes.children].filter((child) =>
    child.classList.contains("record-section"),
  );
  expect(
    sections.map((section) => section.querySelector("h3")?.textContent),
  ).toEqual([t.dealSizeAndTags, t.allPeople, t.opportunities]);
});

test("product creation is reachable from sidebar, toolbar, keyboard and commands in the active organization", async () => {
  mount("/people");
  const buttons = screen.getAllByRole("button", { name: t.newProduct });
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.textContent).toContain(shortcutLabel("create-product"));
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: t.newProduct });
    expect(within(dialog).getByText(organizations[0].name)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: t.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
  }
  const search = screen.getByRole("searchbox", { name: t.search });
  fireEvent.keyDown(search, { key: "P", shiftKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(document.body, { key: "P", shiftKey: true });
  expect(screen.getByRole("dialog", { name: t.newProduct })).toBeTruthy();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  const palette = screen.getByRole("dialog", { name: t.commands });
  fireEvent.click(
    within(palette).getByRole("option", { name: new RegExp(t.newProduct) }),
  );
  expect(screen.getByRole("dialog", { name: t.newProduct })).toBeTruthy();
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request implementation");
  request.mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return service.createProduct(principal, body.organizationId, body.name);
    }
    return regular(url, init);
  });
  const input = screen.getByLabelText(t.productName);
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.change(input, { target: { value: "Fictional shortcuts product" } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByRole("button", { name: "Fictional shortcuts product" });
  expect(
    JSON.parse(
      String(
        request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
          ?.body,
      ),
    ),
  ).toEqual({
    operation: "product",
    organizationId: demoId(1),
    name: "Fictional shortcuts product",
  });
});

test("non-admins have no product creation buttons, shortcut or advertised creation command", async () => {
  const limited = {
    ...snapshot,
    members: snapshot.members.map((member) => ({
      ...member,
      role: "member" as const,
    })),
  };
  request.mockResolvedValue(limited);
  render(
    <CrmApp
      initial={limited}
      organizations={organizations}
      initialOrganizationId={demoId(1)}
      userId={demoUser}
      demo
    >
      <Routed />
    </CrmApp>,
  );
  expect(screen.queryByRole("button", { name: t.newProduct })).toBeNull();
  fireEvent.keyDown(document.body, { key: "P", shiftKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
  const guide = screen.getByRole("dialog", { name: t.keyboardHelp });
  expect(within(guide).queryByText(t.newProduct)).toBeNull();
  fireEvent(guide, new Event("cancel", { cancelable: true }));
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  const command = screen.getByRole("option", {
    name: new RegExp(t.newProduct),
  });
  expect(command.matches(":disabled")).toBe(true);
  fireEvent.click(command);
  expect(screen.getByRole("dialog", { name: t.commands })).toBeTruthy();
});

test("visible go-to hints include Outreach and the help button opens the map", async () => {
  mount();
  const sidebar = document.getElementById("navigation-panel") as HTMLElement;
  for (const section of shellNavigation.listedViews) {
    const link = sidebar.querySelector(`[data-nav-item="${section}"]`);
    expect(link?.querySelector("kbd")?.textContent).toBe(
      shellNavigation.sectionHint(section),
    );
  }
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: "x" });
  await waitFor(() => expect(window.location.pathname).toBe("/assistants"));
  expect(screen.getByLabelText(t.mcpEndpoint)).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: "r" });
  await waitFor(() => expect(window.location.pathname).toBe("/outreach/today"));
  fireEvent.click(screen.getByRole("button", { name: t.keyboardHelp }));
  expect(
    within(screen.getByRole("dialog", { name: t.keyboardHelp })).getByText(
      shortcutLabel("create-product"),
    ),
  ).toBeTruthy();
});

test("Overview metrics drill into real deals and message history with keyboard navigation", async () => {
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request mock");
  request.mockImplementation(async (url, init) => {
    const query = new URL(url, "http://localhost").searchParams;
    if (query.get("operation") === "messageActivity")
      return serialize(
        await service.messageActivity(
          principal,
          messageActivitySchema.parse(Object.fromEntries(query)),
        ),
      );
    return regular(url, init);
  });
  mount();
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: "v" });
  await waitFor(() => expect(window.location.pathname).toBe("/overview"));
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${t.pipelineValue}`) }),
  );
  const drawer = screen.getByRole("dialog", { name: t.openPipeline });
  fireEvent.click(
    within(drawer).getByRole("button", { name: /Cedar workflow pilot/ }),
  );
  await waitFor(() =>
    expect(window.location.search).toContain(`deal=${demoId(1100)}`),
  );
  expect(screen.getByRole("dialog", { name: t.editOpportunity })).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole("dialog", { name: t.editOpportunity })).getByRole(
      "button",
      { name: t.cancel },
    ),
  );
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: "v" });
  await waitFor(() => expect(window.location.pathname).toBe("/overview"));
  fireEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(`^${t.messagesSent}`),
    }),
  );
  const messages = screen.getByRole("dialog", { name: t.messagesSent });
  await within(messages).findByRole("button", {
    name: /evaluation workflow we discussed/,
  });
  fireEvent.click(
    within(messages).getByRole("button", {
      name: /evaluation workflow we discussed/,
    }),
  );
  await screen.findByRole("heading", { name: "Mira Chen" });
});

test("deal form retains typed value when currency changes and saves all fields with a version", async () => {
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request mock");
  request.mockImplementation(async (url, init) =>
    init?.method === "POST"
      ? serialize(
          await service.saveOpportunity(
            principal,
            opportunitySchema.parse(JSON.parse(String(init.body))),
          ),
        )
      : regular(url, init),
  );
  mount(`/opportunities?deal=${demoId(1100)}`);
  const dialog = screen.getByRole("dialog", { name: t.editOpportunity });
  const amount = within(dialog).getByLabelText(t.amount);
  await waitFor(() => expect(amount.hasAttribute("disabled")).toBe(false));
  await waitFor(() =>
    expect(dialog.querySelector("fieldset")?.disabled).toBe(false),
  );
  fireEvent.change(amount, { target: { value: "1234.50" } });
  fireEvent.change(within(dialog).getByLabelText(t.currency), {
    target: { value: "EUR" },
  });
  expect((amount as HTMLInputElement).value).toBe("1234.50");
  fireEvent.change(within(dialog).getByLabelText(t.probability), {
    target: { value: "75" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.expectedCloseDate), {
    target: { value: "2026-12-31" },
  });
  fireEvent.change(within(dialog).getByLabelText(t.dealDescription), {
    target: { value: "Fictional context" },
  });
  fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: t.editOpportunity }),
    ).toBeNull(),
  );
  const saved = (
    await service.snapshot(principal, { organizationId: demoId(1) })
  ).opportunities.find((d) => d.id === demoId(1100));
  expect(saved).toMatchObject({
    amountMinor: 123450,
    currency: "EUR",
    probability: 75,
    expectedCloseDate: "2026-12-31",
    description: "Fictional context",
    version: 2,
  });
});

test("pipeline form creates a second pipeline and refreshes the board", async () => {
  const regular = request.getMockImplementation();
  if (!regular) throw new Error("Missing request mock");
  request.mockImplementation(async (url, init) =>
    init?.method === "POST"
      ? serialize(
          await service.createPipeline(
            principal,
            pipelineSchema.parse(JSON.parse(String(init.body))),
          ),
        )
      : regular(url, init),
  );
  mount("/opportunities");
  fireEvent.click(screen.getByRole("button", { name: t.newPipeline }));
  const dialog = screen.getByRole("dialog", { name: t.newPipeline });
  fireEvent.change(within(dialog).getByLabelText(t.name), {
    target: { value: "Fictional enterprise sales" },
  });
  fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: t.newPipeline })).toBeNull(),
  );
  expect(
    screen.getByRole("option", { name: /Fictional enterprise sales/ }),
  ).toBeTruthy();
});
