"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { dateLabel, label } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { useCompanyContext } from "../crm/record-context";
import {
  CompanyPeople,
  CompanyProfile,
  RelatedOpportunities,
} from "../record-details";
import { personPath, sectionPath } from "../routes";
import { EmptyState, LoadingState } from "../ui/states";

interface ActivityItem {
  id: string;
  at: number;
  title: string;
  detail: string;
  open: () => void;
}

export function CompanyRecord({ companyId }: { companyId: string }) {
  const crm = useWorkspaceData();
  const { sourceData, timeZone } = crm;
  const company = sourceData.companies.find((item) => item.id === companyId);
  const { context, missing } = useCompanyContext(company ? companyId : "");
  if (!company || missing)
    return (
      <EmptyState
        title={t.recordUnavailable}
        action={
          <Link className="button" href={sectionPath("companies")}>
            {t.companies}
          </Link>
        }
      />
    );
  const openPerson = (relationshipId: string, actionId = "") => {
    const personId = sourceData.relationships.find(
      (relationship) => relationship.id === relationshipId,
    )?.personId;
    if (personId) crm.go(personPath(personId, { relationshipId, actionId }));
  };
  const activity: ActivityItem[] = context
    ? [
        ...context.actions.map((action) => ({
          id: action.id,
          at: Date.parse(action.dueAt),
          title: action.title,
          detail: `${crm.personFor(action.relationshipId)?.name ?? t.unknown} · ${label(action.kind)} · ${label(action.status)}`,
          open: () => openPerson(action.relationshipId, action.id),
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
  const groups = [
    {
      label: t.upcoming,
      items: activity
        .filter((item) => item.at > now)
        .sort((a, b) => a.at - b.at),
    },
    {
      label: t.past,
      items: activity
        .filter((item) => item.at <= now)
        .sort((a, b) => b.at - a.at),
    },
  ].filter((group) => group.items.length);
  return (
    <div className="record-page" data-record={company.id}>
      <div className="record-attributes">
        <CompanyProfile company={context?.company ?? company} recordHeading />
        {context ? (
          <>
            <CompanyPeople context={context} onPerson={openPerson} />
            <RelatedOpportunities
              className="record-section"
              opportunities={context.opportunities}
              onReveal={crm.reveal}
            />
          </>
        ) : (
          <LoadingState rows={5} />
        )}
      </div>
      <section className="record-timeline" aria-label={t.activity}>
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
                  <li
                    className="timeline-event"
                    key={item.id}
                    data-at={item.at}
                  >
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
      </section>
    </div>
  );
}
