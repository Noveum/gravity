"use client";
import type { ClientContext, ClientSnapshot } from "@crm/core/dto";
import { shortcutFor } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Layers,
  ListChecks,
  Plug,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionDialog } from "./action-dialog";
import { Commands } from "./commands";
import { Materials } from "./materials";
import { PersonDialog } from "./person-dialog";
import { Preferences } from "./preferences";

type View =
  | "actions"
  | "people"
  | "companies"
  | "sequences"
  | "meetings"
  | "opportunities"
  | "materials"
  | "integrations"
  | "settings";
const nav = [
  { id: "actions", icon: ListChecks },
  { id: "people", icon: Users },
  { id: "companies", icon: Building2 },
  { id: "sequences", icon: GitBranch },
  { id: "meetings", icon: CalendarDays },
  { id: "opportunities", icon: Layers },
  { id: "materials", icon: FolderOpen },
] as const;
export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "INTERNAL_ERROR");
  return data;
}
export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  return t.errors[code as keyof typeof t.errors] ?? t.errors.NETWORK_ERROR;
}
export const label = (key: string) => {
  const value = t[key as keyof typeof t];
  return typeof value === "string" ? value : key;
};
export function dateLabel(value: string, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
const initialLetters = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
export interface Organization {
  id: string;
  name: string;
  timezone: string;
}
export function CrmApp({
  initial,
  organizations: initialOrganizations,
  initialOrganizationId,
  userId,
  demo,
}: {
  initial: ClientSnapshot | null;
  organizations: Organization[];
  initialOrganizationId: string;
  userId: string;
  demo: boolean;
}) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [productId, setProductId] = useState("");
  const [view, setView] = useState<View>("actions");
  const [data, setData] = useState(initial);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState("");
  const [selected, setSelected] = useState(
    initial?.actions.find((a) => a.status === "blocked")?.relationshipId ?? "",
  );
  const [selectedAction, setSelectedAction] = useState(
    initial?.actions.find((a) => a.status === "blocked")?.id ?? "",
  );
  const [context, setContext] = useState<ClientContext | null>(null);
  const [tab, setTab] = useState<"timeline" | "evidence" | "draft">("timeline");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [personDialog, setPersonDialog] = useState(false);
  const [actionDialog, setActionDialog] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [syncState, setSyncState] = useState("reconnecting");
  const searchInput = useRef<HTMLInputElement>(null);
  const shortcutPrefix = useRef(0);
  const draftBuffers = useRef(
    new Map<string, { text: string; version: number }>(),
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const contextCache = useRef(new Map<string, ClientContext>());
  const contextScope = useRef("");
  const revision = useRef("");
  const fetchGeneration = useRef(0);
  const refresh = useCallback(async () => {
    if (!organizationId) return;
    const generation = ++fetchGeneration.current;
    try {
      const snapshot = await requestJson<ClientSnapshot>(
        `/api/crm?organizationId=${organizationId}${productId ? `&productId=${productId}` : ""}`,
      );
      if (generation === fetchGeneration.current) setData(snapshot);
    } catch (error) {
      if (generation === fetchGeneration.current) {
        setNotice(errorText(error));
        if (
          error instanceof Error &&
          ["FORBIDDEN", "UNAUTHORIZED"].includes(error.message)
        ) {
          setData(null);
          setContext(null);
          setSelected("");
          setSelectedAction("");
          draftBuffers.current.clear();
          contextCache.current.clear();
        }
      }
    }
  }, [organizationId, productId]);
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
          setNotice(errorText(error));
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
  }, [selected, organizationId, data?.asOf]);
  const action = data?.actions.find((a) => a.id === selectedAction);
  useEffect(() => {
    if (!action?.id) {
      setDraft("");
      setDraftVersion(0);
      return;
    }
    const buffer = draftBuffers.current.get(action.id);
    setDraft(buffer?.text ?? action.draft ?? "");
    setDraftVersion(buffer?.version ?? action.version);
    if (buffer && buffer.version !== action.version)
      setNotice(t.errors.CONFLICT);
  }, [action?.draft, action?.id, action?.version]);
  async function mutate(body: object) {
    setBusy(true);
    setNotice("");
    try {
      await requestJson("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const changed = body as { operation?: string; actionId?: string };
      if (changed.operation === "action" && changed.actionId)
        draftBuffers.current.delete(changed.actionId);
      await refresh();
      setNotice(t.updated);
      return true;
    } catch (error) {
      setNotice(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function switchOrganization(id: string) {
    setPersonDialog(false);
    setActionDialog(false);
    fetchGeneration.current++;
    draftBuffers.current.clear();
    contextCache.current.clear();
    setOrganizationId(id);
    setProductId("");
    setData(null);
    setContext(null);
    setSelected("");
    setSelectedAction("");
    setSearch("");
    setNotice("");
    revision.current = "";
  }
  function switchProduct(id: string) {
    fetchGeneration.current++;
    setPersonDialog(false);
    setActionDialog(false);
    setProductId(id);
    setSelected("");
    setSelectedAction("");
    setContext(null);
    setData(null);
    setNotice("");
  }
  function navigate(next: View) {
    setView(next);
    setSearch("");
    setNotice("");
    if (next !== "actions" && next !== "people") {
      setSelected("");
      setSelectedAction("");
    }
  }
  function warmContext(relationshipId: string) {
    if (!data?.asOf) return;
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
        matches(
          a.title,
          personFor(a.relationshipId)?.name,
          companyFor(personFor(a.relationshipId)?.id ?? "")?.name,
        ),
    ) ?? [];
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const command = shortcutFor({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        isEditing: !!target?.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]",
        ),
        isModal: !!document.querySelector("dialog[open]"),
        prefix: Date.now() < shortcutPrefix.current,
      });
      shortcutPrefix.current = 0;
      if (!command) return;
      if ((command === "next" || command === "previous") && view !== "actions")
        return;
      event.preventDefault();
      if (command === "prefix") shortcutPrefix.current = Date.now() + 900;
      else if (command === "commands") setCommandsOpen(true);
      else if (command === "search") searchInput.current?.focus();
      else if (command === "schedule") {
        if (data?.relationships.length) setActionDialog(true);
      } else if (command === "close") {
        setSelected("");
        setSelectedAction("");
      } else if (command === "next" || command === "previous") {
        const current = visibleActions.findIndex(
          (a) => a.id === selectedAction,
        );
        const index =
          current < 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  visibleActions.length - 1,
                  current + (command === "next" ? 1 : -1),
                ),
              );
        const next = visibleActions[index];
        if (next) {
          setSelected(next.relationshipId);
          setSelectedAction(next.id);
          setTab("timeline");
          document
            .querySelector<HTMLElement>(`[data-action-id="${next.id}"]`)
            ?.focus();
        }
      } else navigate(command as View);
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  });
  const showInspector = (view === "actions" || view === "people") && !!selected;
  const subtitle = t[`${view}Subtitle` as keyof typeof t] as string;
  const currentOrg = organizations.find((org) => org.id === organizationId);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Sparkles size={16} />
          </span>
          <span>
            {t.brand}
            <small>{t.brandSub}</small>
          </span>
        </div>
        <label className="org-switch">
          <span className="sr-only">{t.workspace}</span>
          <select
            aria-label={t.workspace}
            value={organizationId}
            onChange={(event) => switchOrganization(event.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <div className="nav-label">{t.myWork}</div>
        <nav aria-label={t.myWork}>
          {nav.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => navigate(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={16} />
              <span>{label(item.id)}</span>
              {item.id === "actions" && (
                <span className="nav-count">
                  {data?.actions.filter((a) => a.status !== "completed")
                    .length ?? 0}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label saved-label">{t.savedViews}</div>
        <nav aria-label={t.savedViews}>
          {[
            [t.replies, "reply"],
            [t.promises, "commitment"],
            [t.waiting, "review"],
          ].map(([name, value]) => (
            <button
              type="button"
              key={value}
              onClick={() => {
                navigate("actions");
                setKind(value);
              }}
            >
              <span className={`tiny-dot ${value}`} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <nav>
            <button
              type="button"
              onClick={() => navigate("integrations")}
              aria-current={view === "integrations" ? "page" : undefined}
            >
              <Plug size={16} />
              {t.integrations}
            </button>
            <button
              type="button"
              onClick={() => navigate("settings")}
              aria-current={view === "settings" ? "page" : undefined}
            >
              <Settings2 size={16} />
              {t.settings}
            </button>
          </nav>
          <div className="user">
            <span className="avatar">{initialLetters(member(userId))}</span>
            <div>
              {member(userId)}
              <small>{demo ? t.demo : t.brandSub}</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            {currentOrg?.name ?? t.workspace}
            <ChevronRight size={13} />
            <span>{label(view)}</span>
          </div>
          <div className="top-controls">
            <Preferences />
            <button
              type="button"
              className="icon-button"
              aria-label={t.commands}
              onClick={() => setCommandsOpen(true)}
            >
              <Search size={15} />
              <kbd>{t.keys.commandHint}</kbd>
            </button>
            <select
              aria-label={t.product}
              value={productId}
              onChange={(event) => switchProduct(event.target.value)}
            >
              <option value="">{t.allProducts}</option>
              {(data?.products ?? initial?.products ?? [])
                .filter((p) => p.organizationId === organizationId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label={t.refresh}
              onClick={() => void refresh()}
            >
              <RotateCw size={15} />
            </button>
          </div>
        </header>
        <div className="heading">
          <div>
            <div className="eyebrow">
              {productId ? product(productId)?.name : t.allProducts}
            </div>
            <h1>{label(view)}</h1>
            <p>{subtitle}</p>
          </div>
          <span className={`live-status sync-${syncState}`} title={t.polling}>
            <span />
            {label(syncState)}
          </span>
        </div>
        {!["integrations", "settings", "materials"].includes(view) && (
          <div className="filters">
            <label className="search">
              <Search size={15} />
              <input
                ref={searchInput}
                type="search"
                aria-label={t.search}
                placeholder={t.searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {view === "people" && (
              <button
                type="button"
                className="primary"
                disabled={!data?.products.length}
                onClick={() => setPersonDialog(true)}
              >
                <Plus size={14} />
                {t.addPerson}
              </button>
            )}
            {view === "actions" && (
              <>
                <button
                  type="button"
                  className="primary"
                  disabled={!data?.relationships.length}
                  onClick={() => setActionDialog(true)}
                >
                  <Plus size={14} />
                  {t.scheduleAction}
                </button>
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
              </>
            )}
          </div>
        )}
        {commandsOpen && (
          <Commands
            onClose={() => setCommandsOpen(false)}
            commands={[
              ...nav.map((item) => ({
                id: item.id,
                title: label(item.id),
                shortcut: t.keys[item.id],
                run: () => navigate(item.id),
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
                shortcut: "",
                disabled: !data?.products.length,
                run: () => {
                  navigate("people");
                  setPersonDialog(true);
                },
              },
              {
                id: "integrations",
                title: t.integrations,
                shortcut: "",
                run: () => navigate("integrations"),
              },
              {
                id: "settings",
                title: t.settings,
                shortcut: "",
                run: () => navigate("settings"),
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
              await refresh();
              setSelected(result.relationshipId);
              setSelectedAction(result.actionId);
              setTab("timeline");
              setView("actions");
              setKind("");
              setOwner("");
              setSearch("");
              setNotice(t.scheduledAction);
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
            onCreated={async (relationshipId) => {
              await refresh();
              setSelected(relationshipId);
              setSelectedAction("");
              setTab("timeline");
              setNotice(t.updated);
            }}
          />
        )}
        {!data ? (
          <div className="empty">
            {organizationId ? t.loading : t.organizationIsolation}
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
            className={`workspace-content ${showInspector ? "with-inspector" : ""}`}
          >
            <section className="content" aria-label={label(view)}>
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
                          return (
                            <button
                              type="button"
                              key={a.id}
                              className="action-row"
                              data-action-id={a.id}
                              onPointerEnter={() =>
                                warmContext(a.relationshipId)
                              }
                              aria-pressed={selectedAction === a.id}
                              onClick={() => {
                                setSelected(a.relationshipId);
                                setSelectedAction(a.id);
                                setTab("timeline");
                              }}
                            >
                              <span
                                className="avatar"
                                style={{
                                  background: `${product(a.productId)?.color}18`,
                                  color: product(a.productId)?.color,
                                }}
                              >
                                {initialLetters(person?.name ?? "?")}
                              </span>
                              <div className="row-copy">
                                <div className="row-name">
                                  {person?.name}
                                  <span className="row-company">
                                    {companyFor(person?.id ?? "")?.name}
                                  </span>
                                </div>
                                <div className="row-action">
                                  {a.title}
                                  {a.status === "blocked" && (
                                    <span className="badge warning">
                                      {t.blocked}
                                    </span>
                                  )}
                                </div>
                                <div className="row-meta">
                                  <span
                                    className="product-dot"
                                    style={{
                                      background: product(a.productId)?.color,
                                    }}
                                  />
                                  {product(a.productId)?.name}
                                  <span>·</span>
                                  {label(a.kind)}
                                  <span>·</span>
                                  {member(a.ownerId)}
                                </div>
                              </div>
                              <div className="row-due">
                                <span
                                  className={
                                    new Date(a.dueAt).getTime() <
                                    Date.now() - 86400000
                                      ? "overdue"
                                      : ""
                                  }
                                >
                                  {dateLabel(a.dueAt, currentOrg?.timezone)}
                                </span>
                                <small>{label(a.owedBy)}</small>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null;
                  })}
                  {!visibleActions.length && (
                    <div className="empty">{t.noResults}</div>
                  )}
                </>
              )}
              {view === "people" && (
                <div className="table-scroll">
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
                                  className="text-button"
                                  onClick={() => {
                                    setSelected(relationships[0]?.id ?? "");
                                    setSelectedAction("");
                                    setTab("timeline");
                                  }}
                                >
                                  {p.name}
                                </button>
                                <small>{p.title}</small>
                              </td>
                              <td>{companyFor(p.id)?.name}</td>
                              <td>
                                {relationships.map((r) => (
                                  <button
                                    key={r.id}
                                    type="button"
                                    className="badge"
                                    aria-pressed={selected === r.id}
                                    onClick={() => {
                                      setSelected(r.id);
                                      setSelectedAction("");
                                      setTab("timeline");
                                    }}
                                  >
                                    {product(r.productId)?.name} ·{" "}
                                    {label(r.purpose)}
                                  </button>
                                ))}
                              </td>
                              <td>
                                {relationships.map((r) => (
                                  <div key={r.id}>{label(r.qualification)}</div>
                                ))}
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
                              <strong>{c.name}</strong>
                              <small>{c.domain}</small>
                            </td>
                            <td>
                              {data.people
                                .filter((p) => p.companyId === c.id)
                                .map((p) => p.name)
                                .join(", ")}
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
                              <span
                                className={`badge ${e.status === "paused_reply" ? "warning" : ""}`}
                                key={e.id}
                              >
                                {personFor(e.relationshipId)?.name} ·{" "}
                                {label(e.status)}
                              </span>
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
                  {data.meetings
                    .filter((meeting) =>
                      matches(
                        meeting.title,
                        personFor(meeting.relationshipId)?.name,
                      ),
                    )
                    .map((meeting) => (
                      <article className="meeting" key={meeting.id}>
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
                              {personFor(meeting.relationshipId)?.name}
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
                                  <select name="ownerId" defaultValue={userId}>
                                    {data.members.map((m) => (
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
                                    <article className="deal-card" key={o.id}>
                                      <strong>{o.name}</strong>
                                      <p>{personFor(o.relationshipId)?.name}</p>
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
                  onNotice={setNotice}
                  timeZone={currentOrg?.timezone ?? "UTC"}
                />
              )}
              {view === "integrations" && (
                <div className="page-content integration-grid">
                  {[
                    { name: t.gmail, description: t.gmailDescription },
                    { name: t.linkedin, description: t.linkedinDescription },
                    { name: t.fireflies, description: t.firefliesDescription },
                  ].map((item) => (
                    <article className="integration-card" key={item.name}>
                      <div className="section-heading">
                        <h2>{item.name}</h2>
                        <span className="badge">{t.notConnected}</span>
                      </div>
                      <p>{item.description}</p>
                      <span className="muted">{t.connectLater}</span>
                    </article>
                  ))}
                  <article className="integration-card mcp-card">
                    <div className="section-heading">
                      <h2>{t.mcp}</h2>
                      <span className="badge">OAuth 2.1</span>
                    </div>
                    <p>{t.mcpDescription}</p>
                    <div className="endpoint-field">
                      {t.mcpEndpoint}
                      <code>
                        {typeof window === "undefined"
                          ? ""
                          : window.location.origin}
                        /mcp
                      </code>
                    </div>
                    <p className="callout">
                      {demo ? t.mcpOffline : t.mcpInstructions}
                    </p>
                    <p className="muted">{t.noKey}</p>
                    {data.grants.length ? (
                      data.grants.map((grant) => (
                        <div className="grant-row" key={grant.id}>
                          <span>
                            {grant.productIds
                              .map((id) => product(id)?.name)
                              .join(", ")}
                          </span>
                          <button
                            type="button"
                            onClick={() => void revokeGrant(grant.id)}
                          >
                            {t.revoke}
                          </button>
                        </div>
                      ))
                    ) : (
                      <small>{t.noGrants}</small>
                    )}
                  </article>
                </div>
              )}
              {view === "settings" && (
                <div className="page-content">
                  <p className="callout">{t.organizationIsolation}</p>
                  <SettingsForm
                    organizationId={organizationId}
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
              <aside className="inspector" aria-label={t.selectRecord}>
                <div className="inspector-heading">
                  <span className="eyebrow">{t.relationships}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t.scheduleAction}
                    onClick={() => setActionDialog(true)}
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t.closeInspector}
                    onClick={() => {
                      setSelected("");
                      setSelectedAction("");
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
                {!context ? (
                  <p className="muted">{t.loading}</p>
                ) : (
                  <>
                    <div className="profile">
                      <span className="profile-avatar">
                        {initialLetters(context.person?.name ?? "")}
                      </span>
                      <div>
                        <h2>{context.person?.name}</h2>
                        <p>{context.person?.title}</p>
                        <small>
                          {companyFor(context.person?.id ?? "")?.name}
                        </small>
                      </div>
                    </div>
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
                        <p className="coverage-note">{t.sendingUnavailable}</p>
                      </div>
                    )}
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
        <footer className="statusbar">
          <span role="status">
            {notice || (demo ? t.demoDetail : t.brandSub)}
          </span>
          <span>
            {t.brand} · {t.brandSub}
          </span>
        </footer>
      </main>
    </div>
  );
  async function revokeGrant(grantId: string) {
    try {
      await requestJson("/api/grants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId }),
      });
      await refresh();
      setNotice(t.updated);
    } catch (error) {
      setNotice(errorText(error));
    }
  }
}
function SettingsForm({
  organizationId,
  mutate,
  onOrganizations,
}: {
  organizationId: string;
  mutate: (body: object) => Promise<boolean>;
  onOrganizations: () => Promise<void>;
}) {
  return (
    <div className="settings-forms">
      {["organization", ...(organizationId ? ["product"] : [])].map((kind) => (
        <form
          key={kind}
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            if (
              await mutate({
                operation: kind,
                organizationId,
                name: values.get("name"),
              })
            ) {
              form.reset();
              await onOrganizations();
            }
          }}
        >
          <label>
            {kind === "organization" ? t.organizationName : t.productName}
            <input name="name" required maxLength={100} />
          </label>
          <button className="primary" type="submit">
            <Plus size={14} />
            {kind === "organization" ? t.newOrganization : t.newProduct}
          </button>
        </form>
      ))}
    </div>
  );
}
