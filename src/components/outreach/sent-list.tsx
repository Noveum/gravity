"use client";
import t from "@crm/i18n/translations/en.json";
import { ExternalLink } from "lucide-react";
import { dateLabel } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { rowKeys } from "../records/peek-keys";
import { personPath } from "../routes";
import { initials } from "../shell/workspace-menu";
import type { QueueTouch } from "./outreach-data";
import { followUpLabel } from "./touch-labels";

const linkPattern = /^https?:\/\//i;

export function SentRow({ touch }: { touch: QueueTouch }) {
  const crm = useCrm();
  const step = followUpLabel(touch.followUp);
  const open = () =>
    crm.go(
      personPath(touch.person.id, { relationshipId: touch.relationshipId }),
    );
  const peek = () => {
    if (!touch.person.archived) crm.openPerson(touch.relationshipId);
  };
  const warnings = touch.sentWarnings
    .map(
      (warning) =>
        t.outreachCopy.warnings[
          warning as keyof typeof t.outreachCopy.warnings
        ],
    )
    .filter(Boolean);
  return (
    <div className="touch-row" data-touch-id={touch.id}>
      <button
        type="button"
        className="action-row"
        data-nav-record={touch.id}
        aria-label={[
          touch.person.name,
          step,
          ...(touch.person.archived ? [t.archivedFlag] : []),
        ].join(", ")}
        aria-keyshortcuts="Space Enter"
        onClick={peek}
        onKeyDown={rowKeys({ peek, open })}
      >
        <span className="row-avatar" aria-hidden>
          {initials(touch.person.name)}
        </span>
        <span className="row-name">{touch.person.name}</span>
        {touch.person.archived && (
          <span className="badge warning">{t.archivedFlag}</span>
        )}
        <span className="row-kind">{step}</span>
        <span className="row-action">{touch.draft}</span>
        {warnings.map((warning) => (
          <span key={warning} className="badge warning">
            {warning}
          </span>
        ))}
        <span className="row-meta">
          {t.sentByOn
            .replace(
              "{name}",
              touch.sentByName ?? crm.member(touch.sentBy ?? ""),
            )
            .replace(
              "{time}",
              touch.sentAt ? dateLabel(touch.sentAt, crm.timeZone) : "",
            )}
        </span>
      </button>
      {touch.externalMessageId && (
        <span className="touch-actions visible">
          {linkPattern.test(touch.externalMessageId) ? (
            <a
              className="icon-button"
              href={touch.externalMessageId}
              target="_blank"
              rel="noreferrer"
              aria-label={`${t.messageLink}: ${touch.person.name}`}
              title={touch.externalMessageId}
            >
              <ExternalLink size={13} aria-hidden />
            </a>
          ) : (
            <span className="badge" title={t.messageLink}>
              {touch.externalMessageId}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
