"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useCrm } from "../crm/crm-context";
import { submitOnSaveKey } from "../modal-lifecycle";
import { useOutreachSend } from "./outreach-data";
import { followUpLabel } from "./touch-labels";

type Sequence = ClientSnapshot["sequences"][number];
type Step = Sequence["steps"][number];
type DraftStep = Omit<Step, "number"> & { key: number };

export function changedLabel(count: number) {
  return count === 0
    ? t.plannedChangedNone
    : count === 1
      ? t.plannedChangedOne
      : t.plannedChanged.replace("{count}", String(count));
}

export function SequenceEditor({
  sequence,
  label,
  onClose,
  onBusyChange,
}: {
  sequence?: Sequence;
  label: string;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const crm = useCrm();
  const send = useOutreachSend();
  const hintId = useId();
  const initialSteps = sequence?.steps ?? [
    {
      number: 1,
      name: t.stepLabel.replace("{number}", "1"),
      delayDays: 0,
      channel: "gmail" as const,
      template: "",
      followUp: 0,
    },
  ];
  const nextKey = useRef(initialSteps.length);
  const submitting = useRef(false);
  const [name, setName] = useState(sequence?.name ?? "");
  const products = crm.data?.products ?? [];
  const [productId, setProductId] = useState(
    crm.productId || products[0]?.id || "",
  );
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    initialSteps.map(({ number: _number, ...step }, index) => ({
      ...step,
      key: index,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = (key: number, patch: Partial<DraftStep>) =>
    setSteps((current) =>
      current.map((step) => (step.key === key ? { ...step, ...patch } : step)),
    );
  function move(index: number, offset: number) {
    setSteps((current) => {
      const target = index + offset;
      const moving = current[index];
      const other = current[target];
      if (!moving || !other) return current;
      const next = [...current];
      next[index] = other;
      next[target] = moving;
      return next;
    });
  }
  function add() {
    setSteps((current) => {
      const last = current.at(-1);
      nextKey.current += 1;
      return [
        ...current,
        {
          key: nextKey.current,
          name: t.stepLabel.replace("{number}", String(current.length + 1)),
          delayDays: 3,
          channel: last?.channel ?? "gmail",
          template: "",
          followUp: Math.min(3, (last?.followUp ?? -1) + 1),
        },
      ];
    });
  }
  async function save() {
    if (
      submitting.current ||
      !name.trim() ||
      (!sequence && !products.some((product) => product.id === productId))
    )
      return;
    submitting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    const body = {
      name: name.trim(),
      steps: steps.map(({ key: _key, ...step }, index) => ({
        ...step,
        name:
          step.name.trim() ||
          t.stepLabel.replace("{number}", String(index + 1)),
        number: index + 1,
      })),
    };
    const result = sequence
      ? await send<{ sequence: Sequence; changedTouches: number }>({
          operation: "sequence",
          sequenceId: sequence.id,
          version: sequence.version,
          ...body,
        })
      : await send<Sequence>({
          operation: "create-sequence",
          productId,
          ...body,
        });
    submitting.current = false;
    setBusy(false);
    onBusyChange?.(false);
    if (!result.ok) return setError(result.error);
    const saved = result.result;
    crm.notify(
      "sequence" in saved
        ? t.sequenceSaved
            .replace("{name}", saved.sequence.name)
            .replace("{changes}", changedLabel(saved.changedTouches))
        : t.sequenceCreated.replace("{name}", saved.name),
      "success",
    );
    onClose();
  }
  return (
    <form
      className="sequence-editor"
      aria-label={sequence ? `${t.editSteps}: ${label}` : t.newSequence}
      aria-describedby={hintId}
      onKeyDown={submitOnSaveKey}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset className="sequence-editor-content" disabled={busy}>
        {!sequence && (
          <label>
            {t.product}
            <select
              required
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="sequence-name">
          {t.sequenceName}
          <input
            value={name}
            maxLength={100}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p id={hintId} className="muted field-hint">
          {sequence ? t.sequenceEditHint : t.sequenceCreationHint}
        </p>
        <ol className="sequence-editor-steps">
          {steps.map((step, index) => {
            const number = String(index + 1);
            return (
              <li key={step.key}>
                <fieldset
                  className="sequence-editor-step"
                  aria-label={t.stepLabel.replace("{number}", number)}
                >
                  <span className="step-number" aria-hidden>
                    {number}
                  </span>
                  <div className="sequence-editor-fields">
                    <label>
                      {t.stepName}
                      <input
                        value={step.name}
                        maxLength={100}
                        onChange={(event) =>
                          change(step.key, { name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t.channel}
                      <select
                        value={step.channel}
                        onChange={(event) =>
                          change(step.key, {
                            channel: event.target.value as Step["channel"],
                          })
                        }
                      >
                        <option value="gmail">{t.gmail}</option>
                        <option value="linkedin">{t.linkedin}</option>
                      </select>
                    </label>
                    <label>
                      {t.stepDelay}
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={step.delayDays}
                        onChange={(event) =>
                          change(step.key, {
                            delayDays: Math.max(
                              0,
                              Math.min(365, Number(event.target.value) || 0),
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      {t.stepFollowUp}
                      <select
                        value={step.followUp}
                        onChange={(event) =>
                          change(step.key, {
                            followUp: Number(event.target.value),
                          })
                        }
                      >
                        {[0, 1, 2, 3].map((value) => (
                          <option key={value} value={value}>
                            {followUpLabel(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="sequence-template">
                      {t.stepTemplate}
                      <textarea
                        rows={3}
                        value={step.template}
                        maxLength={20000}
                        onChange={(event) =>
                          change(step.key, { template: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="sequence-editor-order">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === 0}
                      aria-label={t.moveStepUp.replace("{number}", number)}
                      title={t.moveStepUp.replace("{number}", number)}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === steps.length - 1}
                      aria-label={t.moveStepDown.replace("{number}", number)}
                      title={t.moveStepDown.replace("{number}", number)}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={steps.length === 1}
                      aria-label={t.removeStep.replace("{number}", number)}
                      title={t.removeStep.replace("{number}", number)}
                      onClick={() =>
                        setSteps((current) =>
                          current.filter((item) => item.key !== step.key),
                        )
                      }
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions sequence-editor-actions">
        <button
          type="button"
          disabled={busy || steps.length >= 10}
          onClick={add}
        >
          <Plus size={13} aria-hidden />
          {t.addStep}
        </button>
        <span className="muted field-hint">{t.submitHint}</span>
        <button type="button" disabled={busy} onClick={onClose}>
          {t.cancel}
        </button>
        <button
          type="submit"
          className="primary"
          disabled={busy || !name.trim() || (!sequence && !productId)}
        >
          {busy ? t.saving : sequence ? t.saveSequence : t.createSequence}
        </button>
      </div>
    </form>
  );
}
