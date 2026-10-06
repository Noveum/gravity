"use client";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { AuthLayout } from "./auth-forms";
import {
  browserNavigation,
  errorText,
  RequestError,
  requestJson,
} from "./client-api";
import { homePath, inviteLinkPath, invitePath, signInPath } from "./routes";

export const inviteTokenKey = "gravity-invite-token";
const signedOutCodes = ["UNAUTHORIZED", "AUTH_UNAVAILABLE"];

interface Preview {
  organizationId: string;
  organizationName: string;
  role: string;
}
type InviteState =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "missing" }
  | { kind: "unavailable"; message: string }
  | { kind: "member"; organizationId: string; organizationName: string }
  | { kind: "ready"; token: string; invitation: Preview };

export function workspaceEntryPath(organizationId: string) {
  return `/api/workspace?${new URLSearchParams({ organizationId, next: homePath })}`;
}

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
function post<T>(operation: string, token: string) {
  return requestJson<T>("/api/crm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, token }),
  });
}

export function InviteFlow() {
  const [state, setState] = useState<InviteState>({ kind: "loading" });
  useEffect(() => {
    const token = takeToken();
    if (!token) {
      setState({ kind: "missing" });
      return;
    }
    let current = true;
    post<Preview>("invitation-preview", token)
      .then((invitation) => {
        if (current) setState({ kind: "ready", token, invitation });
      })
      .catch((error: unknown) => {
        if (!current) return;
        const code = error instanceof Error ? error.message : "";
        const details = error instanceof RequestError ? error.details : {};
        if (signedOutCodes.includes(code)) setState({ kind: "signedOut" });
        else if (
          code === "ALREADY_MEMBER" &&
          typeof details.organizationId === "string" &&
          typeof details.organizationName === "string"
        ) {
          forget();
          setState({
            kind: "member",
            organizationId: details.organizationId,
            organizationName: details.organizationName,
          });
        } else if (code === "NOT_FOUND" || code === "INVALID_INPUT")
          setState({ kind: "missing" });
        else setState({ kind: "unavailable", message: errorText(error) });
      });
    return () => {
      current = false;
    };
  }, []);
  if (state.kind === "loading") return <InviteLoading />;
  if (state.kind === "signedOut")
    return (
      <AuthLayout
        title={t.inviteSignInTitle}
        description={t.inviteSignInDescription}
      >
        <a className="auth-link auth-submit" href={signInPath(invitePath)}>
          {t.inviteSignIn}
        </a>
      </AuthLayout>
    );
  if (state.kind === "member")
    return (
      <AuthLayout
        title={t.inviteAlreadyMemberTitle.replace(
          "{workspace}",
          state.organizationName,
        )}
        description={t.inviteAlreadyMemberDescription}
      >
        <a
          className="auth-link auth-submit"
          href={workspaceEntryPath(state.organizationId)}
        >
          {t.inviteOpenWorkspace.replace("{workspace}", state.organizationName)}
        </a>
      </AuthLayout>
    );
  if (state.kind === "ready") {
    const workspace = state.invitation.organizationName;
    return (
      <AuthLayout
        title={t.inviteTitle.replace("{workspace}", workspace)}
        description={t.inviteDescription
          .replace("{workspace}", workspace)
          .replace(
            "{role}",
            state.invitation.role === "admin"
              ? t.inviteRoleAdmin
              : t.inviteRoleMember,
          )}
      >
        <InviteAcceptance token={state.token} organizationName={workspace} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title={t.inviteUnavailableTitle}
      description={
        state.kind === "unavailable" ? state.message : t.inviteNotFound
      }
    >
      <a className="auth-link auth-provider" href="/">
        {t.brand}
      </a>
    </AuthLayout>
  );
}

function InviteLoading() {
  return (
    <AuthLayout title={t.invitePageTitle} description={t.inviteLoading}>
      <p className="muted" role="status">
        {t.inviteLoading}
      </p>
    </AuthLayout>
  );
}

export function LegacyInviteRedirect({ token }: { token: string }) {
  useEffect(() => {
    browserNavigation.replace(inviteLinkPath(token));
  }, [token]);
  return <InviteLoading />;
}

function InviteAcceptance({
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
      const accepted = await post<{ organizationId: string }>(
        "invitation-accept",
        token,
      );
      forget();
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
