"use client";
import t from "@crm/i18n/translations/en.json";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  PanelTop,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useWorkspaceData } from "../crm/crm-context";
import {
  useArchivedPersonContext,
  useCompanyContext,
  usePersonContext,
} from "../crm/record-context";
import { useArchive } from "../crm/use-archive";
import { useDraft } from "../crm/use-draft";
import { FileInspector } from "../files/file-library";
import {
  CompanyPeople,
  CompanyProfile,
  PersonDetails,
  RelatedOpportunities,
  RelatedWork,
} from "../record-details";
import { companyPath, personPath } from "../routes";
import { EmptyState, LoadingState } from "../ui/states";
import { CompanyActivity } from "./company-activity";
import { MetadataSection } from "./metadata-section";
import {
  ActionSummary,
  findAction,
  PersonActivity,
  PersonProfile,
  RelationshipProperties,
} from "./person-panels";
import { ArchivedNotice, RecordActions } from "./record-actions";
import { RecordText } from "./record-text";
import { RelationshipContext } from "./relationship-context";

function PersonPeek() {
  const crm = useWorkspaceData();
  const relationshipId =
    crm.peek.relationshipId ||
    crm.sourceData.relationships.find(
      (item) => item.personId === crm.peek.personId,
    )?.id ||
    "";
  const { context, missing } = usePersonContext(relationshipId);
  const requestedAction = findAction(
    crm.peek.actionId,
    crm.sourceData,
    context,
  );
  const action =
    requestedAction?.relationshipId === relationshipId
      ? requestedAction
      : undefined;
  const draft = useDraft(action);
  const archive = useArchive();
  if (missing) return <EmptyState title={t.recordUnavailable} compact />;
  if (!context) return <LoadingState rows={4} />;
  return (
    <>
      <PersonProfile
        name={context.person?.name ?? ""}
        title={context.person?.title ?? ""}
        company={context.company}
        onCompany={crm.openCompany}
      />
      {context.person && (
        <RecordActions
          busy={crm.busy}
          onEdit={() =>
            crm.openRecordDialog({
              kind: "person",
              id: context.person?.id ?? "",
            })
          }
          onArchive={() => {
            if (context.person) void archive.archive("person", context.person);
          }}
        />
      )}
      <PersonDetails
        context={context}
        onCompany={crm.openCompany}
        onPerson={crm.openPerson}
        includeSummary={false}
      />
      <RelationshipProperties
        context={context}
        action={action}
        includeContext={false}
      />
      {context.person && (
        <MetadataSection entity="person" record={context.person} />
      )}
      <MetadataSection entity="relationship" record={context.relationship} />
      <PersonActivity context={context} action={action} draft={draft} />
      {context.person?.summary &&
        context.person.summary !== context.relationship.context && (
          <section className="record-section" aria-label={t.personNotes}>
            <h3>{t.personNotes}</h3>
            <RecordText value={context.person.summary} />
          </section>
        )}
      <RelationshipContext
        key={context.relationship.id}
        relationship={context.relationship}
      />
      <RelatedWork
        actions={context.actions}
        meetings={context.meetings}
        opportunities={context.opportunities}
        relationshipId={context.relationship.id}
        timeZone={crm.timeZone}
        onAction={crm.openPerson}
        onReveal={crm.reveal}
      />
      {action && <ActionSummary action={action} version={draft.version} />}
    </>
  );
}

function ArchivedPersonPeek() {
  const crm = useWorkspaceData();
  const archive = useArchive();
  const { context, missing } = useArchivedPersonContext(crm.peek.personId);
  if (missing) return <EmptyState title={t.recordUnavailable} compact />;
  if (!context?.person) return <LoadingState rows={4} />;
  return (
    <>
      <PersonProfile
        name={context.person.name}
        title={context.person.title}
        company={context.company}
        onCompany={crm.openCompany}
      />
      <ArchivedNotice
        note={t.archivedPersonNote}
        busy={crm.busy}
        onRestore={() => {
          if (context.person) void archive.restore("person", context.person);
        }}
      />
      <PersonDetails
        context={context}
        onCompany={crm.openCompany}
        onPerson={() => {}}
      />
    </>
  );
}

function PersonWithoutRelationship() {
  const crm = useWorkspaceData();
  const archive = useArchive();
  const person = crm.sourceData.people.find(
    (item) => item.id === crm.peek.personId,
  );
  if (!person) return <EmptyState title={t.recordUnavailable} compact />;
  const company = crm.sourceData.companies.find(
    (item) => item.id === person.companyId,
  );
  return (
    <>
      <PersonProfile
        name={person.name}
        title={person.title}
        company={company}
        onCompany={crm.openCompany}
      />
      <RecordActions
        busy={crm.busy}
        onEdit={() => crm.openRecordDialog({ kind: "person", id: person.id })}
        onArchive={() => void archive.archive("person", person)}
      />
      <section className="record-section">
        <h3>{t.contactDetails}</h3>
        <dl>
          <dt>{t.email}</dt>
          <dd>{person.email || t.unknown}</dd>
          {person.linkedinUrl && (
            <>
              <dt>{t.linkedin}</dt>
              <dd>
                <a href={person.linkedinUrl} target="_blank" rel="noreferrer">
                  {t.linkedinProfile}
                </a>
              </dd>
            </>
          )}
        </dl>
      </section>
      <MetadataSection entity="person" record={person} />
      {person.summary && (
        <section className="record-section" aria-label={t.personNotes}>
          <h3>{t.personNotes}</h3>
          <RecordText value={person.summary} />
        </section>
      )}
    </>
  );
}

function CompanyPeek() {
  const crm = useWorkspaceData();
  const { context, missing } = useCompanyContext(crm.peek.companyId);
  const archive = useArchive();
  if (missing) return <EmptyState title={t.recordUnavailable} compact />;
  if (!context) return <LoadingState rows={4} />;
  return (
    <>
      {context.company.archivedAt ? (
        <ArchivedNotice
          note={t.archivedCompanyNote}
          busy={crm.busy}
          onRestore={() => void archive.restore("company", context.company)}
        />
      ) : (
        <RecordActions
          busy={crm.busy}
          onEdit={() =>
            crm.openRecordDialog({ kind: "company", id: context.company.id })
          }
          onArchive={() => void archive.archive("company", context.company)}
        />
      )}
      <MetadataSection entity="company" record={context.company} />
      <CompanyProfile company={context.company} />
      <CompanyPeople context={context} onPerson={crm.openPerson} />
      <RelatedOpportunities
        className="record-section"
        opportunities={context.opportunities}
        allowOpportunityCreation={!context.company.archivedAt}
        onReveal={crm.reveal}
      />
      <CompanyActivity context={context} className="record-section" />
    </>
  );
}

export function PeekPanel() {
  const crm = useWorkspaceData();
  const { peek, recordHistory, expanded } = crm;
  const personId = crm.sourceData.relationships.find(
    (relationship) => relationship.id === peek.relationshipId,
  )?.personId;
  const recordHref = peek.companyId
    ? companyPath(peek.companyId)
    : personId
      ? personPath(personId, {
          relationshipId: peek.relationshipId,
          actionId: peek.actionId,
        })
      : "";
  return (
    <aside
      id="record-inspector"
      className="inspector"
      aria-label={t.recordDetails}
    >
      <div className="inspector-heading">
        <span className="eyebrow">
          {peek.fileId
            ? t.files.title
            : peek.companyId
              ? t.companyDetails
              : t.relationships}
        </span>
        <div className="inspector-controls">
          {!!recordHistory.length && (
            <button
              type="button"
              className="icon-button"
              aria-label={t.backToRecord}
              title={`${t.backToRecord} (B)`}
              aria-keyshortcuts="B"
              onClick={crm.previousRecord}
            >
              <ArrowLeft size={15} />
            </button>
          )}
          {!peek.companyId && !peek.fileId && !peek.personId && (
            <button
              type="button"
              className="icon-button"
              aria-label={t.scheduleAction}
              title={`${t.scheduleAction} (N)`}
              aria-keyshortcuts="N"
              onClick={() => crm.setActionDialog(true)}
            >
              <Plus size={15} />
            </button>
          )}
          {recordHref && (
            <Link
              href={recordHref}
              className="button icon-button"
              aria-label={t.openRecord}
              title={t.openRecord}
              onClick={() => {
                crm.titleFocus.current = recordHref.split("?")[0] ?? "";
              }}
            >
              <PanelTop size={15} aria-hidden />
            </Link>
          )}
          <button
            type="button"
            className="icon-button expand-control"
            aria-label={expanded ? t.collapseInspector : t.expandInspector}
            title={`${expanded ? t.collapseInspector : t.expandInspector} (E)`}
            aria-keyshortcuts="E"
            onClick={() => crm.setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t.closeInspector}
            title={`${t.closeInspector} (Esc)`}
            aria-keyshortcuts="Escape"
            onClick={crm.closePeek}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {peek.fileId ? (
        <FileInspector
          key={`${crm.organizationId}/${peek.fileProductId}/${peek.fileId}`}
          fileId={peek.fileId}
          productId={peek.fileProductId}
        />
      ) : peek.companyId ? (
        <CompanyPeek />
      ) : peek.personId ? (
        crm.sourceData.archived.people.some(
          (item) => item.id === peek.personId,
        ) ? (
          <ArchivedPersonPeek />
        ) : crm.sourceData.relationships.some(
            (item) => item.personId === peek.personId,
          ) ? (
          <PersonPeek />
        ) : (
          <PersonWithoutRelationship />
        )
      ) : (
        <PersonPeek />
      )}
    </aside>
  );
}
