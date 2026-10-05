"use client";
import { instantFromZonedInput, zonedInputValue } from "@crm/core/calendar";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useState } from "react";
import { label } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { pipelineStages } from "../crm/use-stage-moves";
import { fromMinor, minorStep, toMinor } from "../money";
import { RecordDialog, text } from "./record-dialog";

type Snapshot = ClientSnapshot;
type Person = Snapshot["people"][number];
type Company = Snapshot["companies"][number];
type Meeting = Snapshot["meetings"][number];
type Opportunity = Snapshot["opportunities"][number];

const failure = ({ ok, error }: { ok: boolean; error?: string }) =>
  ok ? null : (error ?? "");

export function PersonEditDialog({
  person,
  onClose,
}: {
  person: Person;
  onClose: () => void;
}) {
  const crm = useCrm();
  const companies = crm.sourceData?.companies ?? [];
  const archivedCompany = crm.sourceData?.archived.companies.find(
    (company) =>
      company.id === person.companyId &&
      !companies.some((item) => item.id === company.id),
  );
  const currentCompany = person.companyId ?? "";
  return (
    <RecordDialog
      title={t.editPerson}
      submitLabel={t.save}
      onClose={onClose}
      onSubmit={async (fields) =>
        failure(
          await crm.send(
            {
              operation: "person-update",
              organizationId: crm.organizationId,
              personId: person.id,
              version: person.version,
              name: text(fields, "name"),
              title: text(fields, "title"),
              email: text(fields, "email") || null,
              otherEmails: text(fields, "otherEmails")
                .split(/[\s,]+/)
                .filter(Boolean),
              phone: text(fields, "phone"),
              linkedinUrl: text(fields, "linkedinUrl"),
              ...(text(fields, "companyId") !== currentCompany
                ? { companyId: text(fields, "companyId") || null }
                : {}),
              summary: text(fields, "summary"),
            },
            t.personSaved,
            false,
          ),
        )
      }
    >
      <label>
        {t.name}
        <input
          data-primary-field
          name="name"
          required
          maxLength={100}
          defaultValue={person.name}
        />
      </label>
      <label>
        {t.roleTitle}
        <input name="title" maxLength={150} defaultValue={person.title} />
      </label>
      <label>
        {t.email}
        <input
          name="email"
          type="email"
          maxLength={254}
          defaultValue={person.email ?? ""}
        />
      </label>
      <label>
        {t.otherEmails}
        <textarea
          name="otherEmails"
          rows={2}
          aria-describedby="other-emails-hint"
          defaultValue={person.otherEmails.join("\n")}
        />
      </label>
      <small id="other-emails-hint" className="muted field-hint">
        {t.otherEmailsHint}
      </small>
      <label>
        {t.phone}
        <input
          name="phone"
          type="tel"
          maxLength={40}
          defaultValue={person.phone}
        />
      </label>
      <label>
        {t.linkedinUrl}
        <input
          name="linkedinUrl"
          type="url"
          maxLength={300}
          placeholder={t.linkedinPlaceholder}
          defaultValue={person.linkedinUrl}
        />
      </label>
      <label>
        {t.company}
        <select name="companyId" defaultValue={person.companyId ?? ""}>
          <option value="">{t.noCompany}</option>
          {archivedCompany && (
            <option value={archivedCompany.id}>
              {`${archivedCompany.name} ${t.archivedSuffix}`}
            </option>
          )}
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.summary}
        <textarea
          name="summary"
          rows={3}
          maxLength={10000}
          defaultValue={person.summary}
        />
      </label>
    </RecordDialog>
  );
}

export function CompanyDialog({
  company,
  onClose,
  onCreated,
}: {
  company?: Company;
  onClose: () => void;
  onCreated?: (company: Company) => void;
}) {
  const crm = useCrm();
  return (
    <RecordDialog
      title={company ? t.editCompany : t.newCompany}
      submitLabel={company ? t.save : t.create}
      onClose={onClose}
      onSubmit={async (fields) => {
        const sent = await crm.send(
          {
            operation: "company",
            organizationId: crm.organizationId,
            ...(company
              ? { companyId: company.id, version: company.version }
              : {}),
            name: text(fields, "name"),
            domain: text(fields, "domain"),
            description: text(fields, "description"),
          },
          company ? t.companySaved : t.companyCreated,
          false,
        );
        if (sent.ok && !company) onCreated?.(sent.result as Company);
        return failure(sent);
      }}
    >
      <label>
        {t.name}
        <input
          data-primary-field
          name="name"
          required
          maxLength={100}
          defaultValue={company?.name ?? ""}
        />
      </label>
      <label>
        {t.domain}
        <input
          name="domain"
          maxLength={253}
          placeholder={t.domainHint}
          defaultValue={company?.domain ?? ""}
        />
      </label>
      <label>
        {t.description}
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={company?.description ?? ""}
        />
      </label>
    </RecordDialog>
  );
}

function relationshipLabel(snapshot: Snapshot, relationshipId: string) {
  const relationship = snapshot.relationships.find(
    (item) => item.id === relationshipId,
  );
  const person = snapshot.people.find(
    (item) => item.id === relationship?.personId,
  );
  const product = snapshot.products.find(
    (item) => item.id === relationship?.productId,
  );
  return `${person?.name ?? t.unknown} · ${product?.name ?? ""}`;
}

function RelationshipField({
  snapshot,
  value,
  onChange,
}: {
  snapshot: Snapshot;
  value?: string;
  onChange?: (relationshipId: string) => void;
}) {
  return (
    <label>
      {t.person}
      <select
        data-primary-field
        name="relationshipId"
        required
        defaultValue={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
      >
        <option value="">{t.choosePerson}</option>
        {snapshot.relationships.map((relationship) => (
          <option key={relationship.id} value={relationship.id}>
            {relationshipLabel(snapshot, relationship.id)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MeetingDialog({
  meeting,
  relationshipId,
  onClose,
}: {
  meeting?: Meeting;
  relationshipId?: string;
  onClose: () => void;
}) {
  const crm = useCrm();
  const snapshot = crm.data;
  if (!snapshot) return null;
  return (
    <RecordDialog
      title={meeting ? t.editMeeting : t.newMeeting}
      submitLabel={meeting ? t.save : t.create}
      onClose={onClose}
      onSubmit={async (fields) =>
        failure(
          await crm.send(
            {
              operation: "meeting",
              organizationId: crm.organizationId,
              ...(meeting
                ? { meetingId: meeting.id, version: meeting.version }
                : { relationshipId: text(fields, "relationshipId") }),
              title: text(fields, "title"),
              startsAt: instantFromZonedInput(
                text(fields, "startsAt"),
                crm.timeZone,
              ),
              status: text(fields, "status"),
              summary: text(fields, "summary"),
            },
            t.meetingSaved,
            false,
          ),
        )
      }
    >
      {meeting ? (
        <p className="muted">
          {relationshipLabel(snapshot, meeting.relationshipId)}
        </p>
      ) : (
        <RelationshipField
          snapshot={snapshot}
          {...(relationshipId ? { value: relationshipId } : {})}
        />
      )}
      <label>
        {t.meetingTitle}
        <input
          {...(meeting ? { "data-primary-field": "" } : {})}
          name="title"
          required
          maxLength={200}
          defaultValue={meeting?.title ?? ""}
        />
      </label>
      <label>
        {t.startsAt}
        <input
          name="startsAt"
          type="datetime-local"
          required
          defaultValue={
            meeting ? zonedInputValue(meeting.startsAt, crm.timeZone) : ""
          }
        />
      </label>
      <label>
        {t.status}
        <select name="status" defaultValue={meeting?.status ?? "scheduled"}>
          {(["scheduled", "held", "canceled"] as const).map((status) => (
            <option key={status} value={status}>
              {label(status)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.summary}
        <textarea
          name="summary"
          rows={3}
          maxLength={10000}
          defaultValue={meeting?.summary ?? ""}
        />
      </label>
    </RecordDialog>
  );
}

export function OpportunityDialog({
  opportunity,
  onClose,
}: {
  opportunity?: Opportunity;
  onClose: () => void;
}) {
  const crm = useCrm();
  const snapshot = crm.data;
  const [currency, setCurrency] = useState(opportunity?.currency ?? "USD");
  const [relationshipId, setRelationshipId] = useState(
    opportunity?.relationshipId ?? "",
  );
  if (!snapshot) return null;
  const productId =
    opportunity?.productId ??
    snapshot.relationships.find((item) => item.id === relationshipId)
      ?.productId ??
    "";
  const stages = pipelineStages(snapshot.stages, productId);
  return (
    <RecordDialog
      title={opportunity ? t.editOpportunity : t.newOpportunity}
      submitLabel={opportunity ? t.save : t.create}
      onClose={onClose}
      onSubmit={async (fields) =>
        failure(
          await crm.send(
            {
              organizationId: crm.organizationId,
              ...(opportunity
                ? {
                    operation: "opportunity-change",
                    opportunityId: opportunity.id,
                    version: opportunity.version,
                  }
                : {
                    operation: "opportunity",
                    relationshipId: text(fields, "relationshipId"),
                  }),
              name: text(fields, "name"),
              stageId: text(fields, "stageId"),
              amountMinor: toMinor(
                text(fields, "amount"),
                text(fields, "currency") || "USD",
              ),
              currency: text(fields, "currency") || "USD",
            },
            t.opportunitySaved,
            false,
          ),
        )
      }
    >
      {opportunity ? (
        <p className="muted">
          {relationshipLabel(snapshot, opportunity.relationshipId)}
        </p>
      ) : (
        <RelationshipField snapshot={snapshot} onChange={setRelationshipId} />
      )}
      <label>
        {t.name}
        <input
          {...(opportunity ? { "data-primary-field": "" } : {})}
          name="name"
          required
          maxLength={200}
          defaultValue={opportunity?.name ?? ""}
        />
      </label>
      <label>
        {t.stage}
        <select
          key={productId}
          name="stageId"
          required
          defaultValue={opportunity?.stageId ?? stages[0]?.id ?? ""}
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.amount}
        <input
          name="amount"
          type="number"
          min={0}
          step={minorStep(currency)}
          inputMode="decimal"
          aria-describedby="amount-hint"
          defaultValue={
            opportunity
              ? fromMinor(opportunity.amountMinor, opportunity.currency)
              : ""
          }
        />
      </label>
      <small id="amount-hint" className="muted field-hint">
        {t.amountHint}
      </small>
      <label>
        {t.currency}
        <input
          name="currency"
          maxLength={3}
          pattern="[A-Za-z]{3}"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
        />
      </label>
    </RecordDialog>
  );
}
