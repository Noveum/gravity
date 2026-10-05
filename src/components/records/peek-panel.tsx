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
import { useCompanyContext, usePersonContext } from "../crm/record-context";
import { useDraft } from "../crm/use-draft";
import { CompanyDetails, PersonDetails, RelatedWork } from "../record-details";
import { companyPath, personPath } from "../routes";
import { EmptyState, LoadingState } from "../ui/states";
import {
  ActionSummary,
  findAction,
  PersonActivity,
  PersonProfile,
  RelationshipProperties,
} from "./person-panels";

function PersonPeek() {
  const crm = useWorkspaceData();
  const context = usePersonContext(crm.peek.relationshipId);
  const action = findAction(crm.peek.actionId, crm.sourceData, context);
  const draft = useDraft(action);
  if (!context) return <LoadingState rows={4} />;
  return (
    <>
      <PersonProfile
        name={context.person?.name ?? ""}
        title={context.person?.title ?? ""}
        company={context.company}
        onCompany={crm.openCompany}
      />
      <PersonDetails
        context={context}
        onCompany={crm.openCompany}
        onPerson={crm.openPerson}
      />
      <RelationshipProperties context={context} action={action} />
      <PersonActivity context={context} action={action} draft={draft} />
      <RelatedWork
        actions={context.actions}
        meetings={context.meetings}
        opportunities={context.opportunities}
        timeZone={crm.timeZone}
        onAction={crm.openPerson}
        onReveal={crm.reveal}
      />
      {action && <ActionSummary action={action} version={draft.version} />}
    </>
  );
}

function CompanyPeek() {
  const crm = useWorkspaceData();
  const { context, missing } = useCompanyContext(crm.peek.companyId);
  if (missing) return <EmptyState title={t.recordUnavailable} compact />;
  if (!context) return <LoadingState rows={4} />;
  return (
    <CompanyDetails
      context={context}
      onPerson={crm.openPerson}
      onAction={crm.openPerson}
      onReveal={crm.reveal}
      timeZone={crm.timeZone}
    />
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
          {peek.companyId ? t.companyDetails : t.relationships}
        </span>
        <div className="inspector-controls">
          {!!recordHistory.length && (
            <button
              type="button"
              className="icon-button"
              aria-label={t.backToRecord}
              onClick={crm.previousRecord}
            >
              <ArrowLeft size={15} />
            </button>
          )}
          {!peek.companyId && (
            <button
              type="button"
              className="icon-button"
              aria-label={t.scheduleAction}
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
            onClick={() => crm.setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t.closeInspector}
            onClick={crm.closePeek}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {peek.companyId ? <CompanyPeek /> : <PersonPeek />}
    </aside>
  );
}
