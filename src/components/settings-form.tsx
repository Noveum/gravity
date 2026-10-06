"use client";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { errorText, type Organization } from "./client-api";

export function SettingsForm({
  organization,
  disabled,
  mutate,
  onOrganizations,
}: {
  organization: Organization;
  disabled: boolean;
  mutate: (body: object) => Promise<boolean>;
  onOrganizations: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  return (
    <form
      className="organization-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || disabled) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
          if (
            await mutate({
              operation: "organization-settings",
              organizationId: organization.id,
              name: values.get("name"),
              timezone: values.get("timezone"),
            })
          )
            await onOrganizations();
        } catch (error) {
          setError(errorText(error));
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || disabled}>
        <label>
          {t.organizationName}
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={organization.name}
          />
        </label>
        <label>
          {t.timezone}
          <input
            name="timezone"
            required
            maxLength={100}
            defaultValue={organization.timezone}
            list="organization-timezones"
          />
        </label>
        <datalist id="organization-timezones">
          {Intl.supportedValuesOf("timeZone").map((zone) => (
            <option value={zone} key={zone} />
          ))}
          <option value="UTC" />
        </datalist>
        <p className="muted">{t.organizationTimezoneDetail}</p>
        {!disabled && (
          <button type="submit" className="secondary">
            {busy ? t.saving : t.saveChanges}
          </button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
