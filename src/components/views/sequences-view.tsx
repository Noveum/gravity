"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { label } from "../client-api";
import { useCreate, useWorkspaceData } from "../crm/crm-context";
import { useOutreachSend } from "../outreach/outreach-data";
import { SequenceDialog } from "../outreach/sequence-dialog";
import { SequenceEditor } from "../outreach/sequence-editor";
import { followUpLabel } from "../outreach/touch-labels";
import { RecordDialog } from "../records/record-dialog";
import { personPath } from "../routes";
import { ShortcutHint } from "../ui/shortcut-hint";
import { EmptyState } from "../ui/states";

type Sequence = ClientSnapshot["sequences"][number];
type Enrollment = ClientSnapshot["enrollments"][number];
type Stopping = { enrollment: Enrollment; sequence: Sequence; name: string };

export function SequencesView() {
  const crm = useWorkspaceData();
  const { data, search, product, personFor } = crm;
  const send = useOutreachSend();
  const [editing, setEditing] = useState("");
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Sequence | null>(null);
  const [stopping, setStopping] = useState<Stopping | null>(null);
  useCreate(() => {
    if (!data.products.length) return false;
    setCreating(true);
    return true;
  });
  const sequences = data.sequences
    .filter((sequence) =>
      [sequence.name, product(sequence.productId)?.name]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (product(a.productId)?.name ?? "").localeCompare(
          product(b.productId)?.name ?? "",
        ) || a.name.localeCompare(b.name),
    );
  const active = sequences.filter((sequence) => !sequence.archivedAt);
  const archived = sequences.filter((sequence) => sequence.archivedAt);
  const enrollmentsOf = (sequence: Sequence) =>
    data.enrollments.filter(
      (enrollment) => enrollment.sequenceId === sequence.id,
    );
  async function change(enrollment: Enrollment, command: "pause" | "resume") {
    const name = personFor(enrollment.relationshipId)?.name ?? t.unknown;
    const result = await send({
      operation: "enrollment",
      enrollmentId: enrollment.id,
      version: enrollment.version,
      command,
    });
    if (!result.ok) return crm.notify(result.error, "danger");
    crm.notify(
      (command === "pause" ? t.pausedSequence : t.resumed).replace(
        "{name}",
        name,
      ),
      "success",
    );
  }
  async function archive(sequence: Sequence) {
    const result = await send({
      operation: "sequence-archive",
      sequenceId: sequence.id,
      version: sequence.version,
    });
    if (!result.ok) return result.error;
    if (editing === sequence.id) setEditing("");
    crm.notify(t.sequenceArchived.replace("{name}", sequence.name), "success");
    return null;
  }
  async function restore(sequence: Sequence) {
    const result = await send({
      operation: "sequence-restore",
      sequenceId: sequence.id,
      version: sequence.version,
    });
    if (!result.ok) return crm.notify(result.error, "danger");
    crm.notify(t.sequenceRestored.replace("{name}", sequence.name), "success");
  }
  async function stop({ enrollment, name }: Stopping) {
    const result = await send({
      operation: "enrollment",
      enrollmentId: enrollment.id,
      version: enrollment.version,
      command: "stop",
    });
    if (!result.ok) return result.error;
    crm.notify(t.enrollmentStopped.replace("{name}", name), "success");
    return null;
  }
  function card(sequence: Sequence) {
    const productName = product(sequence.productId)?.name ?? "";
    const title = `${sequence.name} · ${productName}`;
    const enrollments = enrollmentsOf(sequence);
    const isArchived = !!sequence.archivedAt;
    return (
      <article className="sequence" key={sequence.id}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">{productName}</span>
            <h2>{sequence.name}</h2>
          </div>
          <div className="sequence-heading-actions">
            {isArchived && <span className="badge">{t.archivedFlag}</span>}
            <span className="badge">
              {t.sequenceVersion} {sequence.version}
            </span>
            {!isArchived && editing !== sequence.id && (
              <button
                type="button"
                aria-label={`${t.editSteps}: ${title}`}
                onClick={() => setEditing(sequence.id)}
              >
                <Pencil size={13} aria-hidden />
                {t.editSteps}
              </button>
            )}
            {isArchived ? (
              <button
                type="button"
                className="ghost"
                aria-label={`${t.restore}: ${title}`}
                onClick={() => void restore(sequence)}
              >
                <RotateCcw size={13} aria-hidden />
                {t.restore}
              </button>
            ) : (
              <button
                type="button"
                className="ghost"
                aria-label={`${t.archiveSequence}: ${title}`}
                onClick={() => setArchiving(sequence)}
              >
                <Archive size={13} aria-hidden />
                {t.archive}
              </button>
            )}
          </div>
        </div>
        {editing === sequence.id && !isArchived ? (
          <SequenceEditor
            sequence={sequence}
            label={title}
            onClose={() => setEditing("")}
          />
        ) : (
          <div className="sequence-steps">
            {sequence.steps.map((step) => (
              <div className="sequence-step" key={step.number}>
                <span className="step-number">{step.number}</span>
                <div>
                  <strong>{step.name}</strong>
                  <small>
                    {followUpLabel(step.followUp)} ·{" "}
                    {step.delayDays
                      ? `${step.delayDays} ${t.delay}`
                      : t.firstStep}{" "}
                    · {label(step.channel)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
        <table
          className="sequence-enrollments"
          aria-label={`${t.enrollments}: ${title}`}
        >
          <thead>
            <tr>
              <th>{t.person}</th>
              <th>{t.status}</th>
              <th>{t.stepFollowUp}</th>
              <th>
                <span className="sr-only">{t.enrollmentChange}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((enrollment) => {
              const person = personFor(enrollment.relationshipId);
              const name = person?.name ?? t.unknown;
              const open =
                enrollment.status === "running" ||
                enrollment.status === "paused";
              return (
                <tr key={enrollment.id} aria-label={name}>
                  <td>
                    {person ? (
                      <Link
                        className="text-button"
                        href={personPath(person.id, {
                          relationshipId: enrollment.relationshipId,
                        })}
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${enrollment.status === "paused" ? "warning" : ""}`}
                    >
                      {enrollment.pauseReason
                        ? label(`paused_${enrollment.pauseReason}`)
                        : t.enrollmentStatus[
                            enrollment.status as keyof typeof t.enrollmentStatus
                          ]}
                    </span>
                  </td>
                  <td>
                    {t.currentStep
                      .replace("{step}", String(enrollment.step))
                      .replace("{total}", String(sequence.steps.length))}
                  </td>
                  <td>
                    <span className="sequence-enrollment-actions">
                      {enrollment.status === "running" && (
                        <button
                          type="button"
                          className="ghost"
                          aria-label={`${t.pause}: ${name}`}
                          onClick={() => void change(enrollment, "pause")}
                        >
                          {t.pause}
                        </button>
                      )}
                      {enrollment.status === "paused" && !isArchived && (
                        <button
                          type="button"
                          className="ghost"
                          aria-label={`${t.resume}: ${name}`}
                          onClick={() => void change(enrollment, "resume")}
                        >
                          {t.resume}
                        </button>
                      )}
                      {open && (
                        <button
                          type="button"
                          className="ghost"
                          aria-label={`${t.stop}: ${name}`}
                          onClick={() =>
                            setStopping({ enrollment, sequence, name })
                          }
                        >
                          {t.stop}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!enrollments.length && <p className="muted">{t.noEnrollments}</p>}
      </article>
    );
  }
  const running = archiving
    ? enrollmentsOf(archiving).filter(
        (enrollment) => enrollment.status === "running",
      ).length
    : 0;
  return (
    <div className="page-content sequences-page">
      <div className="section-heading">
        <p className="muted">{t.sequenceCreationHint}</p>
        <button
          type="button"
          className="primary"
          aria-label={t.newSequence}
          aria-keyshortcuts="C"
          disabled={!data.products.length}
          onClick={() => setCreating(true)}
        >
          <Plus size={14} aria-hidden />
          {t.newSequence}
          <ShortcutHint id="create" />
        </button>
      </div>
      {creating && <SequenceDialog onClose={() => setCreating(false)} />}
      {!sequences.length && <EmptyState title={t.noSequences} compact />}
      {active.map(card)}
      {archived.length > 0 && (
        <section
          className="sequences-archived"
          aria-label={t.archivedSequences}
        >
          <div className="group-title sequences-archived-title">
            {t.archivedSequences}
            <span>{archived.length}</span>
          </div>
          {archived.map(card)}
        </section>
      )}
      {archiving && (
        <RecordDialog
          title={t.archiveSequence}
          submitLabel={t.archive}
          onClose={() => setArchiving(null)}
          onSubmit={() => archive(archiving)}
        >
          <p className="muted">
            <strong>{archiving.name}</strong> ·{" "}
            {t.archiveSequenceDetail.replace("{count}", String(running))}
          </p>
        </RecordDialog>
      )}
      {stopping && (
        <RecordDialog
          title={t.stopEnrollmentTitle.replace("{name}", stopping.name)}
          submitLabel={t.stop}
          onClose={() => setStopping(null)}
          onSubmit={() => stop(stopping)}
        >
          <p className="muted">
            {t.stopEnrollmentDetail
              .replace("{name}", stopping.name)
              .replace("{sequence}", stopping.sequence.name)}
          </p>
        </RecordDialog>
      )}
    </div>
  );
}
