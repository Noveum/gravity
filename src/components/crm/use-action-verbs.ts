"use client";
import { nextWorkingMorning, snoozeLabel } from "@crm/core/calendar";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { navigableRecords } from "../keyboard-navigation";
import { type ActionPlan, useCrm } from "./crm-context";

type Action = ClientSnapshot["actions"][number];
type Change = Omit<ActionPlan, "actionId" | "version">;
const idle = () => new Promise((resolve) => setTimeout(resolve, 40));

export function countLabel(count: number) {
  return count === 1
    ? t.actionCountOne
    : t.actionCount.replace("{count}", String(count));
}

function focusRow(id: string) {
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(`#records-panel [data-nav-record="${id}"]`)
      ?.focus(),
  );
}

export interface Assigning {
  ids: string[];
  anchor: HTMLElement | null;
}

export function useActionVerbs() {
  const crm = useCrm();
  const [assigning, setAssigning] = useState<Assigning | null>(null);
  const lastUndo = useRef<{ toast: number; run: () => void } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const versions = useRef(new Map<string, number>());
  const versionOf = (id: string, fallback: number) =>
    Math.max(fallback, versions.current.get(id) ?? 0);
  function enqueue(task: () => Promise<unknown>) {
    const next = queue.current.then(task, task);
    queue.current = next.catch(() => undefined);
    return next;
  }
  async function plan(items: ActionPlan[]) {
    while (crm.mutating.current) await idle();
    const updated = await crm.planActions(items);
    for (const action of updated ?? [])
      versions.current.set(action.id, action.version);
    return updated;
  }

  function visibleIds() {
    return navigableRecords()
      .map((row) => row.dataset.actionId ?? "")
      .filter(Boolean);
  }
  function targetIds(): string[] | null {
    const visible = visibleIds();
    const selected = crm.selection.selected.filter((id) =>
      visible.includes(id),
    );
    if (selected.length) return selected;
    if (crm.selection.selected.length) return null;
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>("[data-action-id]")
            ?.dataset.actionId
        : undefined;
    if (focused && visible.includes(focused)) return [focused];
    return visible.includes(crm.peek.actionId) ? [crm.peek.actionId] : [];
  }
  function actionsFor(ids: string[]) {
    return ids
      .map((id) => crm.data?.actions.find((action) => action.id === id))
      .filter((action): action is Action => !!action);
  }
  function neighbourOf(ids: string[]) {
    const order = visibleIds();
    const last = Math.max(...ids.map((id) => order.indexOf(id)));
    return (
      order.slice(last + 1).find((id) => !ids.includes(id)) ??
      order
        .slice(0, last)
        .reverse()
        .find((id) => !ids.includes(id)) ??
      ""
    );
  }
  function apply(
    targets: Action[],
    change: (action: Action) => Change,
    inverse: (action: Action) => Change,
    message: string,
    leaving: boolean,
  ) {
    const ids = targets.map((action) => action.id);
    const neighbour = leaving ? neighbourOf(ids) : "";
    if (crm.selection.selected.length) crm.clearSelection();
    return enqueue(async () => {
      const updated = await plan(
        targets.map((action) => ({
          actionId: action.id,
          version: versionOf(action.id, action.version),
          ...change(action),
        })),
      );
      if (!updated) return false;
      const keep = neighbour || ids[0];
      if (keep) focusRow(keep);
      const undo = () =>
        void enqueue(async () => {
          lastUndo.current = null;
          const restored = await plan(
            targets.map((action) => ({
              actionId: action.id,
              version: versionOf(action.id, action.version),
              ...inverse(action),
            })),
          );
          if (restored) {
            crm.notify(t.verbUndone, "success");
            if (ids[0]) focusRow(ids[0]);
          }
        });
      const toast = crm.notify(message, "success", {
        label: t.undo,
        run: undo,
      });
      lastUndo.current = { toast, run: undo };
      return true;
    });
  }
  function hidden() {
    crm.notify(t.selectionHidden, "neutral");
    return true;
  }
  function done() {
    const ids = targetIds();
    if (!ids) return hidden();
    const targets = actionsFor(ids);
    if (!targets.length) return false;
    const open = targets.filter((action) => action.status !== "blocked");
    if (!open.length) {
      crm.notify(t.errors.REPLY_BLOCKED, "danger");
      return true;
    }
    void apply(
      open,
      () => ({ status: "completed" }),
      () => ({ status: "open" }),
      t.verbDone.replace("{count}", countLabel(open.length)),
      true,
    ).then((applied) => {
      if (applied && open.length < targets.length)
        crm.notify(t.errors.REPLY_BLOCKED, "danger");
    });
    return true;
  }
  function snooze() {
    const ids = targetIds();
    if (!ids) return hidden();
    const targets = actionsFor(ids);
    if (!targets.length) return false;
    const now = Date.now();
    const morning = nextWorkingMorning(now, crm.timeZone);
    const when = snoozeLabel(morning, now, crm.timeZone);
    const moving = targets.filter(
      (action) => Date.parse(action.dueAt) < morning,
    );
    if (!moving.length) {
      crm.notify(t.snoozeNothing.replace("{when}", when), "neutral");
      return true;
    }
    const dueAt = new Date(morning).toISOString();
    void apply(
      moving,
      () => ({ dueAt }),
      (action) => ({ dueAt: action.dueAt }),
      t.verbSnoozed
        .replace("{count}", countLabel(moving.length))
        .replace("{when}", when),
      false,
    );
    return true;
  }
  function assign() {
    const ids = targetIds();
    if (!ids) return hidden();
    if (!actionsFor(ids).length) return false;
    const anchor =
      document.querySelector<HTMLElement>(
        `#records-panel [data-action-id="${ids[0]}"]`,
      ) ?? null;
    setAssigning({ ids, anchor });
    return true;
  }
  function closeAssign() {
    const anchor = assigning?.anchor;
    setAssigning(null);
    if (anchor?.isConnected) anchor.focus();
  }
  function assignTo(ownerId: string) {
    const targets = actionsFor(assigning?.ids ?? []);
    closeAssign();
    const moving = targets.filter((action) => action.ownerId !== ownerId);
    if (!moving.length) return;
    void apply(
      moving,
      () => ({ ownerId }),
      (action) => ({ ownerId: action.ownerId }),
      t.verbAssigned
        .replace("{count}", countLabel(moving.length))
        .replace("{name}", crm.member(ownerId)),
      false,
    );
  }
  function undo() {
    const pending = lastUndo.current;
    if (!pending || !crm.toasts.some((toast) => toast.id === pending.toast))
      return false;
    crm.dismiss(pending.toast);
    pending.run();
    return true;
  }
  return { done, snooze, assign, assigning, assignTo, closeAssign, undo };
}
