"use client";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { browserNavigation, errorText, requestJson } from "./client-api";
import { inviteLinkPath, invitePath, signInPath } from "./routes";

export const inviteTokenKey = "gravity-invite-token";
const signedOutCodes = ["UNAUTHORIZED", "AUTH_UNAVAILABLE"];
const tokenFormat = /^[a-f0-9]{64}$/;
const accepted = z.object({ organizationId: z.uuid() });
const previewSchema = z.object({
  organizationId: z.uuid(),
  organizationName: z.string(),
  email: z.email(),
  role: z.enum(["admin", "member"]),
  products: z.array(z.string()),
  alreadyMember: z.boolean(),
});
const workspacePath = (organizationId: string) =>
  `/api/workspace?organizationId=${encodeURIComponent(organizationId)}`;

function remember(token: string) {
  try {
    sessionStorage.setItem(inviteTokenKey, token);
  } catch {}
}
function recalled() {
  try {
    return sessionStorage.getItem(inviteTokenKey) ?? "";
  } catch {
    return "";
  }
}
function forget() {
  try {
    sessionStorage.removeItem(inviteTokenKey);
  } catch {}
}
function takeToken() {
  const fragment = window.location.hash.slice(1);
  if (!fragment) return recalled();
  let token = fragment;
  try {
    token = decodeURIComponent(fragment);
  } catch {}
  remember(token);
  window.history.replaceState(window.history.state, "", invitePath);
  return token;
}
function post(operation: string, token: string) {
  return requestJson<unknown>("/api/crm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, token }),
  });
}

export function LegacyInviteRedirect({ token }: { token: string }) {
  useEffect(() => {
    browserNavigation.replace(inviteLinkPath(token));
  }, [token]);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>{t.joinWorkspace}</h1>
        <p role="status">{t.loading}</p>
      </section>
    </main>
  );
}

export function InviteAccept() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [requiresAccountSwitch, setRequiresAccountSwitch] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(
    null,
  );
  const submitting = useRef(false);
  useEffect(() => {
    const current = takeToken();
    if (!tokenFormat.test(current)) {
      setError(t.errors.INVITE_UNAVAILABLE);
      return;
    }
    setToken(current);
    let active = true;
    post("invitation-preview", current)
      .then((value) => {
        const parsed = previewSchema.parse(value);
        if (!active) return;
        if (parsed.alreadyMember) forget();
        setPreview(parsed);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const code = error instanceof Error ? error.message : "";
        if (signedOutCodes.includes(code)) {
          browserNavigation.assign(signInPath(invitePath));
          return;
        }
        setError(errorText(error));
        setRequiresAccountSwitch(code === "INVITE_EMAIL_MISMATCH");
      });
    return () => {
      active = false;
    };
  }, []);
  const member = preview?.alreadyMember ? preview : null;
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>
          {member
            ? t.inviteAlreadyMemberTitle.replace(
                "{workspace}",
                member.organizationName,
              )
            : t.joinWorkspace}
        </h1>
        <p className="muted">
          {member ? t.inviteAlreadyMemberDescription : t.acceptInvitationDetail}
        </p>
        {preview && !member && (
          <section className="settings-card">
            <h2>{preview.organizationName}</h2>
            <p>{preview.email}</p>
            <h3>{t.invitedAccess}</h3>
            <p>{preview.role === "admin" ? t.admin : t.member}</p>
            <p className="muted">
              {preview.role === "admin"
                ? t.adminAccessDetail
                : preview.products.join(", ")}
            </p>
          </section>
        )}
        {!preview && !error && <p role="status">{t.loading}</p>}
        {member ? (
          <a
            className="primary auth-link"
            href={workspacePath(member.organizationId)}
          >
            {t.inviteOpenWorkspace.replace(
              "{workspace}",
              member.organizationName,
            )}
          </a>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={busy || !preview}
            onClick={async () => {
              if (submitting.current) return;
              submitting.current = true;
              setBusy(true);
              setError("");
              try {
                const result = accepted.parse(
                  await post("invitation-accept", token),
                );
                forget();
                browserNavigation.assign(workspacePath(result.organizationId));
              } catch (error) {
                setError(errorText(error));
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? t.saving : t.acceptInvitation}
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {requiresAccountSwitch && (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await requestJson("/api/auth/sign-out", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                browserNavigation.assign(signInPath(invitePath));
              } catch (error) {
                setError(errorText(error));
                setBusy(false);
              }
            }}
          >
            {t.inviteSignOut}
          </button>
        )}
        <a className="auth-link" href="/overview">
          {t.backToWorkspace}
        </a>
      </section>
    </main>
  );
}
