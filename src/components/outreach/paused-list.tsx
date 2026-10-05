"use client";
import t from "@crm/i18n/translations/en.json";
import { dateLabel, label } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { rowKeys } from "../records/peek-keys";
import { personPath } from "../routes";
import { initials } from "../shell/workspace-menu";
import type { PausedEnrollment } from "./outreach-data";

export function PausedRow({
  enrollment,
  onResume,
}: {
  enrollment: PausedEnrollment;
  onResume: (enrollment: PausedEnrollment) => void;
}) {
  const crm = useCrm();
  const reason = label(`paused_${enrollment.pauseReason ?? "manual"}`);
  const open = () =>
    crm.go(
      personPath(enrollment.person.id, {
        relationshipId: enrollment.relationshipId,
      }),
    );
  const peek = () => {
    if (!enrollment.person.archived) crm.openPerson(enrollment.relationshipId);
  };
  return (
    <div className="touch-row" data-enrollment-id={enrollment.id}>
      <button
        type="button"
        className="action-row"
        data-nav-record={enrollment.id}
        aria-label={[
          enrollment.person.name,
          reason,
          ...(enrollment.person.archived ? [t.archivedFlag] : []),
        ].join(", ")}
        aria-keyshortcuts="Space Enter"
        onClick={peek}
        onKeyDown={rowKeys({ peek, open })}
      >
        <span className="row-avatar" aria-hidden>
          {initials(enrollment.person.name)}
        </span>
        <span className="row-name">{enrollment.person.name}</span>
        {enrollment.person.archived && (
          <span className="badge warning">{t.archivedFlag}</span>
        )}
        <span className="row-kind">{reason}</span>
        <span className="row-action">{enrollment.sequenceName}</span>
        {enrollment.pauseReason === "reply" && enrollment.lastInboundAt && (
          <span className="row-meta">
            {t.lastReply.replace(
              "{time}",
              dateLabel(enrollment.lastInboundAt, crm.timeZone),
            )}
          </span>
        )}
      </button>
      <span className="touch-actions visible">
        <button
          type="button"
          className="ghost"
          aria-label={`${t.resume}: ${enrollment.person.name}`}
          onClick={() => onResume(enrollment)}
        >
          {t.resume}
        </button>
      </span>
    </div>
  );
}
