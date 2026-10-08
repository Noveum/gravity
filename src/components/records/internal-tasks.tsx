"use client";
import {
  instantFromZonedInput,
  preciseDateLabel,
  zonedInputValue,
} from "@crm/core/calendar";
import type { ClientSnapshot } from "@crm/core/dto";
import { createInternalTaskSchema } from "@crm/core/internal-tasks";
import t from "@crm/i18n/translations/en.json";
import { useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import { RecordDialog, text } from "./record-dialog";
import { RecordText } from "./record-text";

type InternalTask = ClientSnapshot["internalTasks"][number];
const recurrenceUnits = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
} as const;
function InternalTaskEditor({
  task,
  onClose,
}: {
  task: InternalTask | null;
  onClose: () => void;
}) {
  const crm = useWorkspaceData();
  const [productId, setProductId] = useState(
    task?.productId || crm.productId || crm.data.products[0]?.id || "",
  );
  const [timeZone, setTimeZone] = useState(task?.timeZone || crm.timeZone);
  const [frequency, setFrequency] = useState(task?.recurrence?.frequency ?? "");
  return (
    <RecordDialog
      inline
      title={task ? t.internalTasks.edit : t.internalTasks.new}
      submitLabel={t.save}
      onClose={onClose}
      onSubmit={async (fields) => {
        const localDue = text(fields, "dueAt");
        const dueAt =
          task &&
          timeZone === task.timeZone &&
          localDue === zonedInputValue(task.dueAt, timeZone, true)
            ? task.dueAt
            : instantFromZonedInput(localDue, timeZone);
        const parsed = createInternalTaskSchema.safeParse({
          organizationId: crm.organizationId,
          productId,
          title: text(fields, "title"),
          description: text(fields, "description"),
          ownerId: text(fields, "ownerId"),
          relationshipId: text(fields, "relationshipId") || null,
          dueAt,
          timeZone,
          recurrence: frequency
            ? { frequency, interval: Number(text(fields, "interval")) }
            : null,
        });
        if (!parsed.success) return t.internalTasks.invalid;
        const result = await crm.send({
          ...parsed.data,
          operation: task ? "internal-task-change" : "internal-task-create",
          ...(task
            ? { taskId: task.id, version: task.version, command: "save" }
            : {}),
        });
        if (!result.ok) return result.error ?? t.errors.INVALID_INPUT;
        crm.notify(t.internalTasks.saved, "success");
        return null;
      }}
    >
      <label>
        {t.product}
        <select
          value={productId}
          disabled={!!task}
          required
          onChange={(event) => setProductId(event.target.value)}
        >
          {crm.data.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.actionTitle}
        <input
          name="title"
          required
          maxLength={200}
          data-primary-field
          defaultValue={task?.title ?? ""}
        />
      </label>
      <label>
        {t.internalTasks.description}
        <textarea
          name="description"
          maxLength={10000}
          rows={3}
          defaultValue={task?.description ?? ""}
        />
      </label>
      <label>
        {t.owner}
        <select
          name="ownerId"
          key={productId}
          required
          defaultValue={task?.ownerId ?? crm.userId}
        >
          {crm.data.members
            .filter((member) => member.productIds.includes(productId))
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t.internalTasks.relationship}
        <select
          name="relationshipId"
          key={`relationship:${productId}`}
          defaultValue={task?.relationshipId ?? ""}
        >
          <option value="">{t.internalTasks.noRelationship}</option>
          {crm.data.relationships
            .filter((relationship) => relationship.productId === productId)
            .map((relationship) => (
              <option key={relationship.id} value={relationship.id}>
                {
                  crm.data.people.find(
                    (person) => person.id === relationship.personId,
                  )?.name
                }
              </option>
            ))}
        </select>
      </label>
      <label>
        {t.internalTasks.timeZone}
        <input
          required
          value={timeZone}
          maxLength={100}
          onChange={(event) => setTimeZone(event.target.value)}
          list="internal-task-zones"
        />
      </label>
      <datalist id="internal-task-zones">
        {[
          ...new Set(["UTC", crm.timeZone, task?.timeZone ?? crm.timeZone]),
        ].map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <label>
        {t.internalTasks.dueAt}
        <input
          name="dueAt"
          type="datetime-local"
          step="0.001"
          required
          defaultValue={
            task ? zonedInputValue(task.dueAt, task.timeZone, true) : ""
          }
        />
      </label>
      <label>
        {t.internalTasks.frequency}
        <select
          value={frequency}
          onChange={(event) =>
            setFrequency(event.target.value as typeof frequency)
          }
        >
          <option value="">{t.internalTasks.none}</option>
          {(["daily", "weekly", "monthly"] as const).map((value) => (
            <option key={value} value={value}>
              {t.internalTasks[value]}
            </option>
          ))}
        </select>
      </label>
      {frequency && (
        <label>
          {t.internalTasks.interval}
          <input
            name="interval"
            type="number"
            min={1}
            max={365}
            step={1}
            required
            defaultValue={task?.recurrence?.interval ?? 1}
          />
        </label>
      )}
      <p className="muted field-hint">{t.internalTasks.note}</p>
    </RecordDialog>
  );
}

export function InternalTasks() {
  const crm = useWorkspaceData();
  const [editor, setEditor] = useState<{ task: InternalTask | null } | null>(
    null,
  );
  const [completed, setCompleted] = useState(false);
  const tasks = (crm.data.internalTasks ?? []).filter(
    (task) =>
      (completed || task.status === "open") &&
      `${task.title} ${task.description}`
        .toLowerCase()
        .includes(crm.search.toLowerCase()),
  );
  const change = async (task: InternalTask, command: "complete" | "reopen") => {
    const result = await crm.send({
      operation: "internal-task-change",
      organizationId: crm.organizationId,
      productId: task.productId,
      taskId: task.id,
      version: task.version,
      command,
    });
    if (result.ok)
      crm.notify(
        command === "complete"
          ? t.internalTasks.completed
          : t.internalTasks.reopened,
        "success",
      );
  };
  return (
    <section className="record-section" aria-label={t.internalTasks.heading}>
      <div className="section-heading">
        <h2>{t.internalTasks.heading}</h2>
        <button
          type="button"
          disabled={crm.busy || !crm.data.products.length}
          onClick={() => {
            if (crm.canLeaveEditor()) setEditor({ task: null });
          }}
        >
          {t.internalTasks.new}
        </button>
      </div>
      <label>
        <input
          type="checkbox"
          checked={completed}
          onChange={(event) => setCompleted(event.target.checked)}
        />
        {t.internalTasks.showCompleted}
      </label>
      {editor && (
        <InternalTaskEditor
          key={editor.task?.id ?? "new"}
          task={editor.task}
          onClose={() => setEditor(null)}
        />
      )}
      {!tasks.length && <p className="muted">{t.internalTasks.empty}</p>}
      {tasks.map((task) => (
        <article key={task.id} className="context-editor-card">
          <div className="section-heading">
            <h3>{task.title}</h3>
            <span className="badge">
              {task.status === "completed" ? t.completed : t.open}
            </span>
          </div>
          <p className="muted">
            {crm.product(task.productId)?.name} · {crm.member(task.ownerId)} ·{" "}
            <time
              dateTime={task.dueAt}
              title={`${task.dueAt} · ${task.timeZone}`}
            >
              {preciseDateLabel(task.dueAt, task.timeZone)} · {task.timeZone}
            </time>
          </p>
          {task.description && <RecordText value={task.description} />}
          {task.relationshipId && (
            <button
              type="button"
              className="text-button"
              onClick={() => crm.openPerson(task.relationshipId ?? "")}
            >
              {crm.personFor(task.relationshipId)?.name}
            </button>
          )}
          {task.recurrence && (
            <p className="muted">
              {t.internalTasks.recurs
                .replace("{interval}", String(task.recurrence.interval))
                .replace(
                  "{frequency}",
                  t.internalTasks[
                    recurrenceUnits[task.recurrence.frequency][
                      task.recurrence.interval === 1 ? 0 : 1
                    ]
                  ],
                )}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={crm.busy}
              onClick={() => {
                if (crm.canLeaveEditor()) setEditor({ task });
              }}
            >
              {t.edit}
            </button>
            <button
              type="button"
              disabled={crm.busy}
              onClick={() =>
                void change(
                  task,
                  task.status === "open" ? "complete" : "reopen",
                )
              }
            >
              {task.status === "open"
                ? t.internalTasks.complete
                : t.internalTasks.reopen}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
