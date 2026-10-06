"use client";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { browserNavigation, errorText, requestJson } from "./client-api";
import { homePath } from "./routes";

export function workspaceEntryPath(organizationId: string) {
  return `/api/workspace?${new URLSearchParams({ organizationId, next: homePath })}`;
}
export function InviteAcceptance({
  token,
  organizationName,
}: {
  token: string;
  organizationName: string;
}) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState("");
  async function accept() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const accepted = await requestJson<{ organizationId: string }>(
        "/api/crm",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "invitation-accept", token }),
        },
      );
      const target = workspaceEntryPath(accepted.organizationId);
      setJoined(target);
      browserNavigation.assign(target);
    } catch (cause) {
      setError(errorText(cause));
      submitting.current = false;
      setBusy(false);
    }
  }
  if (joined)
    return (
      <>
        <p role="status">
          {t.inviteAccepted.replace("{workspace}", organizationName)}
        </p>
        <a className="auth-link auth-submit" href={joined}>
          {t.inviteOpenWorkspace.replace("{workspace}", organizationName)}
        </a>
      </>
    );
  return (
    <>
      {error && (
        <p className="callout" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="auth-submit"
        disabled={busy}
        onClick={() => void accept()}
      >
        {busy ? t.inviteAccepting : t.inviteAccept}
      </button>
      <a className="auth-link auth-provider" href={homePath}>
        {t.inviteDecline}
      </a>
    </>
  );
}
