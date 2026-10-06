"use client";
import { money, totals } from "@crm/core/analytics";
import type { ClientCompanyContext, ClientContext } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Building2, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { dateLabel, label } from "./client-api";
import { useWorkspaceData } from "./crm/crm-context";
import { CompanyFields, PersonFields } from "./records/contact-fields";
import { Pagination, useListPage } from "./records/list-browser";
import { MetadataSection } from "./records/metadata-section";
import { RecordText } from "./records/record-text";

interface WorkProps {
  actions: ClientContext["actions"];
  meetings: ClientContext["meetings"];
  opportunities: ClientContext["opportunities"];
  timeZone: string;
  onAction: (relationshipId: string, actionId: string) => void;
  relationshipId?: string;
  allowOpportunityCreation?: boolean;
  onReveal: (view: "meetings" | "opportunities", id: string) => void;
  selectedAction?: ReactNode;
  selectedActionId?: string;
}
export function RelatedWork({
  actions,
  meetings,
  opportunities,
  timeZone,
  onAction,
  onReveal,
  relationshipId,
  allowOpportunityCreation,
  selectedAction,
  selectedActionId,
}: WorkProps) {
  const crm = useWorkspaceData();
  const [allActions, setAllActions] = useState(false);
  const [allMeetings, setAllMeetings] = useState(false);
  const actionPage = useListPage(
    actions
      .filter(
        (action) =>
          action.status !== "completed" && action.id !== selectedActionId,
      )
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)),
    actions[0]?.relationshipId ?? "",
  );
  const now = Date.parse(crm.sourceData.asOf);
  const meetingPage = useListPage(
    [...meetings].sort((a, b) => {
      const upcomingA =
        a.status === "scheduled" && Date.parse(a.startsAt) >= now;
      const upcomingB =
        b.status === "scheduled" && Date.parse(b.startsAt) >= now;
      if (upcomingA !== upcomingB) return upcomingA ? -1 : 1;
      return upcomingA
        ? Date.parse(a.startsAt) - Date.parse(b.startsAt)
        : Date.parse(b.startsAt) - Date.parse(a.startsAt);
    }),
    meetings[0]?.relationshipId ?? "",
  );
  return (
    <div className="related-work">
      <section>
        <div className="section-heading">
          <h3>{t.actions}</h3>
          {relationshipId && (
            <button
              type="button"
              className="small ghost"
              onClick={() => crm.setActionDialog(true, relationshipId)}
            >
              {t.contactWorkspace.newAction}
            </button>
          )}
        </div>
        {selectedAction}
        {(allActions ? actionPage.items : actionPage.items.slice(0, 3)).map(
          (a) => (
            <button
              type="button"
              className="related-row"
              key={a.id}
              onClick={() => onAction(a.relationshipId, a.id)}
            >
              <span>
                {a.title}
                <small>
                  {label(a.kind)} · {label(a.status)} ·{" "}
                  {dateLabel(a.dueAt, timeZone)}
                </small>
              </span>
              <ChevronRight size={13} />
            </button>
          ),
        )}
        {actionPage.total > 3 && (
          <button
            type="button"
            className="small ghost"
            onClick={() => setAllActions(!allActions)}
          >
            {allActions
              ? t.contactWorkspace.showLess
              : t.contactWorkspace.showAll.replace(
                  "{count}",
                  String(actionPage.total),
                )}
          </button>
        )}
        {allActions && actionPage.total > actionPage.size && (
          <Pagination page={actionPage} />
        )}
        {!actions.some((a) => a.status !== "completed") && !selectedAction && (
          <p className="muted">{t.noActions}</p>
        )}
      </section>
      <section>
        <h3>{t.meetings}</h3>
        {(allMeetings ? meetingPage.items : meetingPage.items.slice(0, 3)).map(
          (m) => (
            <button
              type="button"
              className="related-row"
              key={m.id}
              onClick={() => onReveal("meetings", m.id)}
            >
              <span>
                {m.title}
                <small>
                  {label(m.status)} · {dateLabel(m.startsAt, timeZone)}
                </small>
              </span>
              <ChevronRight size={13} />
            </button>
          ),
        )}
        {meetingPage.total > 3 && (
          <button
            type="button"
            className="small ghost"
            onClick={() => setAllMeetings(!allMeetings)}
          >
            {allMeetings
              ? t.contactWorkspace.showLess
              : t.contactWorkspace.showAll.replace(
                  "{count}",
                  String(meetingPage.total),
                )}
          </button>
        )}
        {allMeetings && meetingPage.total > meetingPage.size && (
          <Pagination page={meetingPage} />
        )}
        {!meetings.length && <p className="muted">{t.noRelatedMeetings}</p>}
      </section>
      <RelatedOpportunities
        opportunities={opportunities}
        onReveal={onReveal}
        relationshipId={relationshipId}
        allowOpportunityCreation={allowOpportunityCreation}
      />
    </div>
  );
}
export function RelatedOpportunities({
  opportunities,
  onReveal,
  className,
  relationshipId,
  allowOpportunityCreation = true,
}: Pick<
  WorkProps,
  "opportunities" | "onReveal" | "relationshipId" | "allowOpportunityCreation"
> & { className?: string }) {
  const crm = useWorkspaceData();
  const [allDeals, setAllDeals] = useState(false);
  const open = opportunities.filter((deal) => deal.status === "open");
  const included = open.filter(
    (deal) => deal.amountMinor !== null && deal.probability !== null,
  );
  const forecast = totals(open, true);
  const page = useListPage(
    opportunities,
    opportunities[0]?.relationshipId ?? "",
  );
  return (
    <section className={className}>
      <div className="section-heading">
        <h3>{t.opportunities}</h3>
        {allowOpportunityCreation && (
          <button
            type="button"
            className="small"
            onClick={() =>
              crm.openRecordDialog({ kind: "opportunity", relationshipId })
            }
          >
            {t.newDeal}
          </button>
        )}
      </div>
      {(allDeals ? page.items : page.items.slice(0, 3)).map((o) => (
        <article className="related-deal" key={o.id}>
          <button
            type="button"
            className="related-row"
            onClick={() =>
              !crm.sourceData.opportunities.some((deal) => deal.id === o.id)
                ? onReveal("opportunities", o.id)
                : crm.openRecordDialog({ kind: "opportunity", id: o.id })
            }
          >
            <span>
              {o.name}
              <small>
                {crm.product(o.productId)?.name} ·{" "}
                {crm.sourceData.stages.find((stage) => stage.id === o.stageId)
                  ?.name ?? label(o.status)}
              </small>
            </span>
            <ChevronRight size={13} />
          </button>
          <MetadataSection entity="opportunity" record={o} compact />
        </article>
      ))}
      {!!included.length && (
        <details className="record-forecast contact-forecast">
          <summary>
            <span>{t.expectedRevenue}</span>
            <strong>
              {forecast.length
                ? forecast
                    .map((row) => money(row.amountMinor, row.currency))
                    .join(" · ")
                : t.forecastUnknown}
            </strong>
          </summary>
          <small>
            {t.forecastCoverage
              .replace("{included}", String(included.length))
              .replace("{total}", String(open.length))}
          </small>
        </details>
      )}
      {page.total > 3 && (
        <button
          type="button"
          className="small ghost"
          onClick={() => setAllDeals(!allDeals)}
        >
          {allDeals
            ? t.contactWorkspace.showLess
            : t.contactWorkspace.showAll.replace("{count}", String(page.total))}
        </button>
      )}
      {allDeals && page.total > page.size && <Pagination page={page} />}
      {!opportunities.length && (
        <p className="muted">{t.noRelatedOpportunities}</p>
      )}
    </section>
  );
}
export function CompanyProfile({
  company,
  recordHeading = false,
}: {
  company: Pick<
    ClientCompanyContext["company"],
    "name" | "domain" | "description"
  >;
  recordHeading?: boolean;
}) {
  return (
    <>
      <div className="profile">
        <span className="profile-avatar">
          <Building2 size={20} />
        </span>
        <div>
          <h2
            tabIndex={recordHeading ? -1 : undefined}
            data-record-heading={recordHeading ? "" : undefined}
          >
            {company.name}
          </h2>
          <p>{company.domain}</p>
        </div>
      </div>
      <RecordText value={company.description || t.companyDescriptionEmpty} />
    </>
  );
}
export function CompanyPeople({
  context,
  onPerson,
}: {
  context: ClientCompanyContext;
  onPerson: (relationshipId: string) => void;
}) {
  const crm = useWorkspaceData();
  const page = useListPage(context.people, context.company.id);
  const relationships = new Map<
    string,
    ClientCompanyContext["relationships"]
  >();
  for (const relationship of context.relationships) {
    const rows = relationships.get(relationship.personId) ?? [];
    rows.push(relationship);
    relationships.set(relationship.personId, rows);
  }
  return (
    <section className="record-section">
      <h3>{t.allPeople}</h3>
      {page.items.map((p) => (
        <div className="company-contact" key={p.id}>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const relationship = relationships.get(p.id)?.[0];
              if (relationship) onPerson(relationship.id);
              else crm.openPersonRecord(p.id);
            }}
          >
            {p.name}
          </button>
          <small>
            {p.title} · {p.email || t.unknown}
          </small>
          <div className="relationship-links">
            {(relationships.get(p.id) ?? []).map((r) => (
              <button
                type="button"
                className="badge"
                key={r.id}
                onClick={() => onPerson(r.id)}
              >
                {
                  context.products.find((product) => product.id === r.productId)
                    ?.name
                }{" "}
                · {label(r.purpose)}
                <ChevronRight size={10} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {page.total > page.size && <Pagination page={page} />}
    </section>
  );
}
export function CompanyDetails({
  context,
  onPerson,
  onAction,
  onReveal,
  timeZone,
}: {
  context: ClientCompanyContext;
  onPerson: (relationshipId: string) => void;
} & Omit<WorkProps, "actions" | "meetings" | "opportunities">) {
  return (
    <>
      <CompanyProfile company={context.company} />
      <CompanyFields company={context.company} />
      <CompanyPeople context={context} onPerson={onPerson} />
      <RelatedWork
        actions={context.actions}
        meetings={context.meetings}
        opportunities={context.opportunities}
        allowOpportunityCreation={!context.company.archivedAt}
        timeZone={timeZone}
        onAction={onAction}
        onReveal={onReveal}
      />
    </>
  );
}
export function PersonDetails({
  context,
  onCompany,
  onPerson,
  includeSummary = true,
}: {
  context: ClientContext;
  onCompany: (companyId: string) => void;
  onPerson: (relationshipId: string) => void;
  includeSummary?: boolean;
}) {
  return (
    <section className="record-section">
      <h3>{t.contactDetails}</h3>
      {context.person && <PersonFields person={context.person} />}
      <div className="contact-links">
        {context.person?.email && (
          <a href={`mailto:${context.person.email}`}>{context.person.email}</a>
        )}
        {context.person?.phone && (
          <a href={`tel:${context.person.phone.replace(/[^+\d]/g, "")}`}>
            {context.person.phone}
          </a>
        )}
        {context.person?.otherEmails.map((email) => (
          <a key={email} href={`mailto:${email}`}>
            {email}
          </a>
        ))}
        {context.person?.linkedinUrl && (
          <a
            href={context.person.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.linkedinProfile}
          </a>
        )}
        {context.company && (
          <button
            type="button"
            className="text-button"
            onClick={() => onCompany(context.company?.id ?? "")}
          >
            {context.company.name}
            <ChevronRight size={12} />
          </button>
        )}
      </div>
      {includeSummary &&
        context.person?.summary &&
        context.person.summary !== context.relationship.context && (
          <RecordText value={context.person.summary} />
        )}
      <h3>{t.otherRelationships}</h3>
      <div className="relationship-links">
        {context.relationships.map((r) => (
          <button
            key={r.id}
            type="button"
            className="badge"
            aria-pressed={r.id === context.relationship.id}
            onClick={() => onPerson(r.id)}
          >
            {context.products.find((p) => p.id === r.productId)?.name} ·{" "}
            {label(r.purpose)}
          </button>
        ))}
      </div>
    </section>
  );
}
