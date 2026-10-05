"use client";
import t from "@crm/i18n/translations/en.json";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type ToastTone = "neutral" | "success" | "danger";
export interface Toast {
  id: number;
  title: string;
  tone: ToastTone;
}
export type Notify = (title: string, tone?: ToastTone) => void;
export const maxToasts = 3;
export const toastDuration: Record<ToastTone, number> = {
  neutral: 5000,
  success: 4000,
  danger: 8000,
};

interface Countdown {
  remaining: number;
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const paused = useRef(false);
  const countdowns = useRef(new Map<number, Countdown>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(countdowns.current.get(id)?.timer);
    countdowns.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const run = useCallback(
    (id: number, countdown: Countdown) => {
      countdown.startedAt = Date.now();
      countdown.timer = setTimeout(() => dismiss(id), countdown.remaining);
    },
    [dismiss],
  );
  const notify = useCallback(
    (title: string, tone: ToastTone = "neutral") => {
      if (!title) return;
      const id = ++next.current;
      setToasts((current) =>
        [
          ...current.filter(
            (toast) => toast.title !== title || toast.tone !== tone,
          ),
          { id, title, tone },
        ].slice(-maxToasts),
      );
      const countdown: Countdown = {
        remaining: toastDuration[tone],
        startedAt: Date.now(),
      };
      countdowns.current.set(id, countdown);
      if (!paused.current) run(id, countdown);
    },
    [run],
  );
  const pause = useCallback(() => {
    if (paused.current) return;
    paused.current = true;
    for (const countdown of countdowns.current.values()) {
      if (countdown.timer === undefined) continue;
      clearTimeout(countdown.timer);
      countdown.timer = undefined;
      countdown.remaining -= Date.now() - countdown.startedAt;
    }
  }, []);
  const resume = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    for (const [id, countdown] of countdowns.current) run(id, countdown);
  }, [run]);
  useEffect(() => {
    const pending = countdowns.current;
    return () => {
      for (const countdown of pending.values()) clearTimeout(countdown.timer);
      pending.clear();
    };
  }, []);
  return { toasts, notify, dismiss, pause, resume };
}

const icons = { neutral: Info, success: CircleCheck, danger: CircleAlert };

function raise(element: HTMLElement) {
  if (typeof element.showPopover !== "function") return;
  if (element.getAttribute("popover") === "manual") element.hidePopover();
  else element.setAttribute("popover", "manual");
  element.showPopover();
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const Icon = icons[toast.tone];
  return (
    <div className={`toast toast-${toast.tone}`}>
      <Icon size={15} aria-hidden className="toast-icon" />
      <span className="toast-title">{toast.title}</span>
      <button
        type="button"
        className="ghost icon-button"
        aria-label={t.dismiss}
        onClick={() => onDismiss(toast.id)}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}

export function Toaster({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const host = useRef<HTMLElement>(null);
  const hovering = useRef(false);
  const focused = useRef(false);
  const latest = toasts.at(-1)?.id;
  const settle = () => {
    if (hovering.current || focused.current) onPause();
    else onResume();
  };
  useLayoutEffect(() => {
    if (host.current) raise(host.current);
  }, []);
  useLayoutEffect(() => {
    if (
      latest !== undefined &&
      host.current &&
      document.querySelector("dialog[open]")
    )
      raise(host.current);
  }, [latest]);
  return (
    <section
      ref={host}
      className="toaster"
      aria-label={t.notifications}
      onPointerEnter={() => {
        hovering.current = true;
        settle();
      }}
      onPointerLeave={() => {
        hovering.current = false;
        settle();
      }}
      onFocus={() => {
        focused.current = true;
        settle();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        focused.current = false;
        settle();
      }}
    >
      <div
        className="toast-lane"
        role="alert"
        aria-live="assertive"
        aria-atomic="false"
      >
        {toasts
          .filter((toast) => toast.tone === "danger")
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
      </div>
      <div
        className="toast-lane"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts
          .filter((toast) => toast.tone !== "danger")
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
      </div>
    </section>
  );
}
