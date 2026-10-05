"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useCreate, useEdit, useWorkspaceData } from "../crm/crm-context";
import {
  useArchivedPersonContext,
  usePersonContext,
} from "../crm/record-context";
import { useArchive } from "../crm/use-archive";
import { useDraft } from "../crm/use-draft";
import { PersonDetails, RelatedWork } from "../record-details";
import { companyPath, personPath, sectionPath } from "../routes";
import { EmptyState, LoadingState } from "../ui/states";
import {
  ActionSummary,
  findAction,
  PersonActivity,
  PersonProfile,
  RelationshipProperties,
} from "./person-panels";
import { ArchivedNotice, RecordActions } from "./record-actions";

export function PersonRecord({ personId }: { personId: string }) {
  const crm = useWorkspaceData();
  const { sourceData, productId, setTab } = crm;
  const router = useRouter();
  const query = useSearchParams();
  const person = sourceData.people.find((item) => item.id === personId);
  const relationships = sourceData.relationships.filter(
    (relationship) => relationship.personId === personId,
  );
  const relationship =
    relationships.find((item) => item.id === query.get("relationship")) ??
    relationships.find((item) => item.productId === productId) ??
    relationships[0];
  const { context, missing } = usePersonContext(relationship?.id ?? "");
  const requestedAction = findAction(
    query.get("action") ?? "",
    sourceData,
    context,
  );
  const action =
    requestedAction?.relationshipId === relationship?.id
      ? requestedAction
      : undefined;
  const draft = useDraft(action);
  const relationshipId = relationship?.id ?? "";
  const archive = useArchive();
  useCreate(() => {
    if (!relationshipId) return false;
    crm.setActionDialog(true, relationshipId);
    return true;
  });
  useEdit(() =>
    person ? crm.openRecordDialog({ kind: "person", id: person.id }) : false,
  );
  const actionKind = action?.kind;
  useEffect(() => {
    setTab(
      actionKind === "reply" || actionKind === "approval"
        ? "draft"
        : "timeline",
    );
  }, [actionKind, setTab]);
  if (
    !person &&
    sourceData.archived.people.some((archived) => archived.id === personId)
  )
    return <ArchivedPersonRecord personId={personId} />;
  if (!person || !relationship)
    return (
      <EmptyState
        title={t.recordUnavailable}
        action={
          <Link className="button" href={sectionPath("people")}>
            {t.people}
          </Link>
        }
      />
    );
  const activeCompany = sourceData.companies.find(
    (item) => item.id === person.companyId,
  );
  const archivedCompany = sourceData.archived.companies.find(
    (item) => item.id === person.companyId,
  );
  const company =
    activeCompany ??
    (archivedCompany && {
      id: archivedCompany.id,
      name: `${archivedCompany.name} ${t.archivedSuffix}`,
    });
  const focus = (relationshipId: string, actionId = "") => {
    const owner = sourceData.relationships.find(
      (item) => item.id === relationshipId,
    )?.personId;
    if (!owner) return;
    const href = personPath(owner, { relationshipId, actionId });
    if (owner === personId) router.replace(href, { scroll: false });
    else crm.go(href);
  };
  const toCompany = (companyId: string) => crm.go(companyPath(companyId));
  const unavailable = <EmptyState title={t.recordUnavailable} compact />;
  return (
    <div className="record-page" data-record={person.id}>
      <div className="record-attributes">
        <PersonProfile
          name={person.name}
          title={person.title}
          company={company}
          onCompany={toCompany}
          recordHeading
        />
        <RecordActions
          busy={crm.busy}
          onEdit={() => crm.openRecordDialog({ kind: "person", id: person.id })}
          onArchive={() => void archive.archive("person", person)}
        />
        {context ? (
          <>
            <PersonDetails
              context={context}
              onCompany={toCompany}
              onPerson={(id) => focus(id)}
            />
            <RelationshipProperties context={context} action={action} />
            {action && (
              <ActionSummary action={action} version={draft.version} />
            )}
            <RelatedWork
              actions={context.actions}
              meetings={context.meetings}
              opportunities={context.opportunities}
              timeZone={crm.timeZone}
              onAction={focus}
              onReveal={crm.reveal}
            />
          </>
        ) : missing ? (
          unavailable
        ) : (
          <LoadingState rows={5} />
        )}
      </div>
      <section className="record-timeline" aria-label={t.activity}>
        {context ? (
          <PersonActivity context={context} action={action} draft={draft} />
        ) : missing ? (
          unavailable
        ) : (
          <LoadingState rows={4} />
        )}
      </section>
    </div>
  );
}

function ArchivedPersonRecord({ personId }: { personId: string }) {
  const crm = useWorkspaceData();
  const archive = useArchive();
  const { context, missing } = useArchivedPersonContext(personId);
  const summary = crm.sourceData.archived.people.find(
    (person) => person.id === personId,
  );
  const toCompany = (companyId: string) => crm.go(companyPath(companyId));
  return (
    <div className="record-page" data-record={personId} data-archived="">
      <div className="record-attributes">
        <PersonProfile
          name={context?.person?.name ?? summary?.name ?? ""}
          title={context?.person?.title ?? summary?.title ?? ""}
          company={context?.company}
          onCompany={toCompany}
          recordHeading
        />
        <ArchivedNotice
          note={t.archivedPersonNote}
          busy={crm.busy || !context?.person}
          onRestore={() => {
            const person = context?.person;
            if (person) void archive.restore("person", person);
          }}
        />
        {context ? (
          <PersonDetails
            context={context}
            onCompany={toCompany}
            onPerson={() => {}}
          />
        ) : missing ? (
          <EmptyState title={t.recordUnavailable} compact />
        ) : (
          <LoadingState rows={3} />
        )}
      </div>
    </div>
  );
}
