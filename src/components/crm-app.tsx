"use client";
import {
  createRefreshCoordinator,
  productSnapshot,
} from "@crm/core/client-state";
import type {
  ClientCompanyContext,
  ClientContext,
  ClientSnapshot,
} from "@crm/core/dto";
import type { View } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleHelp,
  Hourglass,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActionDialog } from "./action-dialog";
import { setSidebarCollapsed, toggleTheme, useAppearance } from "./appearance";
import {
  dateLabel,
  errorText,
  label,
  type Organization,
  requestJson,
} from "./client-api";
import { Commands } from "./commands";
import { Connections } from "./connections";
import { focusRecord, useKeyboardNavigation } from "./keyboard-navigation";
import { Materials } from "./materials";
import { ResizeHandle, usePanelLayout } from "./panel-layout";
import { PersonDialog } from "./person-dialog";
import { Preferences } from "./preferences";
import { CompanyDetails, PersonDetails, RelatedWork } from "./record-details";
import { SettingsForm } from "./settings-form";
import {
  breadcrumbsFor,
  listedViews,
  pinnedViews,
  viewIcons,
  viewSections,
} from "./shell/navigation";
import { Sidebar, type SidebarGroup } from "./shell/sidebar";
import { TopBar } from "./shell/top-bar";
import { initials, WorkspaceMenu } from "./shell/workspace-menu";
import { Shortcuts } from "./shortcuts";
import { EmptyState, ErrorState, LoadingState } from "./ui/states";
import { Toaster, useToasts } from "./ui/toaster";

const owedIcons = { us: UserRound, them: Hourglass, unknown: CircleHelp };
const compactScreen = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(max-width: 760px)").matches;
export function CrmApp({
  initial,
  organizations: initialOrganizations,
  initialOrganizationId,
  initialProductId = "",
  mcpEndpoint = "",
  userId,
  demo,
}: {
  initial: ClientSnapshot | null;
  organizations: Organization[];
  initialOrganizationId: string;
  initialProductId?: string;
  mcpEndpoint?: string;
  userId: string;
  demo: boolean;
}) {
  const panels = usePanelLayout();
  const [selectedCompany, setSelectedCompany] = useState("");
  const [companyContext, setCompanyContext] =
    useState<ClientCompanyContext | null>(null);
  const [focusedRecord, setFocusedRecord] = useState("");
  const [recordHistory, setRecordHistory] = useState<
    { relationshipId: string; companyId: string; actionId: string }[]
  >([]);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [productId, setProductId] = useState(initialProductId);
  const [view, setView] = useState<View>("actions");
  const [loadFailed, setLoadFailed] = useState(false);
  const [sourceData, setData] = useState(initial);
  const data = useMemo(
    () => (sourceData ? productSnapshot(sourceData, productId) : null),
    [sourceData, productId],
  );
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState("");
  const [awaitingThem, setAwaitingThem] = useState(false);
  const [selected, setSelected] = useState(
    initial?.actions.find(
      (a) =>
        a.status === "blocked" &&
        (!initialProductId || a.productId === initialProductId),
    )?.relationshipId ?? "",
  );
  const [selectedAction, setSelectedAction] = useState(
    initial?.actions.find(
      (a) =>
        a.status === "blocked" &&
        (!initialProductId || a.productId === initialProductId),
    )?.id ?? "",
  );
  const [context, setContext] = useState<ClientContext | null>(null);
  const [tab, setTab] = useState<"timeline" | "evidence" | "draft">("timeline");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const { toasts, notify, dismiss } = useToasts();
  const appearance = useAppearance();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [personDialog, setPersonDialog] = useState(false);
  const [actionDialog, setActionDialog] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [syncState, setSyncState] = useState("reconnecting");
  const searchInput = useRef<HTMLInputElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const activeOrganization = useRef(organizationId);
  activeOrganization.current = organizationId;
  const mutating = useRef(false);
  const activeAction = useRef(selectedAction);
  activeAction.current = selectedAction;
  const refreshCoordinator = useMemo(() => createRefreshCoordinator(), []);
  const returnFocus = useRef<HTMLElement | null>(null);
  const draftBuffers = useRef(
    new Map<string, { text: string; version: number }>(),
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const contextCache = useRef(new Map<string, ClientContext>());
  const contextScope = useRef("");
  const companyScope = useRef("");
  const revision = useRef("");
  const fetchGeneration = useRef(0);
  const refresh = useCallback(
    () =>
      refreshCoordinator(async () => {
        if (!organizationId || activeOrganization.current !== organizationId)
          return;
        const generation = ++fetchGeneration.current;
        try {
          const snapshot = await requestJson<ClientSnapshot>(
            `/api/crm?organizationId=${organizationId}`,
          );
          if (
            activeOrganization.current === organizationId &&
            generation === fetchGeneration.current
          ) {
            setData(snapshot);
            setLoadFailed(false);
          }
        } catch (error) {
          if (
            activeOrganization.current === organizationId &&
            generation === fetchGeneration.current
          ) {
            setLoadFailed(true);
            notify(errorText(error), "danger");
            if (
              error instanceof Error &&
              ["FORBIDDEN", "UNAUTHORIZED"].includes(error.message)
            ) {
              setData(null);
              setContext(null);
              setSelectedCompany("");
              setCompanyContext(null);
              setRecordHistory([]);
              setSelected("");
              setSelectedAction("");
              draftBuffers.current.clear();
              contextCache.current.clear();
            }
          }
        }
      }),
    [organizationId, refreshCoordinator, notify],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!organizationId) return;
    let stopped = false;
    const feed = new EventSource(
      `/api/events?organizationId=${organizationId}`,
    );
    feed.onopen = () => {
      if (!stopped) setSyncState("live");
    };
    feed.onerror = () => {
      if (!stopped) setSyncState("reconnecting");
    };
    feed.addEventListener("revision", (event) => {
      const result = JSON.parse((event as MessageEvent).data) as {
        revision: string;
      };
      if (!stopped && revision.current !== result.revision) {
        revision.current = result.revision;
        void refresh();
      }
    });
    feed.addEventListener("access-changed", () => {
      feed.close();
      if (!stopped) {
        setSyncState("reconnecting");
        void refresh();
      }
    });
    const recover = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const result = await requestJson<{ revision: string }>(
          `/api/crm?operation=revision&organizationId=${organizationId}`,
        );
        if (!stopped && revision.current !== result.revision) {
          revision.current = result.revision;
          void refresh();
        }
      } catch {
        if (!stopped) void refresh();
      }
    };
    const interval = setInterval(() => {
      if (feed.readyState !== EventSource.OPEN) void recover();
    }, 5000);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      stopped = true;
      feed.close();
      clearInterval(interval);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [organizationId, refresh]);
  useEffect(() => {
    const scope = `${organizationId}/${selected}`;
    if (contextScope.current !== scope) {
      contextScope.current = scope;
      setContext(contextCache.current.get(`${scope}/${data?.asOf}`) ?? null);
    }
    if (!selected || !organizationId || !data?.asOf) return;
    const controller = new AbortController();
    requestJson<ClientContext>(
      `/api/crm?operation=context&organizationId=${organizationId}&relationshipId=${selected}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        contextCache.current.set(`${scope}/${data.asOf}`, result);
        setContext(result);
        if (contextCache.current.size > 50)
          contextCache.current.delete(
            contextCache.current.keys().next().value ?? "",
          );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          notify(errorText(error), "danger");
          if (
            error instanceof Error &&
            ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.message)
          ) {
            setContext(null);
            contextCache.current.clear();
          }
        }
      });
    return () => controller.abort();
  }, [selected, organizationId, data?.asOf, notify]);
  useEffect(() => {
    const scope = `${organizationId}/${productId}/${selectedCompany}`;
    if (companyScope.current !== scope) {
      companyScope.current = scope;
      setCompanyContext(null);
    }
    if (!selectedCompany || !organizationId || !data?.asOf) return;
    const controller = new AbortController();
    void requestJson<ClientCompanyContext>(
      `/api/crm?operation=company&organizationId=${organizationId}&companyId=${selectedCompany}${productId ? `&productId=${productId}` : ""}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setCompanyContext(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          notify(errorText(error), "danger");
          if (
            error instanceof Error &&
            ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.message)
          ) {
            setCompanyContext(null);
            setSelectedCompany("");
            setRecordHistory([]);
          }
        }
      });
    return () => controller.abort();
  }, [selectedCompany, organizationId, productId, data?.asOf, notify]);
  useEffect(() => {
    if (!focusedRecord) return;
    const target = document.querySelector<HTMLElement>(
      `[data-record-id="${focusedRecord}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
    target?.focus({ preventScroll: true });
  }, [focusedRecord]);
  const action =
    data?.actions.find((a) => a.id === selectedAction) ??
    context?.actions.find((a) => a.id === selectedAction);
  useEffect(() => {
    if (!action?.id) {
      setDraft("");
      setDraftVersion(0);
      return;
    }
    const buffer = draftBuffers.current.get(action.id);
    setDraft(buffer?.text ?? action.draft ?? "");
    setDraftVersion(buffer?.version ?? action.version);
    if (buffer && buffer.version !== action.version && !mutating.current)
      notify(t.errors.CONFLICT, "danger");
  }, [action?.draft, action?.id, action?.version, notify]);
  async function mutate(body: object) {
    if (mutating.current) return false;
    mutating.current = true;
    const submittedOrganization = organizationId;
    setBusy(true);
    try {
      const result = await requestJson<unknown>("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (activeOrganization.current !== submittedOrganization) return true;
      // A read started before this commit must not overwrite its confirmed result.
      fetchGeneration.current++;
      const changed = body as { operation?: string; actionId?: string };
      if (changed.operation === "action") {
        const updatedAction = result as ClientSnapshot["actions"][number];
        draftBuffers.current.delete(updatedAction.id);
        if (activeAction.current === updatedAction.id) {
          setDraft(updatedAction.draft);
          setDraftVersion(updatedAction.version);
        }
        setData((previous) =>
          previous
            ? {
                ...previous,
                asOf: new Date().toISOString(),
                actions: previous.actions.map((item) =>
                  item.id === updatedAction.id ? updatedAction : item,
                ),
              }
            : previous,
        );
      }
      if (changed.operation === "action" && changed.actionId)
        draftBuffers.current.delete(changed.actionId);
      void refresh();
      notify(t.updated, "success");
      return true;
    } catch (error) {
      if (activeOrganization.current === submittedOrganization) {
        notify(errorText(error), "danger");
        if (
          error instanceof Error &&
          ["CONFLICT", "FORBIDDEN", "UNAUTHORIZED"].includes(error.message)
        )
          void refresh();
      }
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  function switchOrganization(id: string) {
    setAwaitingThem(false);
    setSelectedCompany("");
    setCompanyContext(null);
    setRecordHistory([]);
    panels.setExpanded(false);
    setPersonDialog(false);
    setActionDialog(false);
    fetchGeneration.current++;
    draftBuffers.current.clear();
    contextCache.current.clear();
    setOrganizationId(id);
    setProductId("");
    setData(null);
    setLoadFailed(false);
    setContext(null);
    setSelected("");
    setSelectedAction("");
    setSearch("");
    revision.current = "";
  }
  function switchProduct(id: string) {
    setAwaitingThem(false);
    setSelectedCompany("");
    setCompanyContext(null);
    setRecordHistory([]);
    panels.setExpanded(false);
    setPersonDialog(false);
    setActionDialog(false);
    setProductId(id);
    setSelected("");
    setSelectedAction("");
    setContext(null);
  }
  function navigate(next: View) {
    setSelectedCompany("");
    setCompanyContext(null);
    setRecordHistory([]);
    setFocusedRecord("");
    panels.setExpanded(false);
    setDrawerOpen(false);
    setView(next);
    requestAnimationFrame(() => {
      if (!document.querySelector("dialog[open]"))
        document.querySelector<HTMLElement>(".view-title")?.focus();
    });
    setSearch("");
    setOwner("");
    setKind("");
    setAwaitingThem(false);
    if (next !== "actions" && next !== "people") {
      setSelected("");
      setSelectedAction("");
    }
  }
  function toggleSidebar() {
    if (compactScreen()) setDrawerOpen((open) => !open);
    else setSidebarCollapsed(!appearance.sidebarCollapsed);
  }
  function closeInspector() {
    returnFocus.current?.focus();
    setSelected("");
    setSelectedCompany("");
    setSelectedAction("");
    setRecordHistory([]);
    panels.setExpanded(false);
  }
  function rememberRecord() {
    if (selected || selectedCompany)
      setRecordHistory((history) => [
        ...history.slice(-19),
        {
          relationshipId: selected,
          companyId: selectedCompany,
          actionId: selectedAction,
        },
      ]);
  }
  function openPerson(relationshipId: string, actionId = "") {
    const relationship =
      data?.relationships.find((r) => r.id === relationshipId) ??
      context?.relationships.find((r) => r.id === relationshipId);
    if (productId && relationship && relationship.productId !== productId)
      switchProduct(relationship.productId);
    else if (relationshipId !== selected || selectedCompany) rememberRecord();
    setSelectedCompany("");
    setSelected(relationshipId);
    setSelectedAction(actionId);
    const kind = data?.actions.find((action) => action.id === actionId)?.kind;
    setTab(
      actionId && (kind === "reply" || kind === "approval")
        ? "draft"
        : "timeline",
    );
  }
  function openCompany(companyId: string) {
    rememberRecord();
    setSelectedCompany(companyId);
    setSelected("");
    setSelectedAction("");
  }
  function previousRecord() {
    const previous = recordHistory.at(-1);
    if (!previous) return;
    setRecordHistory(recordHistory.slice(0, -1));
    setSelected(previous.relationshipId);
    setSelectedCompany(previous.companyId);
    setSelectedAction(previous.actionId);
    setTab("timeline");
  }
  function revealRecord(view: "meetings" | "opportunities", id: string) {
    navigate(view);
    setFocusedRecord(id);
  }
  function warmContext(relationshipId: string) {
    if (!relationshipId || !data?.asOf) return;
    const key = `${organizationId}/${relationshipId}/${data.asOf}`;
    if (contextCache.current.has(key)) return;
    void requestJson<ClientContext>(
      `/api/crm?operation=context&organizationId=${organizationId}&relationshipId=${relationshipId}`,
    )
      .then((result) => {
        contextCache.current.set(key, result);
        if (contextCache.current.size > 50)
          contextCache.current.delete(
            contextCache.current.keys().next().value ?? "",
          );
      })
      .catch(() => {});
  }
  const product = (id: string) => data?.products.find((p) => p.id === id);
  const member = (id: string) =>
    data?.members.find((m) => m.id === id)?.name ?? t.unknown;
  const personFor = (relationshipId: string) =>
    data?.people.find(
      (p) =>
        p.id ===
        data.relationships.find((r) => r.id === relationshipId)?.personId,
    );
  const companyFor = (personId: string) =>
    data?.companies.find(
      (c) => c.id === data.people.find((p) => p.id === personId)?.companyId,
    );
  const matches = (...values: (string | undefined | null)[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
  const visibleActions =
    data?.actions.filter(
      (a) =>
        a.status !== "completed" &&
        (!owner || a.ownerId === owner) &&
        (!kind || a.kind === kind) &&
        (!awaitingThem || a.owedBy === "them") &&
        matches(
          a.title,
          personFor(a.relationshipId)?.name,
          companyFor(personFor(a.relationshipId)?.id ?? "")?.name,
        ),
    ) ?? [];
  useKeyboardNavigation((command) => {
    if (["next", "previous", "first", "last"].includes(command)) {
      if (
        !document.activeElement?.classList.contains("view-title") &&
        document.activeElement?.closest(
          "#record-inspector, .sidebar, .resize-handle, header, .toolbar",
        )
      )
        return false;
      return focusRecord(command);
    }
    if (command === "commands") setCommandsOpen(true);
    else if (command === "help") setHelpOpen(true);
    else if (command === "search") {
      if (!searchInput.current) return false;
      searchInput.current.focus();
    } else if (command === "sidebar") {
      toggleSidebar();
    } else if (command === "organization") {
      if (compactScreen()) setDrawerOpen(true);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>("[data-workspace-trigger]")
          ?.focus(),
      );
    } else if (command === "product") {
      const filter = document.querySelector<HTMLSelectElement>(
        `select[aria-label="${t.product}"]`,
      );
      if (!filter) return false;
      filter.focus();
    } else if (command === "create" && view === "people") {
      if (!data?.products.length) return false;
      setPersonDialog(true);
    } else if (command === "schedule" || command === "create") {
      if (!data?.relationships.length) return false;
      setActionDialog(true);
    } else if (command === "close") {
      const target = document.activeElement;
      if (drawerOpen) {
        setDrawerOpen(false);
        document.querySelector<HTMLElement>(".drawer-trigger")?.focus();
      } else if (target === searchInput.current) {
        if (search) setSearch("");
        else {
          searchInput.current?.blur();
          document.querySelector<HTMLElement>(".view-title")?.focus();
        }
      } else if (target?.closest("textarea, input, select, [contenteditable]"))
        return false;
      else {
        closeInspector();
        returnFocus.current?.focus();
      }
    } else if (command === "listFocus") {
      return focusRecord("next");
    } else if (command === "detailFocus") {
      const target = document.querySelector<HTMLButtonElement>(
        "#record-inspector button:not(:disabled)",
      );
      if (!target) return false;
      target.focus();
    } else if (command === "back") {
      if (!recordHistory.length) return false;
      previousRecord();
    } else if (command === "expand") {
      if (!selected && !selectedCompany) return false;
      panels.setExpanded(!panels.expanded);
    } else if (["timeline", "evidence", "draft"].includes(command)) {
      if (!selected || (command === "draft" && !action)) return false;
      setTab(command as typeof tab);
      document
        .querySelector<HTMLButtonElement>(`[data-inspector-tab="${command}"]`)
        ?.focus();
    } else navigate(command as View);
    return true;
  });
  const showInspector = !!selected || !!selectedCompany;
  const isAdmin =
    data?.members.find((member) => member.id === userId)?.role === "admin";
  const currentOrg = organizations.find((org) => org.id === organizationId);
  const openCount =
    data?.actions.filter((a) => a.status !== "completed").length ?? 0;
  const savedViews = [
    { id: "reply", name: t.replies },
    { id: "commitment", name: t.promises },
    { id: "waiting", name: t.waiting },
  ];
  const savedActive = (id: string) =>
    view === "actions" &&
    (id === "waiting" ? awaitingThem : !awaitingThem && kind === id);
  const sidebarProducts = (data?.products ?? initial?.products ?? []).filter(
    (p) => p.organizationId === organizationId,
  );
  const sidebarGroups: SidebarGroup[] = [
    ...viewSections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.views.map((id) => ({
        id,
        label: label(id),
        icon: viewIcons[id],
        hint: t.keys[id],
        active: view === id,
        onSelect: () => navigate(id),
        ...(id === "actions" ? { count: openCount } : {}),
      })),
    })),
    {
      id: "products",
      title: t.products,
      items: sidebarProducts.length
        ? [
            {
              id: "all-products",
              label: t.allProducts,
              kind: "filter" as const,
              active: !productId,
              onSelect: () => switchProduct(""),
            },
            ...sidebarProducts.map((p) => ({
              id: `product-${p.id}`,
              label: p.name,
              dot: p.color,
              kind: "filter" as const,
              active: productId === p.id,
              onSelect: () => switchProduct(p.id),
            })),
          ]
        : [],
    },
    {
      id: "saved",
      title: t.savedViews,
      items: savedViews.map((saved) => ({
        id: `saved-${saved.id}`,
        label: saved.name,
        dot: `var(--saved-${saved.id})`,
        kind: "filter" as const,
        active: savedActive(saved.id),
        onSelect: () => {
          navigate("actions");
          setKind(saved.id === "waiting" ? "" : saved.id);
          setAwaitingThem(saved.id === "waiting");
        },
      })),
    },
  ];
  const recordName = selectedCompany
    ? companyContext?.company?.name
    : selected
      ? context?.person?.name
      : undefined;
  const crumbs = breadcrumbsFor({
    view: label(view),
    ...(currentOrg ? { workspace: currentOrg.name } : {}),
    ...(productId && product(productId)
      ? { product: product(productId)?.name ?? "" }
      : {}),
    ...(recordName ? { record: recordName } : {}),
  });
  const showProductFilter = !["integrations", "settings"].includes(view);
  const showSearch = !["integrations", "settings", "materials"].includes(view);
  return (
    <div
      ref={panels.frame}
      className="app-shell"
      data-collapsed={appearance.sidebarCollapsed || undefined}
      style={
        {
          "--inspector-width": `${panels.inspector}px`,
        } as CSSProperties
      }
    >
      <Sidebar
        groups={sidebarGroups}
        pinned={pinnedViews.map((id) => ({
          id,
          label: label(id),
          icon: viewIcons[id],
          hint: t.keys[id],
          active: view === id,
          onSelect: () => navigate(id),
        }))}
        collapsed={appearance.sidebarCollapsed}
        drawerOpen={drawerOpen}
        onToggleCollapsed={toggleSidebar}
        onCloseDrawer={() => setDrawerOpen(false)}
        onSearch={() => {
          setDrawerOpen(false);
          setCommandsOpen(true);
        }}
        workspace={
          <WorkspaceMenu
            organizations={organizations}
            organizationId={organizationId}
            userName={member(userId)}
            userDetail={demo ? t.demo : t.brandSub}
            onSwitch={(id) => {
              setDrawerOpen(false);
              switchOrganization(id);
            }}
          />
        }
        footer={
          <div className="sidebar-status" title={t.polling}>
            <span className={`live-status sync-${syncState}`}>
              <span aria-hidden />
            </span>
            <span className="nav-label-text">{label(syncState)}</span>
            {demo && (
              <span
                className="badge status-badge nav-label-text"
                title={t.demoDetail}
              >
                {t.demoMode}
              </span>
            )}
          </div>
        }
      />
      {drawerOpen && (
        <button
          type="button"
          className="drawer-overlay"
          aria-label={t.closeNavigation}
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <main className="main">
        <TopBar
          crumbs={crumbs}
          onSearch={() => setCommandsOpen(true)}
          onOpenNavigation={() => setDrawerOpen(true)}
        />
        {showProductFilter && (
          <div className="toolbar">
            <select
              aria-label={t.product}
              value={productId}
              onChange={(event) => switchProduct(event.target.value)}
            >
              <option value="">{t.allProducts}</option>
              {sidebarProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {showSearch && (
              <label className="search">
                <Search size={14} aria-hidden />
                <input
                  ref={searchInput}
                  type="search"
                  aria-label={t.search}
                  placeholder={t.searchPlaceholder}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            )}
            {view === "actions" && (
              <>
                <select
                  aria-label={t.owner}
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                >
                  <option value="">{t.everyone}</option>
                  <option value={userId}>{t.mine}</option>
                  {data?.members
                    .filter((m) => m.id !== userId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <select
                  aria-label={t.actionType}
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  <option value="">{t.allTypes}</option>
                  {[
                    "reply",
                    "approval",
                    "review",
                    "commitment",
                    "research",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {label(k)}
                    </option>
                  ))}
                </select>
                {awaitingThem && (
                  <button
                    type="button"
                    className="chip"
                    aria-label={`${t.waiting}: ${t.clearFilters}`}
                    onClick={() => setAwaitingThem(false)}
                  >
                    {t.waiting} <X size={12} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="primary toolbar-primary"
                  aria-label={t.scheduleAction}
                  disabled={!data?.relationships.length}
                  onClick={() => setActionDialog(true)}
                >
                  <Plus size={14} aria-hidden />
                  {t.newAction}
                </button>
              </>
            )}
            {view === "people" && (
              <button
                type="button"
                className="primary toolbar-primary"
                disabled={!data?.products.length}
                onClick={() => setPersonDialog(true)}
              >
                <Plus size={14} aria-hidden />
                {t.addPerson}
              </button>
            )}
          </div>
        )}
        {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}
        {commandsOpen && (
          <Commands
            onClose={() => setCommandsOpen(false)}
            commands={[
              {
                id: "help",
                title: t.keyboardHelp,
                shortcut: "?",
                run: () => setHelpOpen(true),
              },
              {
                id: "refresh",
                title: t.refresh,
                shortcut: "",
                run: () => void refresh(),
              },
              {
                id: "theme",
                title: t.toggleTheme,
                shortcut: "",
                run: toggleTheme,
              },
              {
                id: "sidebar",
                title: t.toggleSidebar,
                shortcut: t.keys.sidebar,
                run: toggleSidebar,
              },
              ...listedViews.map((id) => ({
                id,
                title: label(id),
                shortcut: t.keys[id],
                run: () => navigate(id),
              })),
              {
                id: "schedule",
                title: t.scheduleAction,
                shortcut: t.keys.schedule,
                disabled: !data?.relationships.length,
                run: () => setActionDialog(true),
              },
              {
                id: "person",
                title: t.addPerson,
                shortcut: t.keys.create,
                disabled: !data?.products.length,
                run: () => {
                  navigate("people");
                  setPersonDialog(true);
                },
              },
            ]}
          />
        )}
        {actionDialog && data && (
          <ActionDialog
            data={data}
            organizationId={organizationId}
            productId={productId}
            relationshipId={selected}
            userId={userId}
            onClose={() => setActionDialog(false)}
            onCreated={async (result) => {
              if (productId && productId !== result.productId)
                setProductId(result.productId);
              await refresh();
              setSelected(result.relationshipId);
              setSelectedAction(result.actionId);
              setTab("timeline");
              setView("actions");
              setKind("");
              setAwaitingThem(false);
              setOwner("");
              setSearch("");
              notify(t.scheduledAction, "success");
            }}
          />
        )}
        {personDialog && data && (
          <PersonDialog
            key={`${organizationId}-${productId}`}
            data={data}
            organizationId={organizationId}
            productId={productId}
            onClose={() => setPersonDialog(false)}
            onCreated={async (result) => {
              if (productId && productId !== result.productId)
                setProductId(result.productId);
              await refresh();
              setSelected(result.relationshipId);
              setSelectedAction("");
              setTab("timeline");
              notify(t.updated, "success");
            }}
          />
        )}
        {!data ? (
          <div className="workspace-state">
            {organizationId ? (
              loadFailed ? (
                <ErrorState
                  title={t.viewLoadError}
                  onRetry={() => void refresh()}
                />
              ) : (
                <LoadingState />
              )
            ) : (
              <EmptyState title={t.organizationIsolation} compact />
            )}
            {!organizationId && (
              <SettingsForm
                organizationId={organizationId}
                mutate={mutate}
                onOrganizations={async () => {
                  const orgs = await requestJson<Organization[]>(
                    "/api/crm?operation=organizations",
                  );
                  setOrganizations(orgs);
                  switchOrganization(orgs[0]?.id ?? "");
                }}
              />
            )}
          </div>
        ) : (
          <div
            className={`workspace-content ${showInspector ? "with-inspector" : ""} ${showInspector && panels.expanded ? "inspector-expanded" : ""}`}
          >
            <section
              id="records-panel"
              className="content"
              aria-label={label(view)}
              onClickCapture={(event) => {
                const target =
                  event.target instanceof Element
                    ? event.target.closest<HTMLElement>("button, a[href]")
                    : null;
                if (target) returnFocus.current = target;
              }}
            >
              {!data.products.length && view !== "settings" && (
                <EmptyState
                  title={t.noProductsAvailable}
                  description={isAdmin ? t.setupAddProduct : t.setupAskAccess}
                  action={
                    isAdmin && (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => navigate("settings")}
                      >
                        {t.newProduct}
                      </button>
                    )
                  }
                />
              )}
              {view === "actions" && (
                <>
                  {["now", "upcoming"].map((group) => {
                    const list = visibleActions.filter((a) =>
                      group === "now"
                        ? new Date(a.dueAt).getTime() < Date.now() + 86400000
                        : new Date(a.dueAt).getTime() >= Date.now() + 86400000,
                    );
                    return list.length ? (
                      <div key={group}>
                        <div className="group-title">
                          {label(group)}
                          <span>{list.length}</span>
                        </div>
                        {list.map((a) => {
                          const person = personFor(a.relationshipId);
                          const OwedIcon =
                            owedIcons[a.owedBy as keyof typeof owedIcons] ??
                            CircleHelp;
                          return (
                            <button
                              type="button"
                              key={a.id}
                              className="action-row"
                              data-nav-record={a.id}
                              data-action-id={a.id}
                              onPointerEnter={() =>
                                warmContext(a.relationshipId)
                              }
                              aria-pressed={selectedAction === a.id}
                              onClick={() => {
                                openPerson(a.relationshipId, a.id);
                              }}
                            >
                              <span className="row-avatar" aria-hidden>
                                {initials(person?.name ?? "?")}
                              </span>
                              <span className="row-name">{person?.name}</span>
                              <span className="row-company">
                                {companyFor(person?.id ?? "")?.name}
                              </span>
                              <span className="row-action">{a.title}</span>
                              {a.status === "blocked" && (
                                <span className="badge warning">
                                  {t.blocked}
                                </span>
                              )}
                              <span className="row-meta">
                                <span className="row-product">
                                  <span
                                    className="product-dot"
                                    style={{
                                      background: product(a.productId)?.color,
                                    }}
                                  />
                                  {product(a.productId)?.name}
                                </span>
                                <span className="row-kind">
                                  {label(a.kind)}
                                </span>
                                <span
                                  className="row-owner"
                                  title={member(a.ownerId)}
                                >
                                  <span aria-hidden>
                                    {initials(member(a.ownerId))}
                                  </span>
                                  <span className="sr-only">
                                    {member(a.ownerId)}
                                  </span>
                                </span>
                              </span>
                              <span
                                className={`row-owed owed-${a.owedBy}`}
                                title={`${t.owedBy} ${label(a.owedBy)}`}
                              >
                                <OwedIcon size={13} aria-hidden />
                                <span className="sr-only">
                                  {t.owedBy} {label(a.owedBy)}
                                </span>
                              </span>
                              <span
                                className={`row-due${
                                  new Date(a.dueAt).getTime() <
                                  Date.now() - 86400000
                                    ? " overdue"
                                    : ""
                                }`}
                              >
                                {dateLabel(a.dueAt, currentOrg?.timezone)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null;
                  })}
                  {!visibleActions.length &&
                    (!data.people.length && data.products.length ? (
                      <EmptyState
                        title={t.workspaceReady}
                        description={t.workspaceNextStep}
                        action={
                          <>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => setPersonDialog(true)}
                            >
                              {t.addPerson}
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate("integrations")}
                            >
                              {t.connectTools}
                            </button>
                          </>
                        }
                      />
                    ) : data.products.length ? (
                      <EmptyState title={t.noResults} compact />
                    ) : null)}
                </>
              )}
              {view === "people" && (
                <div className="table-scroll">
                  {!data.people.some((p) =>
                    matches(p.name, p.title, companyFor(p.id)?.name),
                  ) && <EmptyState title={t.noPeople} compact />}
                  <table>
                    <thead>
                      <tr>
                        <th>{t.name}</th>
                        <th>{t.company}</th>
                        <th>{t.products}</th>
                        <th>{t.qualification}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.people
                        .filter((p) =>
                          matches(p.name, p.title, companyFor(p.id)?.name),
                        )
                        .map((p) => {
                          const relationships = data.relationships.filter(
                            (r) => r.personId === p.id,
                          );
                          return (
                            <tr key={p.id}>
                              <td>
                                <button
                                  type="button"
                                  className="text-button identity-link"
                                  data-nav-record={p.id}
                                  onFocus={() =>
                                    warmContext(relationships[0]?.id ?? "")
                                  }
                                  aria-label={p.name}
                                  onClick={() => {
                                    openPerson(relationships[0]?.id ?? "");
                                  }}
                                >
                                  {p.name}
                                  <small>{p.title}</small>
                                </button>
                              </td>
                              <td>
                                {companyFor(p.id) ? (
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() =>
                                      openCompany(companyFor(p.id)?.id || "")
                                    }
                                  >
                                    {companyFor(p.id)?.name}
                                  </button>
                                ) : (
                                  <span className="muted">
                                    {t.companyMissing}
                                  </span>
                                )}
                              </td>
                              <td>
                                {relationships.map((r) => (
                                  <button
                                    key={r.id}
                                    type="button"
                                    className="badge"
                                    aria-pressed={selected === r.id}
                                    onClick={() => {
                                      openPerson(r.id);
                                    }}
                                  >
                                    {product(r.productId)?.name} ·{" "}
                                    {label(r.purpose)}
                                  </button>
                                ))}
                              </td>
                              <td>
                                {relationships
                                  .map((r) => label(r.qualification))
                                  .join(" · ")}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
              {view === "companies" && (
                <div className="table-scroll">
                  {!data.companies.some((c) => matches(c.name, c.domain)) && (
                    <EmptyState title={t.noCompanies} compact />
                  )}
                  <table>
                    <thead>
                      <tr>
                        <th>{t.company}</th>
                        <th>{t.people}</th>
                        <th>{t.products}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.companies
                        .filter((c) => matches(c.name, c.domain))
                        .map((c) => (
                          <tr key={c.id}>
                            <td>
                              <button
                                type="button"
                                className="text-button"
                                data-nav-record={c.id}
                                onClick={() => openCompany(c.id)}
                              >
                                {c.name}
                              </button>
                              <small>{c.domain}</small>
                            </td>
                            <td>
                              {data.people
                                .filter((p) => p.companyId === c.id)
                                .map((p) => (
                                  <button
                                    type="button"
                                    className="text-button linked-contact"
                                    key={p.id}
                                    onClick={() =>
                                      openPerson(
                                        data.relationships.find(
                                          (r) => r.personId === p.id,
                                        )?.id || "",
                                      )
                                    }
                                  >
                                    {p.name}
                                  </button>
                                ))}
                            </td>
                            <td>
                              {[
                                ...new Set(
                                  data.relationships
                                    .filter((r) =>
                                      data.people.some(
                                        (p) =>
                                          p.id === r.personId &&
                                          p.companyId === c.id,
                                      ),
                                    )
                                    .map((r) => product(r.productId)?.name),
                                ),
                              ].join(", ")}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {view === "sequences" && (
                <div className="page-content">
                  {!data.sequences.some((s) =>
                    matches(s.name, product(s.productId)?.name),
                  ) && <EmptyState title={t.noSequences} compact />}
                  {data.sequences
                    .filter((sequence) =>
                      matches(sequence.name, product(sequence.productId)?.name),
                    )
                    .map((sequence) => (
                      <article className="sequence" key={sequence.id}>
                        <div className="section-heading">
                          <div>
                            <span className="eyebrow">
                              {product(sequence.productId)?.name}
                            </span>
                            <h2>{sequence.name}</h2>
                          </div>
                          <span className="badge">
                            {t.sequenceVersion} {sequence.version}
                          </span>
                        </div>
                        <div className="sequence-steps">
                          {sequence.steps.map((step) => (
                            <div className="sequence-step" key={step.number}>
                              <span className="step-number">{step.number}</span>
                              <div>
                                <strong>{step.name}</strong>
                                <small>
                                  {step.delayDays
                                    ? `${step.delayDays} ${t.delay}`
                                    : t.firstStep}{" "}
                                  · {label(step.channel)}
                                </small>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="sequence-states">
                          {data.enrollments
                            .filter((e) => e.sequenceId === sequence.id)
                            .map((e) => (
                              <button
                                type="button"
                                data-nav-record={e.id}
                                onClick={() => openPerson(e.relationshipId)}
                                className={`badge ${e.status === "paused_reply" ? "warning" : ""}`}
                                key={e.id}
                              >
                                {personFor(e.relationshipId)?.name} ·{" "}
                                {label(e.status)}
                              </button>
                            ))}
                        </div>
                        <p className="muted">{t.sequenceNote}</p>
                      </article>
                    ))}
                </div>
              )}
              {view === "meetings" && (
                <div className="page-content">
                  <p className="callout">{t.meetingNote}</p>
                  {!data.meetings.some((m) =>
                    matches(m.title, personFor(m.relationshipId)?.name),
                  ) && <EmptyState title={t.noMeetings} compact />}
                  {data.meetings
                    .filter((meeting) =>
                      matches(
                        meeting.title,
                        personFor(meeting.relationshipId)?.name,
                      ),
                    )
                    .map((meeting) => (
                      <article
                        className={`meeting ${focusedRecord === meeting.id ? "record-highlight" : ""}`}
                        key={meeting.id}
                        data-record-id={meeting.id}
                        tabIndex={-1}
                      >
                        <div className="section-heading">
                          <div>
                            <span className="eyebrow">
                              {product(meeting.productId)?.name} ·{" "}
                              {dateLabel(
                                meeting.startsAt,
                                currentOrg?.timezone,
                              )}
                            </span>
                            <h2>{meeting.title}</h2>
                            <p className="muted">
                              <button
                                data-nav-record={meeting.id}
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  openPerson(meeting.relationshipId)
                                }
                              >
                                {personFor(meeting.relationshipId)?.name}
                              </button>
                            </p>
                          </div>
                          <span className="badge">{label(meeting.status)}</span>
                        </div>
                        <p>{meeting.summary}</p>
                        {meeting.proposedCommitment && (
                          <div className="commitment-box">
                            <span className="eyebrow">{t.meetingProposal}</span>
                            <p>{meeting.proposedCommitment}</p>
                            {meeting.commitmentActionId ? (
                              <span className="success">
                                {t.commitmentAccepted}
                              </span>
                            ) : (
                              <form
                                className="inline-form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const form = new FormData(
                                    event.currentTarget,
                                  );
                                  void mutate({
                                    operation: "commitment",
                                    organizationId,
                                    meetingId: meeting.id,
                                    version: meeting.version,
                                    ownerId: form.get("ownerId"),
                                    dueAt: new Date(
                                      String(form.get("dueAt")),
                                    ).toISOString(),
                                  });
                                }}
                              >
                                <label>
                                  {t.owner}
                                  <select
                                    name="ownerId"
                                    defaultValue={userId}
                                    disabled={busy}
                                  >
                                    {data.members
                                      .filter((m) =>
                                        m.productIds.includes(
                                          meeting.productId,
                                        ),
                                      )
                                      .map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.name}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                <label>
                                  {t.commitmentDate}
                                  <input
                                    name="dueAt"
                                    disabled={busy}
                                    type="datetime-local"
                                    required
                                  />
                                </label>
                                <button
                                  type="submit"
                                  className="primary"
                                  disabled={busy}
                                >
                                  {t.acceptCommitment}
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                </div>
              )}
              {view === "opportunities" && (
                <div className="page-content deal-board">
                  {data.products
                    .filter((p) => !productId || p.id === productId)
                    .map((p) => (
                      <div key={p.id} className="product-pipeline">
                        <h2>
                          <span
                            className="product-dot"
                            style={{ background: p.color }}
                          />
                          {p.name}
                        </h2>
                        <div className="pipeline-stages">
                          {data.stages
                            .filter((stage) => stage.productId === p.id)
                            .map((stage) => (
                              <section key={stage.id}>
                                <div className="group-title">
                                  {stage.name}
                                  <span>
                                    {
                                      data.opportunities.filter(
                                        (o) => o.stageId === stage.id,
                                      ).length
                                    }
                                  </span>
                                </div>
                                {data.opportunities
                                  .filter(
                                    (o) =>
                                      o.stageId === stage.id &&
                                      matches(
                                        o.name,
                                        personFor(o.relationshipId)?.name,
                                      ),
                                  )
                                  .map((o) => (
                                    <article
                                      className={`deal-card ${focusedRecord === o.id ? "record-highlight" : ""}`}
                                      key={o.id}
                                      data-record-id={o.id}
                                      tabIndex={-1}
                                    >
                                      <button
                                        data-nav-record={o.id}
                                        type="button"
                                        className="text-button"
                                        onClick={() =>
                                          openPerson(o.relationshipId)
                                        }
                                      >
                                        {o.name}
                                      </button>
                                      <p>
                                        <button
                                          type="button"
                                          className="text-button"
                                          onClick={() =>
                                            openPerson(o.relationshipId)
                                          }
                                        >
                                          {personFor(o.relationshipId)?.name}
                                        </button>
                                      </p>
                                      <small>
                                        {o.amountMinor !== null
                                          ? new Intl.NumberFormat("en", {
                                              style: "currency",
                                              currency: o.currency,
                                              maximumFractionDigits: 0,
                                            }).format(o.amountMinor / 100)
                                          : t.amountUnknown}
                                      </small>
                                    </article>
                                  ))}
                              </section>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {view === "materials" && (
                <Materials
                  data={data}
                  organizationId={organizationId}
                  productId={productId}
                  refresh={refresh}
                  onNotice={(text) => notify(text, "success")}
                  timeZone={currentOrg?.timezone ?? "UTC"}
                />
              )}
              {view === "integrations" && (
                <Connections
                  data={data}
                  endpoint={mcpEndpoint}
                  demo={demo}
                  onRevoke={revokeGrant}
                />
              )}
              {view === "settings" && (
                <div className="page-content">
                  <section className="settings-section">
                    <h2>{t.preferences}</h2>
                    <p className="muted">{t.preferencesDetail}</p>
                    <Preferences labelled />
                  </section>
                  <p className="callout">{t.organizationIsolation}</p>
                  <a className="auth-link" href="/onboarding">
                    {t.createWorkspace}
                  </a>
                  <SettingsForm
                    organizationId={organizationId}
                    canCreateProduct={
                      data.members.find((member) => member.id === userId)
                        ?.role === "admin"
                    }
                    mutate={mutate}
                    onOrganizations={async () =>
                      setOrganizations(
                        await requestJson<Organization[]>(
                          "/api/crm?operation=organizations",
                        ),
                      )
                    }
                  />
                  <h2 className="spaced">{t.products}</h2>
                  {data.products.map((p) => (
                    <div className="setting-row" key={p.id}>
                      <span
                        className="product-dot"
                        style={{ background: p.color }}
                      />
                      {p.name}
                    </div>
                  ))}
                  <h2 className="spaced">{t.members}</h2>
                  {data.members.map((m) => (
                    <div className="setting-row" key={m.id}>
                      <span>{m.name}</span>
                      <span className="badge">{label(m.role)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {showInspector && (
              <ResizeHandle
                className="inspector-resize"
                controls="record-inspector"
                label={t.resizeInspector}
                hint={t.resizeHint}
                value={panels.inspector}
                min={300}
                max={panels.inspectorMax}
                direction={-1}
                onChange={panels.resizeInspector}
                onReset={() => panels.resizeInspector(400)}
              />
            )}
            {showInspector && (
              <aside
                id="record-inspector"
                className="inspector"
                aria-label={t.recordDetails}
              >
                <div className="inspector-heading">
                  <span className="eyebrow">
                    {selectedCompany ? t.companyDetails : t.relationships}
                  </span>
                  <div className="inspector-controls">
                    {!!recordHistory.length && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t.backToRecord}
                        onClick={previousRecord}
                      >
                        <ArrowLeft size={15} />
                      </button>
                    )}
                    {!selectedCompany && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t.scheduleAction}
                        onClick={() => setActionDialog(true)}
                      >
                        <Plus size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button expand-control"
                      aria-label={
                        panels.expanded
                          ? t.collapseInspector
                          : t.expandInspector
                      }
                      onClick={() => panels.setExpanded(!panels.expanded)}
                    >
                      {panels.expanded ? (
                        <Minimize2 size={15} />
                      ) : (
                        <Maximize2 size={15} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t.closeInspector}
                      onClick={closeInspector}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                {selectedCompany ? (
                  companyContext ? (
                    <CompanyDetails
                      context={companyContext}
                      onPerson={openPerson}
                      onAction={openPerson}
                      onReveal={revealRecord}
                      timeZone={currentOrg?.timezone || "UTC"}
                    />
                  ) : (
                    <LoadingState rows={4} />
                  )
                ) : !context ? (
                  <LoadingState rows={4} />
                ) : (
                  <>
                    <div className="profile">
                      <span className="profile-avatar">
                        {initials(context.person?.name ?? "")}
                      </span>
                      <div>
                        <h2>{context.person?.name}</h2>
                        <p>{context.person?.title}</p>
                        <small>
                          {context.company && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                openCompany(context.company?.id || "")
                              }
                            >
                              {context.company.name}
                            </button>
                          )}
                        </small>
                      </div>
                    </div>
                    <PersonDetails
                      context={context}
                      onCompany={openCompany}
                      onPerson={openPerson}
                    />
                    <dl className="properties">
                      <dt>{t.product}</dt>
                      <dd>{product(context.relationship.productId)?.name}</dd>
                      <dt>{t.owner}</dt>
                      <dd>{member(context.relationship.ownerId)}</dd>
                      <dt>{t.purpose}</dt>
                      <dd>{label(context.relationship.purpose)}</dd>
                      <dt>{t.qualification}</dt>
                      <dd>{label(context.relationship.qualification)}</dd>
                      {action && (
                        <>
                          <dt>{t.owedBy}</dt>
                          <dd>{label(action.owedBy)}</dd>
                        </>
                      )}
                    </dl>
                    <p className="context-summary">
                      {context.relationship.context}
                    </p>
                    <div className="tabs">
                      {[
                        "timeline",
                        "evidence",
                        ...(action ? ["draft"] : []),
                      ].map((value) => (
                        <button
                          type="button"
                          key={value}
                          data-inspector-tab={value}
                          aria-pressed={tab === value}
                          onClick={() => setTab(value as typeof tab)}
                        >
                          {label(value)}
                        </button>
                      ))}
                    </div>
                    {tab === "timeline" && (
                      <>
                        <div className="timeline">
                          {context.messages.length ? (
                            context.messages.map((message) => (
                              <article
                                className="timeline-event"
                                key={message.id}
                              >
                                <span
                                  className={`event-dot ${message.direction}`}
                                />
                                <div className="event-title">
                                  {message.direction === "inbound"
                                    ? t.incoming
                                    : t.outgoing}
                                  <small>
                                    {label(message.channel)} ·{" "}
                                    {dateLabel(
                                      message.occurredAt,
                                      currentOrg?.timezone,
                                    )}
                                  </small>
                                </div>
                                <p>{message.body}</p>
                              </article>
                            ))
                          ) : (
                            <p className="muted">{t.noMessages}</p>
                          )}
                        </div>
                        <p className="coverage-note">{t.partialHistory}</p>
                      </>
                    )}
                    {tab === "evidence" && (
                      <>
                        {context.evidence.map((e) => (
                          <article className="evidence-item" key={e.id}>
                            <div>
                              <strong>{e.title}</strong>
                              <span className="badge">
                                {label(e.classification)}
                              </span>
                            </div>
                            <p>{e.excerpt}</p>
                            <small>
                              {e.source} ·{" "}
                              {dateLabel(e.observedAt, currentOrg?.timezone)}
                            </small>
                          </article>
                        ))}
                        {!context.evidence.length && (
                          <p className="muted">{t.noEvidence}</p>
                        )}
                      </>
                    )}
                    {tab === "draft" && action && (
                      <div className="draft-panel">
                        {action.status === "blocked" && (
                          <p className="callout warning-text">
                            {t.blockedDetail}
                          </p>
                        )}
                        {action.kind === "review" && (
                          <p className="callout">{t.reviewOnly}</p>
                        )}
                        <label className="sr-only" htmlFor="message-draft">
                          {t.draftLabel}
                        </label>
                        <textarea
                          maxLength={20000}
                          disabled={busy}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              (event.metaKey || event.ctrlKey) &&
                              !event.altKey &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault();
                              event.currentTarget.parentElement
                                ?.querySelector<HTMLButtonElement>(
                                  "[data-save-draft]:not(:disabled)",
                                )
                                ?.click();
                            }
                          }}
                          id="message-draft"
                          value={draft}
                          onChange={(event) => {
                            setDraft(event.target.value);
                            draftBuffers.current.set(action.id, {
                              text: event.target.value,
                              version: draftVersion,
                            });
                          }}
                          rows={9}
                        />
                        <div className="draft-state">
                          {draft !== action.draft
                            ? t.draftChanged
                            : action.approvedHash
                              ? t.approved
                              : t.draft}
                        </div>
                        {draftVersion !== action.version && (
                          <div className="callout warning-text">
                            {t.errors.CONFLICT}
                            <button
                              type="button"
                              onClick={() => {
                                draftBuffers.current.delete(action.id);
                                setDraft(action.draft);
                                setDraftVersion(action.version);
                              }}
                            >
                              {t.reloadDraft}
                            </button>
                          </div>
                        )}
                        <p className="muted">{t.approvalNote}</p>
                        <div className="button-row">
                          {action.status === "blocked" ? (
                            <button
                              type="button"
                              className="primary"
                              disabled={
                                busy || !draft.trim() || draft === action.draft
                              }
                              onClick={() =>
                                void mutate({
                                  operation: "action",
                                  organizationId,
                                  actionId: action.id,
                                  version: draftVersion,
                                  command: "rework",
                                  draft,
                                })
                              }
                            >
                              {t.rework}
                            </button>
                          ) : (
                            <>
                              <button
                                data-save-draft
                                type="button"
                                disabled={busy || draft === action.draft}
                                onClick={() =>
                                  void mutate({
                                    operation: "action",
                                    organizationId,
                                    actionId: action.id,
                                    version: draftVersion,
                                    command: "save",
                                    draft,
                                  })
                                }
                              >
                                {t.saveDraft}
                              </button>
                              <button
                                type="button"
                                className="primary"
                                disabled={
                                  busy ||
                                  !draft.trim() ||
                                  draft !== action.draft ||
                                  !!action.approvedHash
                                }
                                onClick={() =>
                                  void mutate({
                                    operation: "action",
                                    organizationId,
                                    actionId: action.id,
                                    version: draftVersion,
                                    command: "approve",
                                  })
                                }
                              >
                                {t.approveDraft}
                              </button>
                            </>
                          )}
                        </div>
                        <p className="coverage-note">
                          {t.draftSaveHint} · {t.sendingUnavailable}
                        </p>
                      </div>
                    )}
                    <RelatedWork
                      actions={context.actions}
                      meetings={context.meetings}
                      opportunities={context.opportunities}
                      timeZone={currentOrg?.timezone || "UTC"}
                      onAction={openPerson}
                      onReveal={revealRecord}
                    />
                    {action && (
                      <div className="action-summary">
                        <span className="eyebrow">{t.actions}</span>
                        <h3>{action.title}</h3>
                        <p>{action.reason}</p>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            action.status === "blocked" ||
                            action.status === "completed"
                          }
                          onClick={() =>
                            void mutate({
                              operation: "action",
                              organizationId,
                              actionId: action.id,
                              version: draftVersion,
                              command: "complete",
                            })
                          }
                        >
                          {t.markDone}
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </aside>
            )}
          </div>
        )}
      </main>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
  async function revokeGrant(grantId: string) {
    const submittedOrganization = organizationId;
    try {
      await requestJson("/api/grants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId }),
      });
      if (activeOrganization.current !== submittedOrganization) return true;
      await refresh();
      notify(t.updated, "success");
      return true;
    } catch (error) {
      if (activeOrganization.current === submittedOrganization)
        notify(errorText(error), "danger");
      return false;
    }
  }
}
