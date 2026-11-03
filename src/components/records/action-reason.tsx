"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useState } from "react";
import { useCrm } from "../crm/crm-context";
import { submitOnSaveKey } from "../modal-lifecycle";
import { ImportedContext } from "./imported-context";
import { RecordText } from "./record-text";

export function ActionReason({
  action,
}: {
  action: ClientSnapshot["actions"][number];
}) {
  const { busy, send, organizationId } = useCrm();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(action.reason);
  const [original, setOriginal] = useState({
    reason: action.reason,
    version: action.version,
  });
  const [error, setError] = useState("");
  return (
    <div>
      <RecordText value={action.reason} />
      {action.reasonSource && (
        <ImportedContext
          source={action.reasonSource}
          title={t.actionReasons.original}
        />
      )}
      {editing ? (
        <form
          data-record-editor
          data-dirty={reason !== original.reason ? "true" : undefined}
          onKeyDown={submitOnSaveKey}
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await send(
              {
                operation: "action-details",
                organizationId,
                productId: action.productId,
                actionId: action.id,
                version: original.version,
                reason,
              },
              true,
              false,
            );
            if (result.ok) setEditing(false);
            else setError(result.error ?? t.errors.INVALID_INPUT);
          }}
        >
          <label>
            {t.reason}
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={10000}
              rows={5}
              disabled={busy}
            />
          </label>
          <p className="muted">{t.actionReasons.hint}</p>
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || reason === original.reason}
            >
              {busy ? t.saving : t.save}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="small"
          disabled={busy}
          onClick={() => {
            setReason(action.reason);
            setOriginal({ reason: action.reason, version: action.version });
            setError("");
            setEditing(true);
          }}
        >
          {t.actionReasons.edit}
        </button>
      )}
    </div>
  );
}
