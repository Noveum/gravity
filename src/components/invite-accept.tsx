"use client";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { errorText, requestJson } from "./client-api";
import { browserNavigation } from "./shell/user-menu";

const accepted = z.object({ organizationId: z.uuid() });
const previewSchema = z.object({
  organizationName: z.string(),
  email: z.email(),
  role: z.enum(["admin", "member"]),
  products: z.array(z.string()),
});
export function InviteAccept({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? "" : t.errors.INVITE_UNAVAILABLE);
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(
    null,
  );
  const submitting = useRef(false);
  useEffect(() => {
    if (!token) return;
    let active = true;
    requestJson<unknown>(
      `/api/crm?operation=invitation-preview&token=${encodeURIComponent(token)}`,
    )
      .then((value) => {
        const parsed = previewSchema.parse(value);
        if (active) setPreview(parsed);
      })
      .catch((error: unknown) => {
        if (active) setError(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>{t.joinWorkspace}</h1>
        <p className="muted">{t.acceptInvitationDetail}</p>
        {preview && (
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
                await requestJson<unknown>("/api/crm", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    operation: "invitation-accept",
                    token,
                  }),
                }),
              );
              browserNavigation.assign(
                `/api/workspace?organizationId=${encodeURIComponent(result.organizationId)}`,
              );
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
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
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
              browserNavigation.assign(
                `/sign-in?callbackURL=${encodeURIComponent(`/invite/${token}`)}`,
              );
            } catch (error) {
              setError(errorText(error));
              setBusy(false);
            }
          }}
        >
          {t.inviteSignOut}
        </button>
      </section>
    </main>
  );
}
