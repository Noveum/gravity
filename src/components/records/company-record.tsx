"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useEdit, useWorkspaceData } from "../crm/crm-context";
import { useCompanyContext } from "../crm/record-context";
import { useArchive } from "../crm/use-archive";
import {
  CompanyPeople,
  CompanyProfile,
  RelatedOpportunities,
} from "../record-details";
import { personPath, sectionPath } from "../routes";
import { EmptyState, LoadingState } from "../ui/states";
import { CompanyActivity } from "./company-activity";
import { CompanyFields } from "./contact-fields";
import { MetadataSection } from "./metadata-section";
import { ArchivedNotice, RecordActions } from "./record-actions";

export function CompanyRecord({ companyId }: { companyId: string }) {
  const crm = useWorkspaceData();
  const { sourceData } = crm;
  const active = sourceData.companies.find((item) => item.id === companyId);
  const company =
    active ??
    sourceData.archived.companies.find((item) => item.id === companyId);
  const { context, missing } = useCompanyContext(company ? companyId : "");
  const archive = useArchive();
  useEdit(() =>
    active ? crm.openRecordDialog({ kind: "company", id: active.id }) : false,
  );
  if (!company || missing)
    return (
      <EmptyState
        title={t.recordUnavailable}
        action={
          <Link className="button" href={sectionPath("companies")}>
            {t.companies}
          </Link>
        }
      />
    );
  const openPerson = (relationshipId: string, actionId = "") => {
    const personId = sourceData.relationships.find(
      (relationship) => relationship.id === relationshipId,
    )?.personId;
    if (personId) crm.go(personPath(personId, { relationshipId, actionId }));
  };
  return (
    <div className="record-page" data-record={company.id}>
      <div className="record-attributes">
        <CompanyProfile
          company={context?.company ?? { description: "", ...company }}
          recordHeading
        />
        {context && <CompanyFields company={context.company} />}
        {active ? (
          <RecordActions
            key={company.id}
            busy={crm.busy}
            onEdit={() =>
              crm.openRecordDialog({ kind: "company", id: active.id })
            }
            onArchive={() => void archive.archive("company", active)}
            onMerge={() =>
              crm.openRecordDialog({
                kind: "merge",
                id: active.id,
                entity: "company",
              })
            }
          />
        ) : (
          <ArchivedNotice
            note={t.archivedCompanyNote}
            busy={crm.busy || !context}
            onRestore={() => {
              if (context) void archive.restore("company", context.company);
            }}
          />
        )}
        {context ? (
          <>
            <MetadataSection entity="company" record={context.company} />
            <CompanyPeople context={context} onPerson={openPerson} />
            <RelatedOpportunities
              className="record-section"
              opportunities={context.opportunities}
              allowOpportunityCreation={!!active}
              onReveal={crm.reveal}
            />
          </>
        ) : (
          <LoadingState rows={5} />
        )}
      </div>
      <CompanyActivity context={context} />
    </div>
  );
}
