"use client";
import { useCrm } from "../crm/crm-context";
import { companyPath } from "../routes";
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
    return person ? <PersonEditDialog person={person} onClose={close} /> : null;
  }
  if (dialog.kind === "company") {
    const company = data.companies.find((item) => item.id === dialog.id);
    if (dialog.id && !company) return null;
    return (
      <CompanyDialog
        {...(company ? { company } : {})}
        onClose={close}
        onCreated={(created) => crm.go(companyPath(created.id))}
      />
    );
  }
  if (dialog.kind === "meeting") {
    const meeting = data.meetings.find((item) => item.id === dialog.id);
    if (dialog.id && !meeting) return null;
    return (
      <MeetingDialog
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
      {...(opportunity ? { opportunity } : {})}
      onClose={close}
    />
  );
}
