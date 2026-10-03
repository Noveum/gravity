"use client";
import t from "@crm/i18n/translations/en.json";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, requestJson } from "./client-api";
import { submitOnModEnter } from "./modal-lifecycle";
import { Preferences } from "./preferences";
import {
  type WorkspaceResult,
  workspaceDestination,
} from "./workspace-destination";

export function WorkspaceSetup({
  onCreated,
  oauthQuery = "",
}: {
  oauthQuery?: string;
  onCreated?: (result: WorkspaceResult) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [zones, setZones] = useState(["UTC"]);
  const submitting = useRef(false);
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setZones(
      [
        ...new Set(["UTC", detected, ...Intl.supportedValuesOf("timeZone")]),
      ].sort(),
    );
    setTimezone(detected);
  }, []);
  return (
    <main className="setup-page">
      <header className="setup-brand">
        <span className="brand-icon">
          <Sparkles size={18} />
        </span>
        <strong>{t.brand}</strong>
        <Preferences />
      </header>
      <div className="setup-layout">
        <aside className="setup-intro">
          <span className="eyebrow">{t.workspaceSetup}</span>
          <h1>{t.workspaceSetupTitle}</h1>
          <p>{t.workspaceSetupDescription}</p>
          <ol className="setup-steps">
            {[
              t.setupStepWorkspace,
              t.setupStepPeople,
              t.setupStepConnections,
            ].map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="muted">{t.setupPrivacy}</p>
          <a href="/">{t.backToWorkspace}</a>
        </aside>
        <section className="setup-form-card" aria-label={t.workspaceSetup}>
          <h2>{t.setupStepWorkspace}</h2>
          <p className="muted">{t.setupProductHint}</p>
          <form
            onKeyDown={submitOnModEnter}
            onSubmit={async (event) => {
              event.preventDefault();
              if (submitting.current) return;
              const values = new FormData(event.currentTarget);
              submitting.current = true;
              setBusy(true);
              setError("");
              try {
                const result = await requestJson<WorkspaceResult>("/api/crm", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    operation: "workspace",
                    name: values.get("name"),
                    productName: values.get("productName"),
                    timezone: values.get("timezone"),
                  }),
                });
                if (onCreated) await onCreated(result);
                else
                  window.location.assign(
                    workspaceDestination(result, oauthQuery),
                  );
              } catch (cause) {
                setError(errorText(cause));
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            <fieldset className="dialog-fields" disabled={busy}>
              <label>
                {t.organizationName}
                <input
                  name="name"
                  required
                  maxLength={100}
                  autoComplete="organization"
                />
              </label>
              <label>
                {t.firstProduct}
                <input name="productName" required maxLength={100} />
              </label>
              <label>
                {t.organizationTimezone}
                <select
                  name="timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <p className="setup-included">
              <Check size={14} />
              {t.setupIncluded}
            </p>
            {error && <p role="alert">{error}</p>}
            <button
              className="primary"
              type="submit"
              title={t.submitHint}
              disabled={busy}
            >
              {busy ? t.saving : t.createWorkspace}
              <ArrowRight size={15} />
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
