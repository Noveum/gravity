"use client";
import type { ClientCompanyContext, ClientContext } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Building2, ChevronRight } from "lucide-react";
import { dateLabel, label } from "./client-api";

interface WorkProps {
  actions: ClientContext["actions"];
  meetings: ClientContext["meetings"];
  opportunities: ClientContext["opportunities"];
  timeZone: string;
  onAction: (relationshipId: string, actionId: string) => void;
  onReveal: (view: "meetings" | "opportunities", id: string) => void;
}
export function RelatedWork({
  actions,
  meetings,
  opportunities,
  timeZone,
  onAction,
  onReveal,
}: WorkProps) {
  return (
    <div className="related-work">
      <section>
        <h3>{t.actions}</h3>
        {actions
          .filter((a) => a.status !== "completed")
          .map((a) => (
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
          ))}
        {!actions.some((a) => a.status !== "completed") && (
          <p className="muted">{t.noActions}</p>
        )}
      </section>
      <section>
        <h3>{t.meetings}</h3>
        {meetings.map((m) => (
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
        ))}
        {!meetings.length && <p className="muted">{t.noRelatedMeetings}</p>}
      </section>
      <RelatedOpportunities opportunities={opportunities} onReveal={onReveal} />
    </div>
  );
}
export function RelatedOpportunities({
  opportunities,
  onReveal,
}: Pick<WorkProps, "opportunities" | "onReveal">) {
  return (
    <section>
      <h3>{t.opportunities}</h3>
      {opportunities.map((o) => (
        <button
          type="button"
          className="related-row"
          key={o.id}
          onClick={() => onReveal("opportunities", o.id)}
        >
          <span>
            {o.name}
            <small>
              {o.amountMinor === null
                ? t.amountUnknown
                : new Intl.NumberFormat("en", {
                    style: "currency",
                    currency: o.currency,
                  }).format(o.amountMinor / 100)}
            </small>
          </span>
          <ChevronRight size={13} />
        </button>
      ))}
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
  company: ClientCompanyContext["company"];
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
      <p className="context-summary">
        {company.description || t.companyDescriptionEmpty}
      </p>
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
  return (
    <section className="record-section">
      <h3>{t.allPeople}</h3>
      {context.people.map((p) => (
        <div className="company-contact" key={p.id}>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onPerson(
                context.relationships.find((r) => r.personId === p.id)?.id ||
                  "",
              )
            }
          >
            {p.name}
          </button>
          <small>
            {p.title} · {p.email || t.unknown}
          </small>
          <div className="relationship-links">
            {context.relationships
              .filter((r) => r.personId === p.id)
              .map((r) => (
                <button
                  type="button"
                  className="badge"
                  key={r.id}
                  onClick={() => onPerson(r.id)}
                >
                  {
                    context.products.find(
                      (product) => product.id === r.productId,
                    )?.name
                  }{" "}
                  · {label(r.purpose)}
                  <ChevronRight size={10} />
                </button>
              ))}
          </div>
        </div>
      ))}
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
      <CompanyPeople context={context} onPerson={onPerson} />
      <RelatedWork
        actions={context.actions}
        meetings={context.meetings}
        opportunities={context.opportunities}
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
}: {
  context: ClientContext;
  onCompany: (companyId: string) => void;
  onPerson: (relationshipId: string) => void;
}) {
  return (
    <section className="record-section">
      <h3>{t.contactDetails}</h3>
      <dl className="properties">
        <dt>{t.email}</dt>
        <dd>
          {context.person?.email ? (
            <a href={`mailto:${context.person.email}`}>
              {context.person.email}
            </a>
          ) : (
            t.unknown
          )}
        </dd>
        <dt>{t.company}</dt>
        <dd>
          {context.company ? (
            <button
              type="button"
              className="text-button"
              onClick={() => onCompany(context.company?.id || "")}
            >
              {context.company.name}
              <ChevronRight size={12} />
            </button>
          ) : (
            t.companyMissing
          )}
        </dd>
        {context.company?.domain && (
          <>
            <dt>{t.domain}</dt>
            <dd>{context.company.domain}</dd>
          </>
        )}
      </dl>
      {context.person?.summary &&
        context.person.summary !== context.relationship.context && (
          <p className="muted">{context.person.summary}</p>
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
