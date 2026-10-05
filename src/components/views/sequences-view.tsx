"use client";
import t from "@crm/i18n/translations/en.json";
import { label } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { EmptyState } from "../ui/states";

export function SequencesView() {
  const crm = useWorkspaceData();
  const { data, search, product, personFor } = crm;
  const sequences = data.sequences.filter((sequence) =>
    [sequence.name, product(sequence.productId)?.name]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="page-content">
      {!sequences.length && <EmptyState title={t.noSequences} compact />}
      {sequences.map((sequence) => (
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
          </div>
          <div className="sequence-steps">
            {sequence.steps.map((step) => (
              <div className="sequence-step" key={step.number}>
                <span className="step-number">{step.number}</span>
                <div>
                  <strong>{step.name}</strong>
                  <small>
                    {step.delayDays
                      ? `${step.delayDays} ${t.delay}`
                      : t.firstStep}{" "}
                    · {label(step.channel)}
                  </small>
                </div>
              </div>
            ))}
          </div>
          <div className="sequence-states">
            {data.enrollments
              .filter((enrollment) => enrollment.sequenceId === sequence.id)
              .map((enrollment) => (
                <button
                  type="button"
                  data-nav-record={enrollment.id}
                  onClick={() => crm.openPerson(enrollment.relationshipId)}
                  className={`badge ${enrollment.status.startsWith("paused") ? "warning" : ""}`}
                  key={enrollment.id}
                >
                  {personFor(enrollment.relationshipId)?.name} ·{" "}
                  {label(enrollment.status)}
                </button>
              ))}
          </div>
          <p className="muted">{t.sequenceNote}</p>
        </article>
      ))}
    </div>
  );
}
