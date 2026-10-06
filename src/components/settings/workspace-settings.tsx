"use client";
import t from "@crm/i18n/translations/en.json";
import { type FormEvent, useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import { settingsPath } from "../routes";
import { TimeZoneSelect } from "../time-zone-select";
import { ShortcutHint } from "../ui/shortcut-hint";
import { reopenWorkspace } from "../workspace-preference";
import { AdminNotice, SettingsPanel } from "./settings-ui";

const domainList = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((domain) => domain.trim())
    .filter(Boolean);
const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function WorkspaceSettings() {
  const crm = useWorkspaceData();
  const organization = crm.currentOrg;
  const [busy, setBusy] = useState(false);
  const editable = crm.isAdmin;
  if (!organization) return null;
  const domains = organization.allowedEmailDomains ?? [];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || busy) return;
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") ?? "").trim();
    const timezone = String(values.get("timezone") ?? "");
    const slug = String(values.get("slug") ?? "").trim();
    const allowed = domainList(String(values.get("domains") ?? ""));
    const changes = {
      ...(name !== organization.name ? { name } : {}),
      ...(timezone && timezone !== organization.timezone ? { timezone } : {}),
      ...(slug !== organization.slug ? { slug } : {}),
      ...(!sameList(allowed, domains) ? { allowedEmailDomains: allowed } : {}),
    };
    if (!Object.keys(changes).length) return;
    setBusy(true);
    try {
      const { ok } = await crm.send(
        {
          operation: "workspace-settings",
          organizationId: organization.id,
          ...changes,
        },
        t.workspaceSaved,
      );
      if (!ok) return;
      await crm.reloadOrganizations();
      if ("slug" in changes)
        reopenWorkspace(
          organization.id,
          settingsPath("workspace"),
          crm.productId,
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsPanel section="workspace">
      <form
        key={`${organization.id}:${organization.name}:${organization.slug}:${organization.timezone}:${domains.join(",")}`}
        className="settings-form"
        onSubmit={save}
      >
        <label className="field">
          <span>{t.workspaceName}</span>
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={organization.name}
            disabled={!editable || busy}
          />
        </label>
        <TimeZoneSelect
          className="field"
          initial={organization.timezone}
          disabled={!editable || busy}
        />
        <div className="field">
          <label htmlFor="workspace-slug">{t.workspaceSlug}</label>
          <input
            id="workspace-slug"
            name="slug"
            required
            minLength={3}
            maxLength={63}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            defaultValue={organization.slug}
            disabled={!editable || busy}
            aria-describedby="workspace-slug-hint"
          />
          <small id="workspace-slug-hint">{t.workspaceSlugHint}</small>
        </div>
        <div className="field wide">
          <label htmlFor="workspace-domains">{t.allowedDomains}</label>
          <textarea
            id="workspace-domains"
            name="domains"
            rows={3}
            defaultValue={domains.join("\n")}
            disabled={!editable || busy}
            aria-describedby="workspace-domains-hint"
          />
          <small id="workspace-domains-hint">{t.allowedDomainsHint}</small>
        </div>
        <div className="settings-form-actions">
          {editable ? (
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t.saving : t.save}
            </button>
          ) : (
            <AdminNotice />
          )}
        </div>
      </form>
      <p className="settings-note">{t.organizationIsolation}</p>
      <a className="text-button settings-link" href="/onboarding">
        {t.createAnotherWorkspace} <ShortcutHint id="create-organization" />
      </a>
    </SettingsPanel>
  );
}
