"use client";
import { bindingLabel, type ShortcutId, shortcut } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { ActionDialog } from "./action-dialog";
import { setSidebarCollapsed, toggleTheme, useAppearance } from "./appearance";
import { label } from "./client-api";
import { Commands } from "./commands";
import { type CrmProps, CrmProvider, useCrm } from "./crm/crm-context";
import { useActionVerbs } from "./crm/use-action-verbs";
import { focusedRecord, navigableRecords } from "./keyboard-navigation";
import { EnrollDialog } from "./outreach/enroll-dialog";
import { ResizeHandle, usePanelLayout } from "./panel-layout";
import { PersonDialog } from "./person-dialog";
import { PeekPanel } from "./records/peek-panel";
import { RecordDialogHost } from "./records/record-dialog-host";
import {
  actionFilters,
  actionsPath,
  homePath,
  outreachTabFor,
  type Section,
  sectionPath,
} from "./routes";
import { SettingsForm } from "./settings-form";
import {
  breadcrumbsFor,
  listedViews,
  pinnedViews,
  sectionHint,
  viewIcons,
  viewSections,
} from "./shell/navigation";
import { recordsForPalette } from "./shell/palette-records";
import { Sidebar, type SidebarGroup, type SidebarItem } from "./shell/sidebar";
import { TopBar } from "./shell/top-bar";
import { useShellShortcuts } from "./shell/use-shell-shortcuts";
import { UserMenu } from "./shell/user-menu";
import { ViewToolbar } from "./shell/view-toolbar";
import { WorkspaceMenu } from "./shell/workspace-menu";
import { macPlatform, Shortcuts } from "./shortcuts";
import { EmptyState, ErrorState, LoadingState } from "./ui/states";
import { Toaster } from "./ui/toaster";
import { AssignMenu } from "./views/assign-menu";

const compactQuery = "(max-width: 760px)";
const compactScreen = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia(compactQuery).matches;
const toolbarSections: ReadonlySet<Section> = new Set([
  "actions",
  "people",
  "companies",
  "sequences",
  "meetings",
  "opportunities",
  "materials",
  "outreach",
]);
const savedViews = [
  { id: "reply", name: t.replies, href: actionsPath({ kind: "reply" }) },
  {
    id: "commitment",
    name: t.promises,
    href: actionsPath({ kind: "commitment" }),
  },
  { id: "waiting", name: t.waiting, href: actionsPath({ waiting: true }) },
];

export function CrmApp({
  children,
  ...props
}: CrmProps & { children: ReactNode }) {
  return (
    <CrmProvider {...props}>
      <CrmShell>{children}</CrmShell>
    </CrmProvider>
  );
}

function CrmShell({ children }: { children: ReactNode }) {
  const crm = useCrm();
  const { data, sourceData, route, peek, organizationId } = crm;
  const appearance = useAppearance();
  const panels = usePanelLayout(appearance.sidebarCollapsed);
  const query = useSearchParams();
  const filters = actionFilters(query);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [enrolling, setEnrolling] = useState<readonly string[] | null>(null);
  const paletteFocus = useRef("");
  function openPalette() {
    paletteFocus.current =
      focusedRecord()?.getAttribute("data-nav-record") ?? "";
    setCommandsOpen(true);
  }
  const searchInput = useRef<HTMLInputElement>(null);
  const section: Section = route?.section ?? "actions";
  const recordId = route?.recordId ?? "";
  const { pathname, titleFocus, rowFocus } = crm;
  useEffect(() => {
    if (!titleFocus.current || titleFocus.current !== pathname) return;
    titleFocus.current = "";
    const row = rowFocus.current;
    rowFocus.current = "";
    requestAnimationFrame(() => {
      if (document.querySelector("dialog[open]")) return;
      const target =
        (row &&
          navigableRecords().find(
            (element) => element.getAttribute("data-nav-record") === row,
          )) ||
        document.querySelector<HTMLElement>("[data-record-heading]") ||
        document.querySelector<HTMLElement>(".view-title");
      target?.focus();
      if (row) target?.scrollIntoView({ block: "nearest" });
    });
  }, [pathname, titleFocus, rowFocus]);

  function toggleSidebar() {
    if (compactScreen()) setDrawerOpen((open) => !open);
    else setSidebarCollapsed(!appearance.sidebarCollapsed);
  }
  useEffect(() => {
    if (!drawerOpen || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(compactQuery);
    const widen = () => {
      if (!query.matches) setDrawerOpen(false);
    };
    query.addEventListener("change", widen);
    return () => query.removeEventListener("change", widen);
  }, [drawerOpen]);
  function closeDrawer() {
    flushSync(() => setDrawerOpen(false));
    document.querySelector<HTMLElement>(".drawer-trigger")?.focus();
  }
  function leaveDrawer(href: string) {
    titleFocus.current = href.split("?")[0] ?? href;
    setDrawerOpen(false);
  }
  function goToSection(next: Section) {
    setDrawerOpen(false);
    crm.goToSection(next);
  }
  const showPeek = !!data && (!!peek.relationshipId || !!peek.companyId);
  const personRelationships =
    section === "people" && recordId
      ? (sourceData?.relationships ?? []).filter(
          (relationship) => relationship.personId === recordId,
        )
      : [];
  const recordRelationship = (
    personRelationships.find(
      (relationship) => relationship.id === query.get("relationship"),
    ) ??
    personRelationships.find(
      (relationship) => relationship.productId === crm.productId,
    ) ??
    personRelationships[0]
  )?.id;
  const verbs = useActionVerbs();
  useShellShortcuts({
    searchInput,
    drawerOpen,
    closeDrawer,
    openDrawer: () => setDrawerOpen(true),
    openPalette,
    openGuide: () => setHelpOpen(true),
    toggleSidebar,
    goToSection,
    showPeek,
    recordRelationship,
    compact: compactScreen,
    verbs,
  });

  const [mac] = useState(macPlatform);
  const hint = (id: ShortcutId) =>
    bindingLabel(shortcut(id).bindings[0] ?? "", mac);
  const paletteRecords =
    commandsOpen && sourceData ? recordsForPalette(sourceData, crm.go) : [];
  const assigningProducts = new Set(
    (verbs.assigning?.ids ?? []).map(
      (id) => data?.actions.find((action) => action.id === id)?.productId ?? "",
    ),
  );
  const assignableMembers = (data?.members ?? []).filter((member) =>
    [...assigningProducts].every((id) => member.productIds.includes(id)),
  );
  const assigningOwners = new Set(
    (verbs.assigning?.ids ?? []).map(
      (id) => data?.actions.find((action) => action.id === id)?.ownerId,
    ),
  );
  const assignedOwner =
    assigningOwners.size === 1 ? ([...assigningOwners][0] ?? "") : "";
  const openCount =
    data?.actions.filter((action) => action.status !== "completed").length ?? 0;
  const pageItem = (id: Section): SidebarItem => {
    const href = sectionPath(id);
    return {
      id,
      label: label(id),
      icon: viewIcons[id],
      hint: sectionHint(id),
      href,
      active: section === id,
      onSelect: () => leaveDrawer(href),
    };
  };
  const products = (data?.products ?? []).filter(
    (product) => product.organizationId === organizationId,
  );
  const sidebarGroups: SidebarGroup[] = [
    ...viewSections.map((group) => ({
      id: group.id,
      title: group.title,
      items: group.views.map((id) => ({
        ...pageItem(id),
        ...(id === "actions" ? { count: openCount } : {}),
      })),
    })),
    {
      id: "products",
      title: t.products,
      items: products.length
        ? [
            {
              id: "all-products",
              label: t.allProducts,
              kind: "filter" as const,
              active: !crm.productId,
              onSelect: () => crm.switchProduct(""),
            },
            ...products.map((product) => ({
              id: `product-${product.id}`,
              label: product.name,
              dot: product.color,
              kind: "filter" as const,
              active: crm.productId === product.id,
              onSelect: () => crm.switchProduct(product.id),
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
        kind: "view" as const,
        href: saved.href,
        active:
          pathname === homePath &&
          (saved.id === "waiting"
            ? filters.waiting
            : !filters.waiting && filters.kind === saved.id),
        onSelect: () => leaveDrawer(saved.href),
      })),
    },
  ];
  const recordName = recordId
    ? section === "people"
      ? [
          ...(sourceData?.people ?? []),
          ...(sourceData?.archived.people ?? []),
        ].find((person) => person.id === recordId)?.name
      : [
          ...(sourceData?.companies ?? []),
          ...(sourceData?.archived.companies ?? []),
        ].find((company) => company.id === recordId)?.name
    : peek.companyId
      ? sourceData?.companies.find((company) => company.id === peek.companyId)
          ?.name
      : peek.relationshipId
        ? crm.personFor(peek.relationshipId)?.name
        : undefined;
  const productName = crm.productId
    ? crm.product(crm.productId)?.name
    : undefined;
  const outreachTab = section === "outreach" ? outreachTabFor(pathname) : null;
  const crumbs = breadcrumbsFor({
    view: label(section),
    ...(recordId || outreachTab ? { viewHref: sectionPath(section) } : {}),
    ...(crm.currentOrg ? { workspace: crm.currentOrg.name } : {}),
    ...(productName ? { product: productName } : {}),
    ...(recordName
      ? { record: recordName }
      : outreachTab
        ? { record: t.outreachTabs[outreachTab] }
        : {}),
  });
  return (
    <div
      ref={panels.frame}
      className="app-shell"
      style={
        {
          "--inspector-width": `${panels.inspector}px`,
          "--gravity-sidebar": `${panels.navigation}px`,
        } as CSSProperties
      }
    >
      <Sidebar
        groups={sidebarGroups}
        pinned={pinnedViews.map(pageItem)}
        collapsed={appearance.sidebarCollapsed}
        drawerOpen={drawerOpen}
        onToggleCollapsed={toggleSidebar}
        onCloseDrawer={closeDrawer}
        onSearch={() => {
          setDrawerOpen(false);
          openPalette();
        }}
        workspace={
          <WorkspaceMenu
            organizations={crm.organizations}
            organizationId={organizationId}
            userName={crm.member(crm.userId)}
            userDetail={crm.demo ? t.demo : t.brandSub}
            onSwitch={(id) => {
              setDrawerOpen(false);
              crm.switchOrganization(id);
            }}
          />
        }
        footer={
          <>
            <UserMenu
              name={crm.member(crm.userId)}
              detail={crm.demo ? t.demo : t.brandSub}
              demo={crm.demo}
              onShortcuts={() => {
                setDrawerOpen(false);
                setHelpOpen(true);
              }}
              onNavigate={() => leaveDrawer(sectionPath("settings"))}
              onError={(message) => crm.notify(message, "danger")}
            />
            <div className="sidebar-status" title={t.polling}>
              <span className={`live-status sync-${crm.syncState}`}>
                <span aria-hidden />
              </span>
              <span className="nav-label-text" aria-hidden>
                {label(crm.syncState)}
              </span>
              <span className="sr-only">{label(crm.syncState)}</span>
              {crm.demo && (
                <span
                  className="badge status-badge nav-label-text"
                  title={t.demoDetail}
                >
                  {t.demoMode}
                </span>
              )}
            </div>
          </>
        }
      />
      {!appearance.sidebarCollapsed && (
        <ResizeHandle
          label={t.resizeNavigation}
          hint={t.resizeHint}
          value={panels.navigation}
          min={176}
          max={panels.navigationMax}
          direction={1}
          onChange={panels.resizeNavigation}
          onReset={() => panels.resizeNavigation(232)}
          className="sidebar-resize"
          controls="navigation-panel"
        />
      )}
      {drawerOpen && (
        <div
          className="drawer-overlay"
          aria-hidden
          onPointerDown={closeDrawer}
        />
      )}
      <main className="main" inert={drawerOpen || undefined}>
        <TopBar
          crumbs={crumbs}
          onSearch={openPalette}
          onOpenNavigation={() => setDrawerOpen(true)}
        />
        {data && !recordId && toolbarSections.has(section) && (
          <ViewToolbar
            searchInput={searchInput}
            onEnroll={() => setEnrolling(crm.selection.selected)}
          />
        )}
        {enrolling && (
          <EnrollDialog
            personIds={enrolling}
            onClose={() => setEnrolling(null)}
            onEnrolled={() => {
              setEnrolling(null);
              crm.clearSelection();
            }}
          />
        )}
        {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}
        {commandsOpen && (
          <Commands
            onClose={() => setCommandsOpen(false)}
            records={paletteRecords}
            commands={[
              {
                id: "help",
                title: t.keyboardHelp,
                shortcut: hint("help"),
                run: () => setHelpOpen(true),
              },
              {
                id: "refresh",
                title: t.refresh,
                shortcut: "",
                run: () => void crm.refresh(),
              },
              {
                id: "theme",
                title: t.toggleTheme,
                shortcut: hint("theme"),
                run: toggleTheme,
              },
              {
                id: "sidebar",
                title: t.toggleSidebar,
                shortcut: hint("sidebar"),
                run: toggleSidebar,
              },
              ...listedViews.map((id) => ({
                id,
                title: label(id),
                shortcut: sectionHint(id),
                run: () => goToSection(id),
              })),
              {
                id: "schedule",
                title: t.scheduleAction,
                shortcut: hint("schedule"),
                disabled: !data?.relationships.length,
                run: () =>
                  crm.setActionDialog(
                    true,
                    recordRelationship ?? peek.relationshipId,
                  ),
              },
              {
                id: "enroll",
                title: t.enrollCommand,
                shortcut: "",
                disabled:
                  section !== "people" ||
                  !(crm.selection.selected.length || paletteFocus.current),
                run: () =>
                  setEnrolling(
                    crm.selection.selected.length
                      ? crm.selection.selected
                      : [paletteFocus.current],
                  ),
              },
              {
                id: "person",
                title: t.addPerson,
                shortcut: section === "people" ? hint("create") : "",
                disabled: !data?.products.length,
                run: () => {
                  goToSection("people");
                  crm.setPersonDialog(true);
                },
              },
            ]}
          />
        )}
        {verbs.assigning && data && (
          <AssignMenu
            members={assignableMembers}
            current={assignedOwner}
            anchor={verbs.assigning.anchor}
            onAssign={verbs.assignTo}
            onClose={verbs.closeAssign}
          />
        )}
        {crm.actionDialog && data && (
          <ActionDialog
            data={data}
            organizationId={organizationId}
            productId={crm.productId}
            relationshipId={crm.actionDialogRelationship || peek.relationshipId}
            userId={crm.userId}
            onClose={() => crm.setActionDialog(false)}
            onCreated={async (result) => {
              if (crm.productId && crm.productId !== result.productId)
                crm.switchProduct(result.productId);
              await crm.refresh();
              crm.go(homePath);
              crm.openPerson(result.relationshipId, result.actionId, homePath);
              crm.setTab("timeline");
              crm.clearSearch();
              crm.notify(t.scheduledAction, "success");
            }}
          />
        )}
        <RecordDialogHost />
        {crm.personDialog && data && (
          <PersonDialog
            key={`${organizationId}-${crm.productId}`}
            data={data}
            organizationId={organizationId}
            productId={crm.productId}
            onClose={() => crm.setPersonDialog(false)}
            onCreated={async (result) => {
              if (crm.productId && crm.productId !== result.productId)
                crm.switchProduct(result.productId);
              await crm.refresh();
              crm.openPerson(result.relationshipId);
              crm.setTab("timeline");
              crm.notify(t.updated, "success");
            }}
          />
        )}
        {!data ? (
          <div className="workspace-state">
            {organizationId ? (
              crm.loadFailed ? (
                <ErrorState
                  title={t.viewLoadError}
                  onRetry={() => void crm.refresh()}
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
                mutate={crm.mutate}
                onOrganizations={async () => {
                  const next = await crm.reloadOrganizations();
                  crm.switchOrganization(next[0]?.id ?? "");
                }}
              />
            )}
          </div>
        ) : (
          <div
            className={`workspace-content ${showPeek ? "with-inspector" : ""} ${showPeek && crm.expanded ? "inspector-expanded" : ""}`}
          >
            <section
              id="records-panel"
              className="content"
              aria-label={label(section)}
              onClickCapture={(event) => {
                const target =
                  event.target instanceof Element
                    ? event.target.closest<HTMLElement>("button, a[href]")
                    : null;
                if (target) crm.returnFocus.current = target;
                if (
                  target instanceof HTMLAnchorElement &&
                  target.origin === window.location.origin
                ) {
                  crm.rememberOrigin(target.pathname);
                  titleFocus.current = target.pathname;
                }
              }}
            >
              {!data.products.length && section !== "settings" && (
                <EmptyState
                  title={t.noProductsAvailable}
                  description={
                    crm.isAdmin ? t.setupAddProduct : t.setupAskAccess
                  }
                  action={
                    crm.isAdmin && (
                      <Link
                        className="button primary"
                        href={sectionPath("settings")}
                      >
                        {t.newProduct}
                      </Link>
                    )
                  }
                />
              )}
              {children}
            </section>
            {showPeek && (
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
            {showPeek && <PeekPanel />}
          </div>
        )}
      </main>
      <Toaster
        toasts={crm.toasts}
        onDismiss={crm.dismiss}
        onPause={crm.pauseToasts}
        onResume={crm.resumeToasts}
      />
    </div>
  );
}
