"use client";
import type { ClientContext } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useId } from "react";
import { type RecordTab, useWorkspaceData } from "../crm/crm-context";
import type { useDraft } from "../crm/use-draft";
import { PersonDetails, RelatedWork } from "../record-details";
import { ContactAttribution } from "./contact-attribution";
import { PersonFields } from "./contact-fields";
import { MetadataSection } from "./metadata-section";
import {
  ActionSummary,
  PersonActivity,
  RelationshipProperties,
} from "./person-panels";
import { RelationshipContext } from "./relationship-context";

type Action = Parameters<typeof ActionSummary>[0]["action"];
export function ContactWorkspace({
  context,
  action,
  draft,
  onCompany,
  onPerson,
  onAction,
}: {
  context: ClientContext;
  action: Action | undefined;
  draft: ReturnType<typeof useDraft>;
  onCompany: (id: string) => void;
  onPerson: (id: string) => void;
  onAction: (relationshipId: string, actionId: string) => void;
}) {
  const crm = useWorkspaceData();
  const id = useId();
  const tabs: { key: RecordTab; label: string }[] = [
    { key: "timeline", label: t.contactWorkspace.overview },
    { key: "context", label: t.contactWorkspace.context },
    { key: "details", label: t.contactWorkspace.details },
    { key: "evidence", label: t.evidence },
    ...(action ? [{ key: "draft" as const, label: t.draft }] : []),
  ];
  const tab = crm.tab === "draft" && !action ? "timeline" : crm.tab;
  const select = (key: RecordTab) => {
    if (key !== tab && !crm.canLeaveEditor()) return;
    crm.setTab(key);
  };
  return (
    <div className="contact-workspace">
      <div
        className="tabs contact-tabs"
        role="tablist"
        aria-label={t.recordDetails}
      >
        {tabs.map((item, index) => (
          <button
            type="button"
            key={item.key}
            role="tab"
            id={`${id}-${item.key}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === item.key}
            tabIndex={tab === item.key ? 0 : -1}
            data-inspector-tab={item.key}
            onClick={() => select(item.key)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? tabs[0]
                  : event.key === "End"
                    ? tabs.at(-1)
                    : tabs[
                        (index +
                          (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                          tabs.length
                      ];
              if (next && crm.canLeaveEditor()) {
                select(next.key);
                document.getElementById(`${id}-${next.key}`)?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        className="contact-tab-content"
      >
        {tab === "timeline" && (
          <>
            {context.person && (
              <PersonFields person={context.person} notesOnly />
            )}
            <RelatedWork
              actions={context.actions}
              meetings={context.meetings}
              opportunities={context.opportunities}
              relationshipId={context.relationship.id}
              timeZone={crm.timeZone}
              onAction={onAction}
              onReveal={crm.reveal}
              selectedActionId={action?.id}
              selectedAction={
                action && (
                  <ActionSummary action={action} version={draft.version} />
                )
              }
            />
            <PersonActivity
              context={context}
              action={action}
              draft={draft}
              hideTabs
              mode="timeline"
            />
          </>
        )}
        {tab === "context" && (
          <RelationshipContext
            key={context.relationship.id}
            relationship={context.relationship}
          />
        )}
        {tab === "details" && (
          <>
            <PersonDetails
              context={context}
              onCompany={onCompany}
              onPerson={onPerson}
              includeSummary={false}
            />
            <RelationshipProperties
              context={context}
              action={action}
              includeContext={false}
            />
            <ContactAttribution
              key={`${context.person?.id}/${context.relationship.productId}`}
              context={context}
            />
            {context.person && (
              <MetadataSection entity="person" record={context.person} />
            )}
            <MetadataSection
              entity="relationship"
              record={context.relationship}
            />
            <PersonActivity
              context={context}
              action={action}
              draft={draft}
              hideTabs
              mode="details"
            />
          </>
        )}
        {(tab === "evidence" || tab === "draft") && (
          <PersonActivity
            context={context}
            action={action}
            draft={draft}
            hideTabs
            mode={tab}
          />
        )}
      </div>
    </div>
  );
}
