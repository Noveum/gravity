"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { label } from "../client-api";
import { useCreate, useWorkspaceData } from "../crm/crm-context";
import { useOutreachSend } from "../outreach/outreach-data";
import { SequenceDialog } from "../outreach/sequence-dialog";
import { SequenceEditor } from "../outreach/sequence-editor";
import { followUpLabel } from "../outreach/touch-labels";
import { personPath } from "../routes";
import { ShortcutHint } from "../ui/shortcut-hint";
import { EmptyState } from "../ui/states";

type Enrollment = ClientSnapshot["enrollments"][number];

export function SequencesView() {
  const crm = useWorkspaceData();
  const { data, search, product, personFor } = crm;
  const send = useOutreachSend();
  const [editing, setEditing] = useState("");
  const [creating, setCreating] = useState(false);
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
      {sequences.map((sequence) => {
        const title = `${sequence.name} · ${product(sequence.productId)?.name ?? ""}`;
        const enrollments = data.enrollments.filter(
          (enrollment) => enrollment.sequenceId === sequence.id,
        );
        return (
          <article className="sequence" key={sequence.id}>
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {product(sequence.productId)?.name}
                </span>
                <h2>{sequence.name}</h2>
              </div>
              <span className="badge">
                {t.sequenceVersion} {sequence.version}
              </span>
              {editing !== sequence.id && (
                <button
                  type="button"
                  aria-label={`${t.editSteps}: ${title}`}
                  onClick={() => setEditing(sequence.id)}
                >
                  <Pencil size={13} aria-hidden />
                  {t.editSteps}
                </button>
              )}
            </div>
            {editing === sequence.id ? (
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
                        {enrollment.status === "paused" && (
                          <button
                            type="button"
                            className="ghost"
                            aria-label={`${t.resume}: ${name}`}
                            onClick={() => void change(enrollment, "resume")}
                          >
                            {t.resume}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!enrollments.length && <p className="muted">{t.noEnrollments}</p>}
          </article>
        );
      })}
    </div>
  );
}
