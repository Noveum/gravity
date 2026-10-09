"use client";
import { productSnapshot } from "@crm/core/client-state";
import type { ClientContext, ClientSnapshot } from "@crm/core/dto";
import { emptySelection, type SelectionState } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { errorText, type Organization, requestJson } from "../client-api";
import {
  actionFilters,
  actionsPath,
  homePath,
  routeFor,
  type Section,
  sectionPath,
} from "../routes";
import { useToasts } from "../ui/toaster";
import { currentViewQuery, replaceViewQuery } from "../view-query";
import { rememberBrand, rememberWorkspace } from "../workspace-preference";
import { DraftBuffersProvider, useDraftBufferActions } from "./draft-buffers";
import { LocalRecordVersions } from "./local-record-versions";
import { isAccessError, useLiveSnapshot } from "./use-live-snapshot";

export type RecordTab =
  | "timeline"
  | "evidence"
  | "draft"
  | "context"
  | "details";
export interface Peek {
  relationshipId: string;
  personId: string;
  companyId: string;
  actionId: string;
  fileId: string;
  fileProductId: string;
}
const noPeek: Peek = {
  relationshipId: "",
  personId: "",
  companyId: "",
  actionId: "",
  fileId: "",
  fileProductId: "",
};
type Snapshot = ClientSnapshot;
type Action = Snapshot["actions"][number];
export interface ActionPlan {
  actionId: string;
  version: number;
  status?: "open" | "completed";
  dueAt?: string;
  ownerId?: string;
}
export type ViewVerb =
  | "touch-sent"
  | "touch-snooze"
  | "touch-skip"
  | "touch-edit"
  | "touch-undo"
  | "move-next"
  | "move-previous"
  | "move-to"
  | "board-layout"
  | "list-layout";
export type ViewVerbs = Partial<Record<ViewVerb, () => boolean>>;
export interface RecordDialogState {
  kind: "person" | "company" | "meeting" | "opportunity";
  id?: string;
  relationshipId?: string;
}
interface Origin {
  path: string;
  focus: string;
  record: string;
}

export interface CrmProps {
  initial: ClientSnapshot | null;
  organizations: Organization[];
  initialOrganizationId: string;
  initialProductId?: string;
  mcpEndpoint?: string;
  userId: string;
  demo: boolean;
}

function useCrmState({
  initial,
  organizations: initialOrganizations,
  initialOrganizationId,
  initialProductId = "",
  mcpEndpoint = "",
  userId,
  demo,
}: CrmProps) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const unfiltered = !query.toString();
  const route = routeFor(pathname);
  const { toasts, notify, dismiss, pause, resume } = useToasts();
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [productId, setProductId] = useState(initialProductId);
  useEffect(() => {
    // Convert existing persistent product cookies to the current browser session.
    rememberBrand(productId);
  }, [productId]);
  const [peekState, setPeekState] = useState(() => {
    const blocked =
      pathname === homePath && unfiltered
        ? initial?.actions.find(
            (action) =>
              action.status === "blocked" &&
              (!initialProductId || action.productId === initialProductId),
          )
        : undefined;
    return {
      ...noPeek,
      path: pathname,
      relationshipId: blocked?.relationshipId ?? "",
      companyId: "",
      actionId: blocked?.id ?? "",
    };
  });
  const [recordHistory, setRecordHistory] = useState<Peek[]>([]);
  const [tab, setTab] = useState<RecordTab>("timeline");
  const [expanded, setExpanded] = useState(false);
  const [searchState, setSearchState] = useState({ path: pathname, text: "" });
  const [personDialog, setPersonDialogState] = useState(false);
  const [recordDialog, setRecordDialog] = useState<RecordDialogState | null>(
    null,
  );
  const [actionDialog, setActionDialogState] = useState({
    open: false,
    relationshipId: "",
  });
  const [selectionState, setSelectionState] = useState({
    path: pathname,
    selection: emptySelection,
  });
  const creator = useRef<(() => boolean) | null>(null);
  const verbs = useRef<ViewVerbs>({});
  const editor = useRef<(() => boolean) | null>(null);
  const origin = useRef<Origin | null>(null);
  const rowFocus = useRef("");
  const [busy, setBusy] = useState(false);
  const mutating = useRef(false);
  const localVersions = useRef(new LocalRecordVersions());
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleFocus = useRef("");
  const draftBuffers = useDraftBufferActions();
  const clearDrafts = draftBuffers.clear;
  const contextCache = useRef(new Map<string, ClientContext>());
  const clearRecords = useCallback(() => {
    setPeekState((current) => ({ ...current, ...noPeek }));
    setRecordHistory([]);
    clearDrafts();
    localVersions.current.clear();
    contextCache.current.clear();
  }, [clearDrafts]);
  const live = useLiveSnapshot({
    initial,
    organizationId,
    notify,
    onAccessLost: clearRecords,
  });
  const { sourceData, setData, refresh, activeOrganization, fetchGeneration } =
    live;
  const data = useMemo(
    () => (sourceData ? productSnapshot(sourceData, productId) : null),
    [sourceData, productId],
  );
  const peek: Peek =
    peekState.path === pathname
      ? {
          personId: peekState.personId,
          fileId: peekState.fileId,
          fileProductId: peekState.fileProductId,
          relationshipId: peekState.relationshipId,
          companyId: peekState.companyId,
          actionId: peekState.actionId,
        }
      : noPeek;
  const search = searchState.path === pathname ? searchState.text : "";
  const selection =
    selectionState.path === pathname
      ? selectionState.selection
      : emptySelection;
  const setSelection = (next: SelectionState) =>
    setSelectionState({ path: pathname, selection: next });
  const setActionDialog = (open: boolean, relationshipId = "") => {
    if (open && !canLeaveEditor()) return;
    setActionDialogState({ open, relationshipId: open ? relationshipId : "" });
  };
  const setPersonDialog = (open: boolean) => {
    if (open && !canLeaveEditor()) return;
    setPersonDialogState(open);
  };
  const setSearch = (text: string) => setSearchState({ path: pathname, text });
  const currentOrg =
    sourceData?.organization?.id === organizationId
      ? sourceData.organization
      : organizations.find((org) => org.id === organizationId);
  const visibleOrganizations = useMemo(
    () =>
      organizations.map((org) =>
        org.id === sourceData?.organization?.id ? sourceData.organization : org,
      ),
    [organizations, sourceData?.organization],
  );
  const timeZone = currentOrg?.timezone || "UTC";

  function canLeaveEditor() {
    const dirty = document.querySelector<HTMLElement>("[data-dirty='true']");
    if (!dirty) return true;
    dirty.querySelector<HTMLElement>("input, textarea, select")?.focus();
    notify(t.inlineEditing.finishEditing, "neutral");
    return false;
  }
  function showPeek(next: Peek, path = pathname) {
    if (
      Object.keys(noPeek).some(
        (key) => next[key as keyof Peek] !== peek[key as keyof Peek],
      ) &&
      !canLeaveEditor()
    )
      return;
    if (path !== peekState.path) setExpanded(false);
    setPeekState({ path, ...next });
  }
  function resetRecordState() {
    setPeekState((current) => ({ ...current, ...noPeek }));
    setRecordHistory([]);
    setExpanded(false);
    setPersonDialog(false);
    setRecordDialog(null);
    setActionDialog(false);
    setSelectionState({ path: "", selection: emptySelection });
  }
  function rememberOrigin(href: string) {
    const record = href.split("?")[0] ?? href;
    const target = routeFor(record);
    if (!target?.recordId) return;
    if (route?.recordId) {
      if (origin.current?.record !== pathname) origin.current = null;
      return;
    }
    const focus =
      document.activeElement instanceof HTMLElement
        ? (document.activeElement
            .closest<HTMLElement>("[data-nav-record]")
            ?.getAttribute("data-nav-record") ?? "")
        : "";
    origin.current = {
      path: `${pathname}${query.toString() ? `?${query}` : ""}`,
      focus,
      record,
    };
  }
  function openRecord(href: string) {
    let url: URL;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      return false;
    }
    if (url.origin !== window.location.origin) return false;
    const target = routeFor(url.pathname);
    if (target?.recordId && target.section === "people") {
      openPersonRecord(
        target.recordId,
        url.searchParams.get("relationship") ?? "",
        url.searchParams.get("action") ?? "",
      );
      return true;
    }
    if (target?.recordId && target.section === "companies") {
      openCompany(target.recordId);
      return true;
    }
    if (url.pathname === "/files" && url.searchParams.get("open")) {
      openFile(
        url.searchParams.get("open") ?? "",
        url.searchParams.get("productId") ?? (peek.fileProductId || productId),
      );
      return true;
    }
    return false;
  }
  const navigation = useRef<(href: string) => void>(() => {});
  function go(href: string) {
    if (!canLeaveEditor()) return;
    if (openRecord(href)) return;
    rememberOrigin(href);
    titleFocus.current = href.split("?")[0] ?? href;
    router.push(href);
  }
  navigation.current = go;
  function leaveRecord() {
    if (!route?.recordId) return false;
    const back =
      origin.current?.record === pathname
        ? origin.current
        : { path: sectionPath(route.section), focus: route.recordId };
    origin.current = null;
    rowFocus.current = back.focus;
    titleFocus.current = back.path.split("?")[0] ?? back.path;
    router.push(back.path);
    return true;
  }
  const registerCreate = useCallback((run: () => boolean) => {
    creator.current = run;
    return () => {
      if (creator.current === run) creator.current = null;
    };
  }, []);
  function create() {
    return creator.current?.() ?? false;
  }
  const registerEdit = useCallback((run: () => boolean) => {
    editor.current = run;
    return () => {
      if (editor.current === run) editor.current = null;
    };
  }, []);
  function edit() {
    return editor.current?.() ?? false;
  }
  const registerVerbs = useCallback((handlers: ViewVerbs) => {
    verbs.current = { ...verbs.current, ...handlers };
    return () => {
      const remaining = { ...verbs.current };
      for (const id of Object.keys(handlers) as ViewVerb[])
        if (remaining[id] === handlers[id]) delete remaining[id];
      verbs.current = remaining;
    };
  }, []);
  function runVerb(id: ViewVerb) {
    return verbs.current[id]?.() ?? false;
  }
  function goToSection(section: Section) {
    go(sectionPath(section));
  }
  function switchOrganization(id: string) {
    if (!canLeaveEditor()) return;
    resetRecordState();
    fetchGeneration.current++;
    draftBuffers.clear();
    localVersions.current.clear();
    contextCache.current.clear();
    setOrganizationId(id);
    setProductId("");
    setData(null);
    live.setLoadFailed(false);
    setSearchState({ path: pathname, text: "" });
    live.revision.current = "";
    const slug = organizations.find((org) => org.id === id)?.slug;
    if (slug) rememberWorkspace(slug);
    if (route?.recordId) router.push(sectionPath(route.section));
    else if (route?.section === "actions" && query.has("owner")) {
      const { kind, waiting } = actionFilters(query);
      router.replace(actionsPath({ kind, waiting }));
    }
  }
  function switchProduct(id: string) {
    if (!canLeaveEditor()) return;
    resetRecordState();
    setProductId(id);
    setSearchState({ path: pathname, text: "" });
    const next = currentViewQuery();
    for (const key of [
      "pipeline",
      "stage",
      "owner",
      "tag",
      "submittedBy",
      "sourceMemberId",
      "attribution",
      "qualification",
      "status",
      "currency",
      "minimum",
      "maximum",
      "size",
      "sort",
      "fieldFilters",
    ])
      next.delete(key);
    replaceViewQuery(next);
  }
  function rememberRecord() {
    if (peek.relationshipId || peek.personId || peek.companyId || peek.fileId)
      setRecordHistory((history) => [...history.slice(-19), peek]);
  }
  function openPerson(relationshipId: string, actionId = "", path = pathname) {
    if (!canLeaveEditor()) return;
    if (
      path === pathname &&
      (relationshipId !== peek.relationshipId ||
        peek.companyId ||
        peek.fileId ||
        peek.personId)
    )
      rememberRecord();
    showPeek({ ...noPeek, relationshipId, actionId }, path);
    const kind = sourceData?.actions.find(
      (action) => action.id === actionId,
    )?.kind;
    setTab(
      actionId && (kind === "reply" || kind === "approval")
        ? "draft"
        : "timeline",
    );
  }
  function openPersonRecord(
    personId: string,
    relationshipId = "",
    actionId = "",
  ) {
    if (!canLeaveEditor()) return;
    const relationships =
      sourceData?.relationships.filter((item) => item.personId === personId) ??
      [];
    const relationship =
      relationships.find((item) => item.id === relationshipId) ??
      relationships.find((item) => item.productId === productId) ??
      relationships[0];
    if (
      relationship &&
      !sourceData?.archived.people.some((person) => person.id === personId)
    )
      openPerson(relationship.id, actionId);
    else {
      if (
        peek.personId !== personId ||
        peek.relationshipId ||
        peek.companyId ||
        peek.fileId
      )
        rememberRecord();
      showPeek({ ...noPeek, personId });
      setTab("timeline");
    }
  }
  function openCompany(companyId: string) {
    if (!canLeaveEditor()) return;
    if (
      peek.companyId !== companyId ||
      peek.relationshipId ||
      peek.personId ||
      peek.fileId
    )
      rememberRecord();
    showPeek({ ...noPeek, companyId });
  }
  function openFile(fileId: string, fileProductId: string) {
    if (!canLeaveEditor()) return;
    if (peek.fileId !== fileId || peek.fileProductId !== fileProductId)
      rememberRecord();
    showPeek({
      ...noPeek,
      fileId,
      fileProductId: fileProductId || sourceData?.products[0]?.id || "",
    });
  }
  function previousRecord() {
    const previous = recordHistory.at(-1);
    if (!previous || !canLeaveEditor()) return;
    setRecordHistory(recordHistory.slice(0, -1));
    showPeek(previous);
    setTab("timeline");
  }
  function closePeek(force = false) {
    if (
      !force &&
      document.querySelector("#record-inspector [data-dirty='true']")
    ) {
      document
        .querySelector<HTMLElement>(
          "#record-inspector [data-dirty='true'] input, #record-inspector [data-dirty='true'] textarea",
        )
        ?.focus();
      notify(t.inlineEditing.finishEditing, "neutral");
      return;
    }
    setRecordDialog(null);
    setPersonDialog(false);
    setActionDialog(false);
    returnFocus.current?.focus();
    setPeekState((current) => ({ ...current, ...noPeek }));
    setRecordHistory([]);
    setExpanded(false);
  }
  function openRecordDialog(next: RecordDialogState) {
    if (!canLeaveEditor()) return false;
    if (next.kind === "person" && next.id) {
      openPersonRecord(next.id);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>("#record-inspector [data-inline-field]")
          ?.focus(),
      );
      return true;
    }
    if (next.kind === "company" && next.id) {
      openCompany(next.id);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>("#record-inspector [data-inline-field]")
          ?.focus(),
      );
      return true;
    }
    setRecordDialog(next);
    return true;
  }
  function reveal(section: "meetings" | "opportunities", id: string) {
    openRecordDialog({
      kind: section === "meetings" ? "meeting" : "opportunity",
      id,
    });
  }
  async function mutate(body: object) {
    return (await send(body)).ok;
  }
  async function planActions(items: ActionPlan[]) {
    const { ok, result } = await send(
      { operation: "plan", organizationId, items },
      false,
    );
    return ok ? (result as Action[]) : null;
  }
  async function send(
    body: object,
    announce: boolean | string = true,
    toastErrors = true,
    endpoint = "/api/crm",
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (mutating.current) {
      if (toastErrors) notify(t.stillSaving, "neutral");
      return { ok: false, error: t.stillSaving };
    }
    mutating.current = true;
    const submittedOrganization = organizationId;
    setBusy(true);
    try {
      const result = await requestJson<unknown>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (activeOrganization.current !== submittedOrganization)
        return { ok: true, result };
      fetchGeneration.current++;
      const changed = body as {
        operation?: string;
        actionId?: string;
        version?: number;
      };
      if (
        typeof changed.version === "number" &&
        [
          "person-update",
          "company",
          "record-metadata",
          "relationship",
        ].includes(changed.operation ?? "")
      ) {
        const record = (
          changed.operation === "record-metadata"
            ? (result as { record: { id: string; version: number } }).record
            : result
        ) as { id: string; version: number };
        localVersions.current.remember(
          submittedOrganization,
          changed.version,
          record,
        );
      }
      if (changed.operation === "plan") {
        const updated = result as Action[];
        for (const action of updated)
          draftBuffers.rebase(action.id, action.version - 1, action.version);
        setData((previous) =>
          previous
            ? {
                ...previous,
                asOf: new Date().toISOString(),
                actions: previous.actions.map(
                  (item) =>
                    updated.find((action) => action.id === item.id) ?? item,
                ),
              }
            : previous,
        );
      }
      if (changed.operation)
        setData((previous) =>
          previous
            ? patchRecords(previous, changed.operation ?? "", result)
            : previous,
        );
      if (["action", "action-details"].includes(changed.operation ?? "")) {
        const updatedAction = result as Snapshot["actions"][number];
        if (
          changed.operation === "action-details" &&
          typeof changed.version === "number"
        )
          draftBuffers.rebase(
            updatedAction.id,
            changed.version,
            updatedAction.version,
          );
        else draftBuffers.drop(updatedAction.id, changed.actionId ?? "");
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
      void refresh();
      if (announce)
        notify(typeof announce === "string" ? announce : t.updated, "success");
      return { ok: true, result };
    } catch (error) {
      const message = errorText(error, timeZone);
      if (activeOrganization.current === submittedOrganization) {
        if (toastErrors) notify(message, "danger");
        if (isAccessError(error, ["CONFLICT", "FORBIDDEN", "UNAUTHORIZED"]))
          void refresh();
      }
      return { ok: false, error: message };
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
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
  async function reloadOrganizations() {
    const next = await requestJson<Organization[]>(
      "/api/crm?operation=organizations",
    );
    setOrganizations(next);
    return next;
  }
  const lookup = useMemo(
    () => ({
      people: new Map(
        sourceData?.people.map((person) => [person.id, person]) ?? [],
      ),
      companies: new Map(
        sourceData?.companies.map((company) => [company.id, company]) ?? [],
      ),
      relationships: new Map(
        sourceData?.relationships.map((relationship) => [
          relationship.id,
          relationship,
        ]) ?? [],
      ),
    }),
    [sourceData],
  );
  const product = (id: string) =>
    [
      ...(sourceData?.products ?? []),
      ...(sourceData?.archivedProducts ?? []),
    ].find((item) => item.id === id);
  const member = (id: string) =>
    sourceData?.members.find((item) => item.id === id)?.name ?? t.unknown;
  const personFor = (relationshipId: string) =>
    lookup.people.get(lookup.relationships.get(relationshipId)?.personId ?? "");
  const companyFor = (personId: string) =>
    lookup.companies.get(lookup.people.get(personId)?.companyId ?? "");
  return {
    userId,
    demo,
    mcpEndpoint,
    pathname,
    listFilterKey: ["owner", "kind", "waiting", "pipeline", "stage"]
      .map((key) => query.get(key) ?? "")
      .join("/"),
    route,
    toasts,
    notify,
    dismiss,
    pauseToasts: pause,
    resumeToasts: resume,
    organizations: visibleOrganizations,
    organizationId,
    currentOrg,
    timeZone,
    productId,
    sourceData,
    data,
    loadFailed: live.loadFailed,
    syncState: live.syncState,
    refresh,
    busy,
    mutating,
    mutate,
    send,
    planActions,
    revokeGrant,
    reloadOrganizations,
    switchOrganization,
    switchProduct,
    isAdmin: data?.members.find((m) => m.id === userId)?.role === "admin",
    product,
    member,
    personFor,
    companyFor,
    search,
    setSearch,
    clearSearch: () => setSearchState({ path: "", text: "" }),
    peek,
    recordHistory,
    openPerson,
    openPersonRecord,
    openFile,
    openRecord,
    openCompany,
    previousRecord,
    closePeek,
    tab,
    setTab,
    expanded,
    setExpanded,
    personDialog,
    setPersonDialog,
    recordDialog,
    openRecordDialog,
    closeRecordDialog: () => setRecordDialog(null),
    currentRecord: <T extends { id: string; version: number }>(record: T) =>
      localVersions.current.current(organizationId, record),
    canLeaveEditor,
    actionDialog: actionDialog.open,
    actionDialogRelationship: actionDialog.relationshipId,
    setActionDialog,
    selection,
    setSelection,
    clearSelection: () => setSelection(emptySelection),
    registerCreate,
    create,
    registerEdit,
    edit,
    registerVerbs,
    runVerb,
    leaveRecord,
    rememberOrigin,
    rowFocus,
    focusedRecord: "",
    reveal,
    go: (href: string) => navigation.current(href),
    goToSection,
    titleFocus,
    returnFocus: returnFocus as RefObject<HTMLElement | null>,
    contextCache,
  };
}

export type Crm = ReturnType<typeof useCrmState>;
const CrmContext = createContext<Crm | null>(null);

function CrmState({ children, ...props }: CrmProps & { children: ReactNode }) {
  const crm = useCrmState(props);
  return <CrmContext.Provider value={crm}>{children}</CrmContext.Provider>;
}

export function CrmProvider({
  children,
  ...props
}: CrmProps & { children: ReactNode }) {
  return (
    <DraftBuffersProvider>
      <CrmState {...props}>{children}</CrmState>
    </DraftBuffersProvider>
  );
}

export function useCrm() {
  const crm = useContext(CrmContext);
  if (!crm) throw new Error("CRM_PROVIDER_MISSING");
  return crm;
}

export function useCreate(run: () => boolean) {
  const { registerCreate } = useCrm();
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => registerCreate(() => latest.current()), [registerCreate]);
}

export function usePruneSelection(visible: string[]) {
  const { selection, setSelection } = useCrm();
  const key = visible.join(" ");
  const hidden = selection.selected.some((id) => !visible.includes(id));
  useEffect(() => {
    if (!hidden) return;
    const shown = new Set(key.split(" "));
    setSelection({
      selected: selection.selected.filter((id) => shown.has(id)),
      anchor: shown.has(selection.anchor) ? selection.anchor : "",
      base: selection.base.filter((id) => shown.has(id)),
    });
  }, [hidden, key, selection, setSelection]);
}

export function useVerbs(handlers: ViewVerbs) {
  const { registerVerbs } = useCrm();
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const ids = Object.keys(latest.current) as ViewVerb[];
    return registerVerbs(
      Object.fromEntries(
        ids.map((id) => [id, () => latest.current[id]?.() ?? false]),
      ),
    );
  }, [registerVerbs]);
}

export function useEdit(run: () => boolean) {
  const { registerEdit } = useCrm();
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => registerEdit(() => latest.current()), [registerEdit]);
}

function upsert<T extends { id: string }>(rows: T[], row: T) {
  return rows.some((item) => item.id === row.id)
    ? rows.map((item) => (item.id === row.id ? row : item))
    : [...rows, row];
}

export function patchRecords(
  snapshot: Snapshot,
  operation: string,
  result: unknown,
): Snapshot {
  if (operation === "record-metadata") {
    const updated = result as {
      entity: "person" | "company" | "relationship" | "opportunity";
      record: { id: string };
    };
    const key = {
      person: "people",
      company: "companies",
      relationship: "relationships",
      opportunity: "opportunities",
    } as const;
    const collection = key[updated.entity];
    return {
      ...snapshot,
      asOf: new Date().toISOString(),
      [collection]: snapshot[collection].map((row) =>
        row.id === updated.record.id ? updated.record : row,
      ),
    };
  }
  if (operation === "person-update")
    return {
      ...snapshot,
      people: snapshot.people.map((person) =>
        person.id === (result as Snapshot["people"][number]).id
          ? (result as Snapshot["people"][number])
          : person,
      ),
    };
  if (operation === "company")
    return {
      ...snapshot,
      companies: upsert(
        snapshot.companies,
        result as Snapshot["companies"][number],
      ),
    };
  if (operation === "meeting")
    return {
      ...snapshot,
      meetings: upsert(
        snapshot.meetings,
        result as Snapshot["meetings"][number],
      ),
    };
  if (
    operation === "opportunity-delete" ||
    operation === "opportunity-restore"
  ) {
    const deal = result as Snapshot["opportunities"][number];
    return {
      ...snapshot,
      opportunities: deal.archivedAt
        ? snapshot.opportunities.filter((row) => row.id !== deal.id)
        : upsert(snapshot.opportunities, deal),
      archivedOpportunities: deal.archivedAt
        ? upsert(snapshot.archivedOpportunities ?? [], deal)
        : (snapshot.archivedOpportunities ?? []).filter(
            (row) => row.id !== deal.id,
          ),
    };
  }
  if (
    operation === "deal" ||
    operation === "opportunity" ||
    operation === "opportunity-change"
  )
    return {
      ...snapshot,
      opportunities: upsert(
        snapshot.opportunities,
        result as Snapshot["opportunities"][number],
      ),
    };
  return snapshot;
}

export function useWorkspaceData() {
  const crm = useCrm();
  if (!crm.data || !crm.sourceData) throw new Error("WORKSPACE_DATA_MISSING");
  return { ...crm, data: crm.data, sourceData: crm.sourceData };
}
