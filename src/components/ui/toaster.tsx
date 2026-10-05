"use client";
import t from "@crm/i18n/translations/en.json";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "neutral" | "success" | "danger";
export interface Toast {
  id: number;
  title: string;
  tone: ToastTone;
}
export const maxToasts = 3;
export const toastDuration: Record<ToastTone, number> = {
  neutral: 5000,
  success: 4000,
  danger: 8000,
};

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
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
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), toastDuration[tone]),
      );
    },
    [dismiss],
  );
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  return { toasts, notify, dismiss };
}

const icons = { neutral: Info, success: CircleCheck, danger: CircleAlert };

export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <section className="toaster" aria-label={t.notifications}>
      {toasts.map((toast) => {
        const Icon = icons[toast.tone];
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.tone}`}
            role={toast.tone === "danger" ? "alert" : "status"}
          >
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
      })}
    </section>
  );
}
