"use client";
import t from "@crm/i18n/translations/en.json";
import { Pencil } from "lucide-react";
import { dateLabel, label } from "../client-api";
import { useCreate, useEdit, useWorkspaceData } from "../crm/crm-context";
import { useRevealedRecord } from "../crm/use-revealed-record";
import { formatMoney } from "../money";
import {
  Pagination,
  RecordFilters,
  useRecordBrowser,
  useRecordIndex,
} from "../records/list-browser";
import { EmptyState } from "../ui/states";

export function MeetingsView() {
  const crm = useWorkspaceData();
  const { data, search, product, personFor, busy, userId, timeZone } = crm;
  const focusedRecord = useRevealedRecord();
  useCreate(() =>
    data.relationships.length
      ? crm.openRecordDialog({ kind: "meeting" })
      : false,
  );
  useEdit(() => {
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
            .closest<HTMLElement>("[data-record-id]")
            ?.getAttribute("data-record-id")
        : undefined;
    const id = active ?? focusedRecord;
    if (!data.meetings.some((meeting) => meeting.id === id)) return false;
    return crm.openRecordDialog({ kind: "meeting", id });
  });
  const meetings = data.meetings.filter((meeting) =>
    [meeting.title, personFor(meeting.relationshipId)?.name]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const index = useRecordIndex();
  const browser = useRecordBrowser(
    meetings,
    (meeting) => ({
      ...index.facts(meeting.relationshipId),
      status: meeting.status,
    }),
    (meeting) => meeting.title,
    focusedRecord,
  );
  return (
    <div className="page-content">
      <RecordFilters browser={browser} />
      <p className="callout">{t.meetingNote}</p>
      {!browser.page.total && <EmptyState title={t.noMeetings} compact />}
      {browser.page.items.map((meeting) => (
        <article
          className={`meeting ${focusedRecord === meeting.id ? "record-highlight" : ""}`}
          key={meeting.id}
          data-record-id={meeting.id}
          tabIndex={-1}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {product(meeting.productId)?.name} ·{" "}
                {dateLabel(meeting.startsAt, timeZone)}
              </span>
              <h2>{meeting.title}</h2>
              <p className="muted">
                <button
                  data-nav-record={meeting.id}
                  type="button"
                  className="text-button"
                  onClick={() => crm.openPerson(meeting.relationshipId)}
                >
                  {personFor(meeting.relationshipId)?.name}
                </button>
              </p>
            </div>
            <div className="meeting-actions">
              <span className="badge">{label(meeting.status)}</span>
              <button
                type="button"
                className="ghost"
                aria-keyshortcuts="E"
                aria-label={`${t.editMeeting}: ${meeting.title}`}
                title={`${t.editMeeting} (E)`}
                onClick={() =>
                  crm.openRecordDialog({ kind: "meeting", id: meeting.id })
                }
              >
                <Pencil size={13} aria-hidden />
                {t.edit}
              </button>
            </div>
          </div>
          <p>{meeting.summary}</p>
          <p className="muted">
            {t.dealSize}:{" "}
            {formatMoney(
              index.facts(meeting.relationshipId).amountMinor ?? null,
              index.facts(meeting.relationshipId).currency ?? "USD",
            )}
          </p>
          {meeting.proposedCommitment && (
            <div className="commitment-box">
              <span className="eyebrow">{t.meetingProposal}</span>
              <p>{meeting.proposedCommitment}</p>
              {meeting.commitmentActionId ? (
                <span className="success">{t.commitmentAccepted}</span>
              ) : (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void crm.mutate({
                      operation: "commitment",
                      organizationId: crm.organizationId,
                      meetingId: meeting.id,
                      version: meeting.version,
                      ownerId: form.get("ownerId"),
                      dueAt: new Date(String(form.get("dueAt"))).toISOString(),
                    });
                  }}
                >
                  <label>
                    {t.owner}
                    <select
                      name="ownerId"
                      defaultValue={userId}
                      disabled={busy}
                    >
                      {data.members
                        .filter((member) =>
                          member.productIds.includes(meeting.productId),
                        )
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t.commitmentDate}
                    <input
                      name="dueAt"
                      disabled={busy}
                      type="datetime-local"
                      required
                    />
                  </label>
                  <button type="submit" className="primary" disabled={busy}>
                    {t.acceptCommitment}
                  </button>
                </form>
              )}
            </div>
          )}
        </article>
      ))}
      <Pagination page={browser.page} />
    </div>
  );
}
