"use client";
import { nextWorkingMorning, snoozeLabel } from "@crm/core/calendar";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { useCrm } from "../crm/crm-context";
import { navigableRecords } from "../keyboard-navigation";
import { type Touch, useOutreachSend } from "./outreach-data";

type Saved = { id: string; version: number; status: string };
export type TouchDialog = { kind: "sent" | "skip"; touch: Touch };
export type TouchDrawer = { touch: Touch; edit: boolean };

const warningText = (warnings: readonly string[]) =>
  warnings
    .map(
      (warning) =>
        t.outreachCopy.warnings[
          warning as keyof typeof t.outreachCopy.warnings
        ],
    )
    .filter(Boolean)
    .join(", ");

function focusRow(id: string, fallback: string) {
  requestAnimationFrame(() => {
    const rows = navigableRecords();
    (
      rows.find((row) => row.dataset.navRecord === id) ??
      rows.find((row) => row.dataset.navRecord === fallback)
    )?.focus();
  });
}

export function useTouchVerbs({
  touches,
  reload,
}: {
  touches: ReadonlyMap<string, Touch>;
  reload: () => Promise<void>;
}) {
  const crm = useCrm();
  const send = useOutreachSend();
  const [dialog, setDialog] = useState<TouchDialog | null>(null);
  const [drawer, setDrawer] = useState<TouchDrawer | null>(null);
  const versions = useRef(new Map<string, number>());
  const lastUndo = useRef<{ toast: number; run: () => void } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const versionOf = (touch: Touch) =>
    Math.max(touch.version, versions.current.get(touch.id) ?? 0);
  function enqueue<T>(task: () => Promise<T>) {
    const next = queue.current.then(task, task);
    queue.current = next.catch(() => undefined);
    return next;
  }
  function neighbourOf(id: string) {
    const order = navigableRecords().map((row) => row.dataset.navRecord ?? "");
    const index = order.indexOf(id);
    return order[index + 1] ?? order[index - 1] ?? "";
  }
  async function run<T>(
    touch: Touch,
    body: object,
    saved: (result: T) => Saved = (result) => result as Saved,
  ) {
    const result = await send<T>({ touchId: touch.id, ...body });
    if (result.ok) versions.current.set(touch.id, saved(result.result).version);
    return result;
  }
  async function settle(touch: Touch) {
    const neighbour = neighbourOf(touch.id);
    await reload();
    focusRow(touch.id, neighbour);
  }
  function remember(toast: number, undo: () => void) {
    lastUndo.current = { toast, run: undo };
  }
  function focused() {
    const id =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>("[data-touch-id]")
            ?.dataset.touchId
        : undefined;
    return id ? touches.get(id) : undefined;
  }
  const onFocused = (verb: (touch: Touch) => void) => () => {
    const touch = focused();
    if (!touch) return false;
    verb(touch);
    return true;
  };
  function approve(touch: Touch) {
    if (touch.status === "approved") {
      crm.notify(t.touchAlreadyApproved, "neutral");
      return;
    }
    void enqueue(async () => {
      const result = await run<Saved>(touch, {
        operation: "approve",
        version: versionOf(touch),
      });
      if (!result.ok) return crm.notify(result.error, "danger");
      crm.notify(
        t.touchApproved.replace("{name}", touch.person.name),
        "success",
      );
      await settle(touch);
    });
  }
  function snooze(touch: Touch) {
    const now = Date.now();
    const morning = nextWorkingMorning(now, crm.timeZone);
    const when = snoozeLabel(morning, now, crm.timeZone);
    if (Date.parse(touch.dueAt) >= morning) {
      crm.notify(t.snoozeNothing.replace("{when}", when), "neutral");
      return;
    }
    void enqueue(async () => {
      const result = await run<Saved>(touch, {
        operation: "snooze",
        version: versionOf(touch),
        dueAt: new Date(morning).toISOString(),
      });
      if (!result.ok) return crm.notify(result.error, "danger");
      const undo = () =>
        void enqueue(async () => {
          lastUndo.current = null;
          const restored = await run<Saved>(touch, {
            operation: "snooze",
            version: versionOf(touch),
            dueAt: touch.dueAt,
          });
          if (!restored.ok) return crm.notify(restored.error, "danger");
          crm.notify(t.verbUndone, "success");
          await settle(touch);
        });
      remember(
        crm.notify(
          t.touchSnoozed
            .replace("{name}", touch.person.name)
            .replace("{when}", when),
          "success",
          { label: t.undo, run: undo },
        ),
        undo,
      );
      await settle(touch);
    });
  }
  async function skip(touch: Touch, reason: string) {
    const result = await enqueue(() =>
      run<Saved>(touch, {
        operation: "skip",
        version: versionOf(touch),
        reason,
      }),
    );
    if (!result.ok) return result.error;
    const undo = () =>
      void enqueue(async () => {
        lastUndo.current = null;
        const reopened = await run<Saved>(touch, {
          operation: "reopen",
          version: versionOf(touch),
        });
        if (!reopened.ok) return crm.notify(reopened.error, "danger");
        crm.notify(t.touchSkipUndone, "success");
        await settle(touch);
      });
    remember(
      crm.notify(
        t.touchSkipped.replace("{name}", touch.person.name),
        "success",
        {
          label: t.undo,
          run: undo,
        },
      ),
      undo,
    );
    setDrawer(null);
    void settle(touch);
    return null;
  }
  async function markSent(touch: Touch, link: string) {
    const result = await enqueue(() =>
      run<{ touch: Saved; warnings: string[] }>(
        touch,
        {
          operation: "sent",
          version: versionOf(touch),
          ...(link ? { externalMessageId: link } : {}),
        },
        (sent) => sent.touch,
      ),
    );
    if (!result.ok) {
      const firstLink = result.details.externalMessageId;
      return result.code === "TOUCH_ALREADY_SENT" && firstLink
        ? `${result.error} ${t.firstReportLink.replace("{link}", String(firstLink))}`
        : result.error;
    }
    const warnings = warningText(result.result.warnings);
    crm.notify(
      (warnings ? t.touchMarkedSentWarnings : t.touchMarkedSent)
        .replace("{name}", touch.person.name)
        .replace("{warnings}", warnings),
      warnings ? "neutral" : "success",
    );
    setDrawer(null);
    void settle(touch);
    return null;
  }
  function undo() {
    const pending = lastUndo.current;
    if (!pending || !crm.toasts.some((toast) => toast.id === pending.toast))
      return false;
    crm.dismiss(pending.toast);
    pending.run();
    return true;
  }
  return {
    dialog,
    drawer,
    closeDialog: () => setDialog(null),
    closeDrawer: () => setDrawer(null),
    peek: (touch: Touch) => setDrawer({ touch, edit: false }),
    edit: (touch: Touch) => setDrawer({ touch, edit: true }),
    approve,
    snooze,
    askSkip: (touch: Touch) => setDialog({ kind: "skip", touch }),
    askSent: (touch: Touch) => setDialog({ kind: "sent", touch }),
    skip,
    markSent,
    versionOf,
    enqueue,
    remember: (touch: Touch, version: number) =>
      versions.current.set(touch.id, version),
    keys: {
      "touch-approve": onFocused(approve),
      "touch-snooze": onFocused(snooze),
      "touch-skip": onFocused((touch) => setDialog({ kind: "skip", touch })),
      "touch-sent": onFocused((touch) => setDialog({ kind: "sent", touch })),
      "touch-edit": onFocused((touch) => setDrawer({ touch, edit: true })),
      "touch-undo": undo,
    },
  };
}
