"use client";
import t from "@crm/i18n/translations/en.json";
import { useCrm } from "../crm/crm-context";
import { usePersonContext } from "../crm/record-context";
import { companyPath } from "../routes";
import { EmptyState, LoadingState } from "../ui/states";
import { RecordDialog } from "./record-dialog";
import {
  CompanyDialog,
  MeetingDialog,
  OpportunityDialog,
  PersonEditDialog,
} from "./record-dialogs";

export function RecordDialogHost() {
  const crm = useCrm();
  const dialog = crm.recordDialog;
  const data = crm.sourceData;
  if (!dialog || !data) return null;
  const close = crm.closeRecordDialog;
  if (dialog.kind === "person") {
    const person = data.people.find((item) => item.id === dialog.id);
    if (person && data.compact)
      return (
        <PersonEditLoader
          key={person.id}
          personId={person.id}
          onClose={close}
        />
      );
    return person ? (
      <PersonEditDialog key={person.id} person={person} onClose={close} />
    ) : null;
  }
  if (dialog.kind === "company") {
    const company = data.companies.find((item) => item.id === dialog.id);
    if (dialog.id && !company) return null;
    return (
      <CompanyDialog
        key={dialog.id ?? "new"}
        {...(company ? { company } : {})}
        onClose={close}
        onCreated={(created) =>
          requestAnimationFrame(() => crm.go(companyPath(created.id)))
        }
      />
    );
  }
  if (dialog.kind === "meeting") {
    const meeting = data.meetings.find((item) => item.id === dialog.id);
    if (dialog.id && !meeting) return null;
    return (
      <MeetingDialog
        key={dialog.id ?? dialog.relationshipId ?? "new"}
        {...(meeting ? { meeting } : {})}
        {...(dialog.relationshipId
          ? { relationshipId: dialog.relationshipId }
          : {})}
        onClose={close}
      />
    );
  }
  const opportunity = data.opportunities.find((item) => item.id === dialog.id);
  if (dialog.id && !opportunity) return null;
  return (
    <OpportunityDialog
      key={dialog.id ?? dialog.relationshipId ?? "new"}
      {...(opportunity ? { opportunity } : {})}
      relationshipId={dialog.relationshipId}
      onClose={close}
    />
  );
}

function PersonEditLoader({
  personId,
  onClose,
}: {
  personId: string;
  onClose: () => void;
}) {
  const crm = useCrm();
  const relationship = crm.sourceData?.relationships.find(
    (row) => row.personId === personId,
  );
  const { context, missing } = usePersonContext(relationship?.id ?? "");
  if (context?.person)
    return <PersonEditDialog person={context.person} onClose={onClose} />;
  return (
    <RecordDialog
      title={t.editPerson}
      submitLabel={t.save}
      onClose={onClose}
      loading
      onSubmit={async () => t.recordUnavailable}
    >
      {missing ? (
        <EmptyState title={t.recordUnavailable} compact />
      ) : (
        <LoadingState rows={3} />
      )}
    </RecordDialog>
  );
}
