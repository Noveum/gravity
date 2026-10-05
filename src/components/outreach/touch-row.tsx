"use client";
import { overdueDay } from "@crm/core/calendar";
import t from "@crm/i18n/translations/en.json";
import type { ReactNode } from "react";
import { dateLabel, label } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { rowKeys } from "../records/peek-keys";
import { initials } from "../shell/workspace-menu";
import { mergeText } from "./merge-fields";
import type { Touch } from "./outreach-data";
import { followUpLabel, gateReason, mergePerson } from "./touch-labels";

export function touchOverdue(touch: Touch, now: number, timeZone: string) {
  return touch.status !== "sent" && overdueDay(touch.dueAt, now, timeZone);
}

export function TouchRow({
  touch,
  now,
  onPeek,
  onOpen,
  actions,
}: {
  touch: Touch;
  now: number;
  onPeek: () => void;
  onOpen: () => void;
  actions?: ReactNode;
}) {
  const crm = useCrm();
  const overdue = touchOverdue(touch, now, crm.timeZone);
  const step = followUpLabel(touch.followUp);
  const gated = touch.status === "approved" && !touch.allowed;
  const product = crm.productId ? undefined : crm.product(touch.productId);
  const reasons = touch.reasons
    .map((reason) => gateReason(reason, crm.timeZone))
    .join(" · ");
  return (
    <div className="touch-row" data-touch-id={touch.id}>
      <button
        type="button"
        className="action-row"
        data-nav-record={touch.id}
        data-touch-id={touch.id}
        aria-label={[touch.person.name, step, ...(overdue ? [t.overdue] : [])]
          .filter(Boolean)
          .join(", ")}
        aria-keyshortcuts="Space Enter E A D S Shift+S"
        onClick={onPeek}
        onKeyDown={rowKeys({ peek: onPeek, open: onOpen })}
      >
        <span className="row-avatar" aria-hidden>
          {initials(touch.person.name)}
        </span>
        <span className="row-name">{touch.person.name}</span>
        <span className="row-kind">{step}</span>
        <span className={`row-action${touch.draft.trim() ? "" : " muted"}`}>
          {(touch.status === "planned"
            ? mergeText(touch.draft, mergePerson(crm, touch.person))
            : touch.draft
          ).trim() || t.emptyDraft}
        </span>
        {overdue && <span className="badge warning">{t.overdue}</span>}
        {gated && touch.sendAfter && (
          <span className="badge warning" title={reasons}>
            {t.sendAfter.replace(
              "{time}",
              dateLabel(touch.sendAfter, crm.timeZone),
            )}
          </span>
        )}
        {gated && !touch.sendAfter && (
          <span className="badge warning">{reasons}</span>
        )}
        <span className="badge">{t.touchStatus[touch.status]}</span>
        <span className="row-meta">
          {product && (
            <span className="row-product">
              <span
                className="product-dot"
                style={{ background: product.color }}
              />
              {product.name}
            </span>
          )}
          <span className="row-kind">{label(touch.channel)}</span>
        </span>
        <span className={`row-due${overdue ? " overdue" : ""}`}>
          {dateLabel(touch.dueAt, crm.timeZone)}
        </span>
      </button>
      {actions && <span className="touch-actions">{actions}</span>}
    </div>
  );
}
