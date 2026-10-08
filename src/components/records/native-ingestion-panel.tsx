"use client";
import { instantFromZonedInput } from "@crm/core/calendar";
import type { JsonValue } from "@crm/core/dto";
import type { NativeIngestionService } from "@crm/core/native-ingestion";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { errorText, label, requestJson } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { RecordDialog } from "./record-dialog";

type Draft = JsonValue<Awaited<ReturnType<NativeIngestionService["draft"]>>>;
type DraftPage = JsonValue<
  Awaited<ReturnType<NativeIngestionService["drafts"]>>
>;
type Editor = {
  kind: "history" | "draft" | "schedule";
  draft?: Draft;
  timeZone?: string;
};
const field = (fields: FormData, name: string) =>
  String(fields.get(name) ?? "");

export function NativeIngestionPanel({
  relationshipId,
  productId,
}: {
  relationshipId: string;
  productId: string;
}) {
  const crm = useCrm();
  const [editor, setEditor] = useState<Editor | null>(null);
  const inputTimeZone = editor?.timeZone ?? crm.timeZone;
  const [loaded, setLoaded] = useState<{
    key: string;
    items: Draft[];
    nextCursor: string | null;
    busy: boolean;
    error: string;
  }>({ key: "", items: [], nextCursor: null, busy: false, error: "" });
  const [generation, setGeneration] = useState(0);
  const requestKey = `${crm.organizationId}:${relationshipId}:${productId}:${generation}`;
  const activeKey = useRef(requestKey);
  activeKey.current = requestKey;
  const pending = useRef<AbortController | null>(null);
  const drafts = loaded.key === requestKey ? loaded.items : [];
  const error = loaded.key === requestKey ? loaded.error : "";
  useEffect(() => {
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    const query = new URLSearchParams({
      operation: "native-drafts",
      organizationId: crm.organizationId,
      relationshipId,
      productId,
      limit: "100",
    });
    requestJson<DraftPage>(`/api/crm?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted && activeKey.current === requestKey)
          setLoaded({ key: requestKey, ...result, busy: false, error: "" });
      })
      .catch((cause) => {
        if (!controller.signal.aborted && activeKey.current === requestKey)
          setLoaded({
            key: requestKey,
            items: [],
            nextCursor: null,
            busy: false,
            error: errorText(cause),
          });
      })
      .finally(() => {
        if (pending.current === controller) pending.current = null;
      });
    return () => {
      controller.abort();
      pending.current?.abort();
      pending.current = null;
    };
  }, [crm.organizationId, relationshipId, productId, requestKey]);
  async function loadMore() {
    if (
      loaded.key !== requestKey ||
      !loaded.nextCursor ||
      loaded.busy ||
      pending.current
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    setLoaded((prior) => ({ ...prior, busy: true, error: "" }));
    const query = new URLSearchParams({
      operation: "native-drafts",
      organizationId: crm.organizationId,
      relationshipId,
      productId,
      limit: "100",
      cursor: loaded.nextCursor,
    });
    try {
      const result = await requestJson<DraftPage>(`/api/crm?${query}`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted && activeKey.current === requestKey)
        setLoaded((prior) =>
          prior.key === requestKey
            ? {
                ...prior,
                items: [
                  ...prior.items,
                  ...result.items.filter(
                    (item) =>
                      !prior.items.some((existing) => existing.id === item.id),
                  ),
                ],
                nextCursor: result.nextCursor,
                busy: false,
                error: "",
              }
            : prior,
        );
    } catch (cause) {
      if (!controller.signal.aborted && activeKey.current === requestKey)
        setLoaded((prior) =>
          prior.key === requestKey
            ? { ...prior, busy: false, error: errorText(cause) }
            : prior,
        );
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  const changed = () => {
    setGeneration((value) => value + 1);
    void crm.refresh();
  };
  async function submit(fields: FormData) {
    if (!editor) return t.errors.INVALID_INPUT;
    const scope = {
      organizationId: crm.organizationId,
      productId,
      relationshipId,
    };
    let input: Record<string, unknown>;
    if (editor.kind === "history") {
      const occurredAt = instantFromZonedInput(
        field(fields, "occurredAt"),
        field(fields, "timeZone"),
      );
      if (!occurredAt) return t.errors.INVALID_INPUT;
      input = {
        ...scope,
        operation: "ingest-history",
        channel: field(fields, "channel"),
        sourceThreadId: field(fields, "sourceThreadId"),
        messages: [
          {
            sourceMessageId: field(fields, "sourceMessageId"),
            direction: field(fields, "direction"),
            body: field(fields, "body"),
            occurredAt,
          },
        ],
      };
    } else if (editor.kind === "schedule") {
      const dueAt = instantFromZonedInput(
        field(fields, "dueAt"),
        field(fields, "timeZone"),
      );
      if (!dueAt || !editor.draft) return t.errors.INVALID_INPUT;
      input = {
        ...scope,
        operation: "schedule-native-draft",
        draftId: editor.draft.id,
        version: editor.draft.version,
        dueAt,
      };
    } else {
      input = {
        ...scope,
        operation: editor.draft ? "edit-native-draft" : "ingest-draft",
        channel: field(fields, "channel"),
        title: field(fields, "title"),
        reason: field(fields, "reason"),
        body: field(fields, "body"),
        ...(editor.draft
          ? { draftId: editor.draft.id, version: editor.draft.version }
          : { sourceId: field(fields, "sourceId") }),
      };
    }
    try {
      await requestJson("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      changed();
      return null;
    } catch (cause) {
      return errorText(cause, crm.timeZone);
    }
  }
  return (
    <section
      className="conversation-history"
      aria-label={t.nativeIngestion.title}
    >
      <div className="section-heading">
        <h3>{t.nativeIngestion.title}</h3>
      </div>
      <p className="muted">{t.nativeIngestion.privateHint}</p>
      <div className="record-actions">
        <button
          type="button"
          className="small"
          onClick={() => setEditor({ kind: "history" })}
        >
          {t.nativeIngestion.addHistory}
        </button>
        <button
          type="button"
          className="small"
          onClick={() => setEditor({ kind: "draft" })}
        >
          {t.nativeIngestion.addDraft}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!drafts.length && !error && (
        <p className="muted">{t.nativeIngestion.noDrafts}</p>
      )}
      {drafts.map((draft) => (
        <article className="conversation-card" key={draft.id}>
          <header>
            <strong>{draft.title}</strong>
            <span>{label(draft.channel)}</span>
          </header>
          <p>{draft.body}</p>
          {draft.reason && <p className="muted">{draft.reason}</p>}
          <p className="muted">
            {draft.scheduledActionId
              ? t.nativeIngestion.scheduled
              : t.nativeIngestion.undated}
          </p>
          {!draft.scheduledActionId && (
            <div className="record-actions">
              <button
                type="button"
                className="small"
                onClick={() => setEditor({ kind: "draft", draft })}
              >
                {t.nativeIngestion.edit}
              </button>
              <button
                type="button"
                className="small"
                onClick={() => setEditor({ kind: "schedule", draft })}
              >
                {t.nativeIngestion.schedule}
              </button>
            </div>
          )}
        </article>
      ))}
      {loaded.key === requestKey && loaded.nextCursor && (
        <button
          type="button"
          className="small"
          disabled={loaded.busy}
          onClick={() => void loadMore()}
        >
          {loaded.busy ? t.loading : t.nativeIngestion.loadMoreDrafts}
        </button>
      )}
      {editor && (
        <RecordDialog
          title={
            editor.kind === "history"
              ? t.nativeIngestion.addHistory
              : editor.kind === "schedule"
                ? t.nativeIngestion.schedule
                : editor.draft
                  ? t.nativeIngestion.edit
                  : t.nativeIngestion.addDraft
          }
          submitLabel={
            editor.kind === "history"
              ? t.nativeIngestion.record
              : editor.kind === "schedule"
                ? t.nativeIngestion.schedule
                : t.nativeIngestion.saveDraft
          }
          onClose={() => setEditor(null)}
          onSubmit={submit}
        >
          {editor.kind !== "schedule" && (
            <>
              <label>
                {t.channel}
                <select
                  name="channel"
                  defaultValue={editor.draft?.channel ?? "gmail"}
                  disabled={!!editor.draft}
                >
                  <option value="gmail">{label("gmail")}</option>
                  <option value="linkedin">{label("linkedin")}</option>
                </select>
                {editor.draft && (
                  <input
                    type="hidden"
                    name="channel"
                    value={editor.draft.channel}
                  />
                )}
              </label>
              {editor.kind === "history" ? (
                <>
                  <label>
                    {t.nativeIngestion.sourceThread}
                    <input
                      name="sourceThreadId"
                      data-primary-field
                      required
                      maxLength={500}
                    />
                  </label>
                  <label>
                    {t.nativeIngestion.sourceMessage}
                    <input name="sourceMessageId" required maxLength={500} />
                  </label>
                  <p className="field-hint">{t.nativeIngestion.sourceHint}</p>
                  <label>
                    {t.nativeIngestion.direction}
                    <select name="direction">
                      <option value="inbound">{t.incoming}</option>
                      <option value="outbound">{t.outgoing}</option>
                    </select>
                  </label>
                  <label>
                    {t.nativeIngestion.occurredAt}
                    <input
                      name="occurredAt"
                      type="datetime-local"
                      step="0.001"
                      required
                    />
                  </label>
                </>
              ) : (
                <>
                  {!editor.draft && (
                    <>
                      <label>
                        {t.nativeIngestion.sourceDraft}
                        <input
                          name="sourceId"
                          data-primary-field
                          required
                          maxLength={500}
                        />
                      </label>
                      <p className="field-hint">
                        {t.nativeIngestion.sourceHint}
                      </p>
                    </>
                  )}
                  <label>
                    {t.actionTitle}
                    <input
                      name="title"
                      defaultValue={editor.draft?.title ?? ""}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    {t.reason}
                    <textarea
                      name="reason"
                      defaultValue={editor.draft?.reason ?? ""}
                      maxLength={10000}
                      rows={3}
                    />
                  </label>
                </>
              )}
              <label>
                {editor.kind === "history"
                  ? t.nativeIngestion.body
                  : t.nativeIngestion.draftBody}
                <textarea
                  name="body"
                  defaultValue={editor.draft?.body ?? ""}
                  maxLength={editor.kind === "history" ? 60000 : 20000}
                  required
                  rows={8}
                />
              </label>
            </>
          )}
          {editor.kind === "schedule" && (
            <label>
              {t.nativeIngestion.dueAt}
              <input
                name="dueAt"
                data-primary-field
                type="datetime-local"
                step="0.001"
                required
              />
            </label>
          )}
          {editor.kind !== "draft" && (
            <>
              <label>
                {t.timezone}
                <select
                  name="timeZone"
                  value={inputTimeZone}
                  onChange={(event) =>
                    setEditor({ ...editor, timeZone: event.target.value })
                  }
                >
                  {[...new Set([crm.timeZone, "UTC"])].map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-hint">
                {t.nativeIngestion.zone.replace("{zone}", inputTimeZone)}
              </p>
            </>
          )}
        </RecordDialog>
      )}
    </section>
  );
}
