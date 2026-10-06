"use client";
import { parseMoney, weightedAmount } from "@crm/core/analytics";
import { instantFromZonedInput, zonedInputValue } from "@crm/core/calendar";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useState } from "react";
import { label } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { pipelineStages } from "../crm/use-stage-moves";
import { formatMoney, fromMinor, minorStep } from "../money";
import { RecordDialog, text } from "./record-dialog";

type Snapshot = ClientSnapshot;
type Person = Snapshot["people"][number];
type Company = Snapshot["companies"][number];
type Meeting = Snapshot["meetings"][number];
type Opportunity = Snapshot["opportunities"][number];

const failure = ({ ok, error }: { ok: boolean; error?: string }) =>
  ok ? null : (error ?? "");

export function PersonEditDialog({
  person: initialPerson,
  onClose,
}: {
  person: Person;
  onClose: () => void;
}) {
  const [person] = useState(initialPerson);
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
  company: initialCompany,
  onClose,
  onCreated,
}: {
  company?: Company;
  onClose: () => void;
  onCreated?: (company: Company) => void;
}) {
  const [company] = useState(initialCompany);
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
  const product = [
    ...snapshot.products,
    ...(snapshot.archivedProducts ?? []),
  ].find((item) => item.id === relationship?.productId);
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
  meeting: initialMeeting,
  relationshipId,
  onClose,
}: {
  meeting?: Meeting;
  relationshipId?: string;
  onClose: () => void;
}) {
  const [meeting] = useState(initialMeeting);
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
  opportunity: initialOpportunity,
  relationshipId: initialRelationshipId,
  onClose,
}: {
  opportunity?: Opportunity;
  relationshipId?: string;
  onClose: () => void;
}) {
  const [opportunity] = useState(initialOpportunity);
  const crm = useCrm();
  const snapshot = crm.sourceData;
  const [currency, setCurrency] = useState(opportunity?.currency ?? "USD");
  const [relationshipId, setRelationshipId] = useState(
    opportunity?.relationshipId ?? initialRelationshipId ?? "",
  );
  const [pipelineId, setPipeline] = useState("");
  const [stageId, setStage] = useState(opportunity?.stageId ?? "");
  const [amount, setAmount] = useState(
    opportunity ? fromMinor(opportunity.amountMinor, opportunity.currency) : "",
  );
  const [probability, setProbability] = useState(
    opportunity?.probability?.toString() ?? "",
  );
  if (!snapshot) return null;
  const relationship = snapshot.relationships.find(
    (item) => item.id === relationshipId,
  );
  const productId = opportunity?.productId ?? relationship?.productId ?? "";
  const pipelines = snapshot.pipelines.filter((p) => p.productId === productId);
  const pipeline =
    pipelines.find((p) => p.id === pipelineId) ??
    pipelines.find(
      (p) => p.id === snapshot.stages.find((s) => s.id === stageId)?.pipelineId,
    ) ??
    pipelines[0];
  const stages = pipelineStages(snapshot.stages, productId).filter(
    (s) => !s.archivedAt && (!pipeline || s.pipelineId === pipeline.id),
  );
  const stage =
    stages.find((s) => s.id === stageId) ??
    stages.find((s) => s.category === "open");
  const effectiveProbability =
    stage?.category === "won"
      ? "100"
      : stage?.category === "lost"
        ? "0"
        : probability;
  let forecast: number | null = null;
  try {
    if (
      effectiveProbability &&
      Intl.supportedValuesOf("currency").includes(currency) &&
      Number.isInteger(Number(effectiveProbability)) &&
      Number(effectiveProbability) >= 0 &&
      Number(effectiveProbability) <= 100
    )
      forecast = weightedAmount(
        parseMoney(amount, currency),
        Number(effectiveProbability),
      );
  } catch {}
  return (
    <RecordDialog
      title={opportunity ? t.editOpportunity : t.newOpportunity}
      submitLabel={opportunity ? t.save : t.create}
      onClose={onClose}
      onSubmit={async (fields) => {
        let amountMinor: number | null;
        try {
          if (!Intl.supportedValuesOf("currency").includes(currency))
            return t.errors.INVALID_INPUT;
          amountMinor = parseMoney(text(fields, "amount"), currency);
        } catch {
          return t.errors.INVALID_INPUT;
        }
        return failure(
          await crm.send(
            {
              operation: "deal",
              organizationId: crm.organizationId,
              productId,
              id: opportunity?.id,
              version: opportunity?.version,
              relationshipId:
                opportunity?.relationshipId ?? text(fields, "relationshipId"),
              name: text(fields, "name"),
              stageId: stage?.id,
              status: stage?.category,
              ownerId: text(fields, "ownerId"),
              tags: text(fields, "tags")
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
              amountMinor,
              currency,
              probability:
                text(fields, "probability") === ""
                  ? null
                  : Number(text(fields, "probability")),
              expectedCloseDate: text(fields, "expectedCloseDate") || null,
              description: text(fields, "description"),
              lostReason: text(fields, "lostReason"),
            },
            t.opportunitySaved,
            false,
          ),
        );
      }}
    >
      {opportunity ? (
        <p className="muted">
          {relationshipLabel(snapshot, opportunity.relationshipId)}
        </p>
      ) : (
        <RelationshipField
          snapshot={snapshot}
          value={relationshipId}
          onChange={(id) => {
            setRelationshipId(id);
            setPipeline("");
            setStage("");
          }}
        />
      )}
      <label>
        {t.tags}
        <input name="tags" defaultValue={opportunity?.tags.join(", ") ?? ""} />
      </label>
      <label>
        {t.name}
        <input
          data-primary-field
          name="name"
          required
          maxLength={200}
          defaultValue={opportunity?.name ?? ""}
        />
      </label>
      <div className="form-columns">
        <label>
          {t.pipeline}
          <select
            value={pipeline?.id ?? ""}
            onChange={(e) => {
              setPipeline(e.target.value);
              setStage("");
            }}
            required
          >
            {!pipelines.length && (
              <option value="">{t.chooseRelationship}</option>
            )}
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.stage}
          <select
            value={stage?.id ?? ""}
            onChange={(e) => setStage(e.target.value)}
            required
          >
            {!stages.length && <option value="">{t.chooseRelationship}</option>}
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t.owner}
        <select
          key={productId}
          name="ownerId"
          required
          defaultValue={
            opportunity?.ownerId ?? relationship?.ownerId ?? crm.userId
          }
        >
          {snapshot.members
            .filter((m) => m.productIds.includes(productId))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <div className="form-columns">
        <label>
          {t.amount}
          <input
            name="amount"
            type="number"
            min={0}
            step={minorStep(currency)}
            inputMode="decimal"
            aria-describedby="amount-hint"
            placeholder={t.amountPlaceholder}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          {t.currency}
          <input
            name="currency"
            required
            maxLength={3}
            pattern="[A-Za-z]{3}"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
      </div>
      <small id="amount-hint" className="muted field-hint">
        {t.amountHint}
      </small>
      <div className="form-columns">
        <label>
          {t.probability}
          <input
            name="probability"
            type="number"
            min={0}
            max={100}
            step={1}
            value={effectiveProbability}
            readOnly={stage?.category === "won" || stage?.category === "lost"}
            onChange={(e) => setProbability(e.target.value)}
            placeholder={t.unspecified}
          />
        </label>
        <label>
          {t.expectedCloseDate}
          <input
            name="expectedCloseDate"
            type="date"
            defaultValue={opportunity?.expectedCloseDate ?? ""}
          />
        </label>
      </div>
      <div
        className="forecast-preview"
        role="status"
        aria-label={t.expectedRevenue}
      >
        <span>{t.expectedRevenue}</span>
        <strong>
          {forecast === null
            ? t.forecastUnknown
            : formatMoney(forecast, currency)}
        </strong>
        <small>
          {forecast === null ? t.forecastNeedsFields : t.forecastFormula}
        </small>
      </div>
      <label>
        {t.dealDescription}
        <textarea
          name="description"
          rows={3}
          maxLength={10000}
          defaultValue={opportunity?.description ?? ""}
        />
      </label>
      {stage?.category === "lost" && (
        <label>
          {t.lostReason}
          <textarea
            name="lostReason"
            maxLength={2000}
            defaultValue={opportunity?.lostReason ?? ""}
          />
        </label>
      )}
    </RecordDialog>
  );
}
