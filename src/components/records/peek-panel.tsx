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
import { ActionDialog } from "../action-dialog";
import { useWorkspaceData } from "../crm/crm-context";
import {
  useArchivedPersonContext,
  useCompanyContext,
  usePersonContext,
} from "../crm/record-context";
import { useArchive } from "../crm/use-archive";
import { useDraft } from "../crm/use-draft";
import { FileInspector } from "../files/file-library";
import { PersonDialog } from "../person-dialog";
import {
  CompanyPeople,
  CompanyProfile,
  PersonDetails,
  RelatedOpportunities,
} from "../record-details";
import { companyPath, personPath } from "../routes";
import { EmptyState, LoadingState } from "../ui/states";
import { CompanyActivity } from "./company-activity";
import { ContactAttribution } from "./contact-attribution";
import { CompanyFields, PersonFields } from "./contact-fields";
import { ContactWorkspace } from "./contact-workspace";
import { ConversationHistory } from "./conversation-history";
import { MetadataSection } from "./metadata-section";
import { findAction, PersonProfile } from "./person-panels";
import { ArchivedNotice, RecordActions } from "./record-actions";
import { RecordEditorMode } from "./record-dialog";
import { RecordDialogHost } from "./record-dialog-host";

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
      <div className="contact-header">
        <PersonProfile
          person={context.person ?? undefined}
          name={context.person?.name ?? ""}
          title={context.person?.title ?? ""}
          company={context.company}
          onCompany={crm.openCompany}
        />
        {context.person && (
          <RecordActions
            key={context.person.id}
            inlineEditing
            busy={crm.busy}
            onEdit={() =>
              crm.openRecordDialog({
                kind: "person",
                id: context.person?.id ?? "",
              })
            }
            onArchive={() => {
              if (context.person)
                void archive.archive("person", context.person);
            }}
          />
        )}
      </div>
      <ContactWorkspace
        key={context.relationship.id}
        context={context}
        action={action}
        draft={draft}
        onCompany={crm.openCompany}
        onPerson={crm.openPerson}
        onAction={crm.openPerson}
      />
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
        includeSummary={false}
      />
      <ContactAttribution context={context} />
      <PersonFields person={context.person} notesOnly />
      <ConversationHistory person={context.person} timeZone={crm.timeZone} />
    </>
  );
}

function PersonWithoutRelationship() {
  const crm = useWorkspaceData();
  const archive = useArchive();
  const { context, missing } = useArchivedPersonContext(crm.peek.personId);
  const person = context?.person;
  if (missing) return <EmptyState title={t.recordUnavailable} compact />;
  if (!context) return <LoadingState rows={4} />;
  if (!person) return <EmptyState title={t.recordUnavailable} compact />;
  const company = crm.sourceData.companies.find(
    (item) => item.id === person.companyId,
  );
  return (
    <>
      <div className="contact-header">
        <PersonProfile
          name={person.name}
          person={person}
          title={person.title}
          company={company}
          onCompany={crm.openCompany}
        />
        <RecordActions
          key={person.id}
          inlineEditing
          busy={crm.busy}
          onEdit={() => crm.openRecordDialog({ kind: "person", id: person.id })}
          onArchive={() => void archive.archive("person", person)}
        />
      </div>
      <PersonFields person={person} notesOnly />
      <ConversationHistory person={person} timeZone={crm.timeZone} />
      <details className="contact-secondary">
        <summary>{t.contactWorkspace.details}</summary>
        <PersonFields person={person} />
        <MetadataSection entity="person" record={person} />
      </details>
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
          key={context.company.id}
          busy={crm.busy}
          onEdit={() =>
            crm.openRecordDialog({ kind: "company", id: context.company.id })
          }
          onArchive={() => void archive.archive("company", context.company)}
        />
      )}
      <MetadataSection entity="company" record={context.company} />
      <CompanyProfile company={context.company} />
      <CompanyFields company={context.company} />
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
  const personId =
    peek.personId ||
    crm.sourceData.relationships.find(
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
              data-native-navigation
              className="button icon-button"
              aria-label={t.inlineEditing.openFullPage}
              title={t.inlineEditing.openFullPage}
              onClick={(event) => {
                if (!crm.canLeaveEditor()) {
                  event.preventDefault();
                  return;
                }
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
            onClick={() => crm.closePeek()}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {crm.personDialog ? (
        <PersonDialog
          data={crm.data}
          organizationId={crm.organizationId}
          productId={crm.productId}
          onClose={() => crm.setPersonDialog(false)}
          onCreated={async (result) => {
            await crm.refresh();
            if (crm.productId && crm.productId !== result.productId)
              crm.switchProduct(result.productId);
            crm.openPerson(result.relationshipId);
            crm.notify(t.updated, "success");
          }}
        />
      ) : crm.actionDialog ? (
        <ActionDialog
          data={crm.data}
          organizationId={crm.organizationId}
          productId={crm.productId}
          relationshipId={crm.actionDialogRelationship || peek.relationshipId}
          userId={crm.userId}
          onClose={() => crm.setActionDialog(false)}
          onCreated={async (result) => {
            await crm.refresh();
            if (crm.productId && crm.productId !== result.productId)
              crm.switchProduct(result.productId);
            crm.openPerson(result.relationshipId, result.actionId);
            crm.setTab("timeline");
            crm.notify(t.scheduledAction, "success");
          }}
        />
      ) : crm.recordDialog ? (
        <RecordEditorMode.Provider value={true}>
          <RecordDialogHost />
        </RecordEditorMode.Provider>
      ) : peek.fileId ? (
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
