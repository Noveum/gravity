"use client";
import { productSnapshot } from "@crm/core/client-state";
import type { ClientContext, ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
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
import { rememberBrand, rememberWorkspace } from "../workspace-preference";
import { DraftBuffersProvider, useDraftBufferActions } from "./draft-buffers";
import { isAccessError, useLiveSnapshot } from "./use-live-snapshot";

export type RecordTab = "timeline" | "evidence" | "draft";
export interface Peek {
  relationshipId: string;
  companyId: string;
  actionId: string;
}
const noPeek: Peek = { relationshipId: "", companyId: "", actionId: "" };
type Snapshot = ClientSnapshot;

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
  const [personDialog, setPersonDialog] = useState(false);
  const [actionDialog, setActionDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focusedRecord, setFocusedRecord] = useState({ path: "", id: "" });
  const mutating = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleFocus = useRef("");
  const draftBuffers = useDraftBufferActions();
  const clearDrafts = draftBuffers.clear;
  const contextCache = useRef(new Map<string, ClientContext>());
  const clearRecords = useCallback(() => {
    setPeekState((current) => ({ ...current, ...noPeek }));
    setRecordHistory([]);
    clearDrafts();
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
          relationshipId: peekState.relationshipId,
          companyId: peekState.companyId,
          actionId: peekState.actionId,
        }
      : noPeek;
  const search = searchState.path === pathname ? searchState.text : "";
  const setSearch = (text: string) => setSearchState({ path: pathname, text });
  const currentOrg = organizations.find((org) => org.id === organizationId);
  const timeZone = currentOrg?.timezone || "UTC";

  function showPeek(next: Peek, path = pathname) {
    if (path !== peekState.path) setExpanded(false);
    setPeekState({ path, ...next });
  }
  function resetRecordState() {
    setPeekState((current) => ({ ...current, ...noPeek }));
    setRecordHistory([]);
    setExpanded(false);
    setPersonDialog(false);
    setActionDialog(false);
  }
  function go(href: string) {
    titleFocus.current = href.split("?")[0] ?? href;
    router.push(href);
  }
  function goToSection(section: Section) {
    go(sectionPath(section));
  }
  function switchOrganization(id: string) {
    resetRecordState();
    fetchGeneration.current++;
    draftBuffers.clear();
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
    resetRecordState();
    setProductId(id);
    rememberBrand(id);
  }
  function rememberRecord() {
    if (peek.relationshipId || peek.companyId)
      setRecordHistory((history) => [...history.slice(-19), peek]);
  }
  function openPerson(relationshipId: string, actionId = "", path = pathname) {
    const relationship = sourceData?.relationships.find(
      (item) => item.id === relationshipId,
    );
    if (productId && relationship && relationship.productId !== productId)
      switchProduct(relationship.productId);
    else if (
      path === pathname &&
      (relationshipId !== peek.relationshipId || peek.companyId)
    )
      rememberRecord();
    showPeek({ relationshipId, companyId: "", actionId }, path);
    const kind = sourceData?.actions.find(
      (action) => action.id === actionId,
    )?.kind;
    setTab(
      actionId && (kind === "reply" || kind === "approval")
        ? "draft"
        : "timeline",
    );
  }
  function openCompany(companyId: string) {
    rememberRecord();
    showPeek({ relationshipId: "", companyId, actionId: "" });
  }
  function previousRecord() {
    const previous = recordHistory.at(-1);
    if (!previous) return;
    setRecordHistory(recordHistory.slice(0, -1));
    showPeek(previous);
    setTab("timeline");
  }
  function closePeek() {
    returnFocus.current?.focus();
    setPeekState((current) => ({ ...current, ...noPeek }));
    setRecordHistory([]);
    setExpanded(false);
  }
  function reveal(section: "meetings" | "opportunities", id: string) {
    const path = sectionPath(section);
    setFocusedRecord({ path, id });
    router.push(path);
  }
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
      fetchGeneration.current++;
      const changed = body as { operation?: string; actionId?: string };
      if (changed.operation === "action") {
        const updatedAction = result as Snapshot["actions"][number];
        draftBuffers.drop(updatedAction.id, changed.actionId ?? "");
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
      notify(t.updated, "success");
      return true;
    } catch (error) {
      if (activeOrganization.current === submittedOrganization) {
        notify(errorText(error), "danger");
        if (isAccessError(error, ["CONFLICT", "FORBIDDEN", "UNAUTHORIZED"]))
          void refresh();
      }
      return false;
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
  const product = (id: string) =>
    sourceData?.products.find((item) => item.id === id);
  const member = (id: string) =>
    sourceData?.members.find((item) => item.id === id)?.name ?? t.unknown;
  const personFor = (relationshipId: string) =>
    sourceData?.people.find(
      (person) =>
        person.id ===
        sourceData.relationships.find((r) => r.id === relationshipId)?.personId,
    );
  const companyFor = (personId: string) =>
    sourceData?.companies.find(
      (company) =>
        company.id ===
        sourceData.people.find((person) => person.id === personId)?.companyId,
    );
  return {
    userId,
    demo,
    mcpEndpoint,
    pathname,
    route,
    toasts,
    notify,
    dismiss,
    pauseToasts: pause,
    resumeToasts: resume,
    organizations,
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
    openCompany,
    previousRecord,
    closePeek,
    tab,
    setTab,
    expanded,
    setExpanded,
    personDialog,
    setPersonDialog,
    actionDialog,
    setActionDialog,
    focusedRecord: focusedRecord.path === pathname ? focusedRecord.id : "",
    reveal,
    go,
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

export function useWorkspaceData() {
  const crm = useCrm();
  if (!crm.data || !crm.sourceData) throw new Error("WORKSPACE_DATA_MISSING");
  return { ...crm, data: crm.data, sourceData: crm.sourceData };
}
