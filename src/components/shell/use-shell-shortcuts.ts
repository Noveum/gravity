"use client";
import {
  extendSelection,
  type Movement,
  toggleSelection,
} from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import type { RefObject } from "react";
import { toggleTheme } from "../appearance";
import { type RecordTab, useCrm } from "../crm/crm-context";
import type { useActionVerbs } from "../crm/use-action-verbs";
import { useStageMoves } from "../crm/use-stage-moves";
import {
  type DispatchedShortcut,
  focusedRecord,
  focusRecord,
  isEditable,
  navigableRecords,
  useKeyboardNavigation,
} from "../keyboard-navigation";
import { outreachTabFor, type Section } from "../routes";

import { shellShortcutScopes } from "./shortcut-context";

export interface ShellShortcutOptions {
  searchInput: RefObject<HTMLInputElement | null>;
  drawerOpen: boolean;
  closeDrawer: () => void;
  openDrawer: () => void;
  openPalette: () => void;
  openGuide: () => void;
  toggleSidebar: () => void;
  goToSection: (section: Section) => void;
  showPeek: boolean;
  recordRelationship: string | undefined;
  compact: () => boolean;
  verbs: ReturnType<typeof useActionVerbs>;
  openProductDialog: () => boolean;
}

export function useShellShortcuts({
  searchInput,
  drawerOpen,
  closeDrawer,
  openDrawer,
  openPalette,
  openGuide,
  toggleSidebar,
  goToSection,
  showPeek,
  recordRelationship,
  compact,
  verbs,
  openProductDialog,
}: ShellShortcutOptions) {
  const crm = useCrm();
  const section: Section = crm.route?.section ?? "actions";
  const recordId = crm.route?.recordId ?? "";
  const stageMoves = useStageMoves();
  const outreachTab =
    section === "outreach" ? outreachTabFor(crm.pathname) : null;
  const listFocusAllowed = () =>
    document.activeElement?.classList.contains("view-title") ||
    !document.activeElement?.closest(
      "#record-inspector, .sidebar, .resize-handle, header, .toolbar",
    );
  const move = (command: Movement) => () =>
    listFocusAllowed() && focusRecord(command);
  function toggleSelected() {
    if (section === "outreach") return false;
    const row = focusedRecord();
    const id = row?.getAttribute("data-nav-record");
    if (!id) return false;
    crm.setSelection(toggleSelection(crm.selection, id));
    return true;
  }
  const extend = (command: "next" | "previous") => () => {
    if (section === "outreach") return false;
    const from = focusedRecord()?.getAttribute("data-nav-record");
    if (!from || !focusRecord(command)) return false;
    const to = focusedRecord()?.getAttribute("data-nav-record") ?? from;
    const order = navigableRecords().map(
      (row) => row.getAttribute("data-nav-record") ?? "",
    );
    crm.setSelection(extendSelection(order, crm.selection, from, to));
    return true;
  };
  function backOut() {
    const target = document.activeElement;
    if (drawerOpen) closeDrawer();
    else if (target === searchInput.current) {
      if (crm.search) crm.setSearch("");
      else {
        searchInput.current?.blur();
        document.querySelector<HTMLElement>(".view-title")?.focus();
      }
    } else if (target instanceof HTMLElement && target.closest(".toolbar")) {
      target.blur();
      document.querySelector<HTMLElement>(".view-title")?.focus();
    } else if (isEditable(target)) return false;
    else if (showPeek) crm.closePeek();
    else if (crm.selection.selected.length) crm.clearSelection();
    else return crm.leaveRecord();
    return true;
  }
  function focusTab(tab: RecordTab) {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-inspector-tab="${tab}"]`,
    );
    if (!button) return false;
    crm.setTab(tab);
    button.focus();
    return true;
  }
  const goTo = (view: Section) => () => {
    goToSection(view);
    return true;
  };
  const shortcutHandlers: Record<DispatchedShortcut, () => boolean> = {
    "go-overview": goTo("overview"),
    "go-actions": goTo("actions"),
    "go-meetings": goTo("meetings"),
    "go-outreach": goTo("outreach"),
    "go-sequences": goTo("sequences"),
    "go-people": goTo("people"),
    "go-companies": goTo("companies"),
    "go-opportunities": goTo("opportunities"),
    "go-materials": goTo("materials"),
    "go-integrations": goTo("integrations"),
    "go-assistants": goTo("assistants"),
    "go-settings": goTo("settings"),
    palette: () => {
      openPalette();
      return true;
    },
    help: () => {
      openGuide();
      return true;
    },
    search: () => {
      if (searchInput.current) searchInput.current.focus();
      else openPalette();
      return true;
    },
    create: () => {
      if (section === "settings") return crm.create();
      if (crm.create()) return true;
      if (!crm.data?.products.length) return false;
      crm.setPersonDialog(true);
      return true;
    },
    "create-product": openProductDialog,
    "create-organization": () => {
      crm.go("/onboarding");
      return true;
    },
    schedule: () => {
      if (!crm.data?.relationships.length) return false;
      crm.setActionDialog(true, recordRelationship ?? crm.peek.relationshipId);
      return true;
    },
    sidebar: () => {
      toggleSidebar();
      return true;
    },
    theme: () => {
      toggleTheme();
      return true;
    },
    organization: () => {
      if (compact()) openDrawer();
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>("[data-workspace-trigger]")
          ?.focus(),
      );
      return true;
    },
    product: () => {
      const filter = document.querySelector<HTMLSelectElement>(
        `select[aria-label="${t.product}"]`,
      );
      filter?.focus();
      return !!filter;
    },
    back: backOut,
    next: move("next"),
    previous: move("previous"),
    first: move("first"),
    last: move("last"),
    select: toggleSelected,
    "extend-next": extend("next"),
    "extend-previous": extend("previous"),
    done: verbs.done,
    snooze: verbs.snooze,
    assign: verbs.assign,
    undo: verbs.undo,
    expand: () => {
      crm.setExpanded(!crm.expanded);
      return true;
    },
    "list-focus": () => {
      const peeked = [
        crm.peek.actionId,
        crm.peek.relationshipId,
        crm.peek.companyId,
        crm.personFor(crm.peek.relationshipId)?.id,
      ].filter(Boolean);
      const records = navigableRecords();
      const target = peeked
        .map((id) => records.find((record) => record.dataset.navRecord === id))
        .find(Boolean);
      if (!target) return focusRecord("next");
      target.focus();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    },
    "detail-focus": () => {
      const target = document.querySelector<HTMLButtonElement>(
        "#record-inspector button:not(:disabled)",
      );
      target?.focus();
      return !!target;
    },
    timeline: () => focusTab("timeline"),
    evidence: () => focusTab("evidence"),
    draft: () => focusTab("draft"),
    "previous-record": () => {
      if (!crm.recordHistory.length) return false;
      crm.previousRecord();
      return true;
    },
    edit: () => crm.edit(),
    "move-next": () =>
      outreachTab ? crm.runVerb("move-next") : stageMoves.step("next"),
    "move-previous": () =>
      outreachTab ? crm.runVerb("move-previous") : stageMoves.step("previous"),
    "move-to": () => crm.runVerb("move-to"),
    "touch-sent": () => crm.runVerb("touch-sent"),
    "touch-snooze": () => crm.runVerb("touch-snooze"),
    "touch-skip": () => crm.runVerb("touch-skip"),
    "touch-edit": () => crm.runVerb("touch-edit"),
    "touch-undo": () => crm.runVerb("touch-undo"),
  };
  useKeyboardNavigation(
    (id) => shortcutHandlers[id](),
    () =>
      shellShortcutScopes({
        hasData: !!crm.data,
        section,
        recordId,
        showPeek,
        pathname: crm.pathname,
      }),
  );
}
