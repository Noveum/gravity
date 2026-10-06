"use client";
import type { ClientCompanyContext } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { dateLabel, label } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { LoadingState } from "../ui/states";
import { Pagination, useListPage } from "./list-browser";

interface ActivityItem {
  id: string;
  at: number;
  title: string;
  detail: string;
  open: () => void;
}

export function CompanyActivity({
  context,
  className = "record-timeline",
}: {
  context: ClientCompanyContext | null;
  className?: string;
}) {
  const crm = useWorkspaceData();
  const { timeZone } = crm;
  const activity: ActivityItem[] = context
    ? [
        ...context.actions.map((action) => ({
          id: action.id,
          at: Date.parse(action.dueAt),
          title: action.title,
          detail: `${crm.personFor(action.relationshipId)?.name ?? t.unknown} · ${label(action.kind)} · ${label(action.status)}`,
          open: () => crm.openPerson(action.relationshipId, action.id),
        })),
        ...context.meetings.map((meeting) => ({
          id: meeting.id,
          at: Date.parse(meeting.startsAt),
          title: meeting.title,
          detail: `${t.meetings} · ${label(meeting.status)}`,
          open: () => crm.reveal("meetings", meeting.id),
        })),
      ]
    : [];
  const now = Date.now();
  const ordered = [
    ...activity.filter((item) => item.at > now).sort((a, b) => a.at - b.at),
    ...activity.filter((item) => item.at <= now).sort((a, b) => b.at - a.at),
  ];
  const page = useListPage(ordered, context?.company.id ?? "");
  const groups = [
    {
      label: t.upcoming,
      items: page.items.filter((item) => item.at > now),
    },
    {
      label: t.past,
      items: page.items.filter((item) => item.at <= now),
    },
  ].filter((group) => group.items.length);
  return (
    <section className={className} aria-label={t.activity}>
      <h3 className="record-timeline-title">{t.activity}</h3>
      {!context ? (
        <LoadingState rows={4} />
      ) : groups.length ? (
        groups.map((group) => (
          <section
            key={group.label}
            aria-label={group.label}
            className="activity-group"
          >
            <h4 className="group-title">{group.label}</h4>
            <ul className="timeline">
              {group.items.map((item) => (
                <li className="timeline-event" key={item.id} data-at={item.at}>
                  <span className="event-dot" />
                  <div className="event-title">
                    <button
                      type="button"
                      className="text-button"
                      onClick={item.open}
                    >
                      {item.title}
                    </button>
                    <small>
                      {item.detail} ·{" "}
                      {dateLabel(new Date(item.at).toISOString(), timeZone)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="muted">{t.noMessages}</p>
      )}
      {page.total > page.size && <Pagination page={page} />}
    </section>
  );
}
