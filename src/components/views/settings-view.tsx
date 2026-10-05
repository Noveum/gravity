"use client";
import t from "@crm/i18n/translations/en.json";
import { label } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { Preferences } from "../preferences";
import { SettingsForm } from "../settings-form";
import { ShortcutHint } from "../ui/shortcut-hint";

export function SettingsView() {
  const crm = useWorkspaceData();
  return (
    <div className="page-content">
      <section className="settings-section">
        <h2>{t.preferences}</h2>
        <p className="muted">{t.preferencesDetail}</p>
        <Preferences labelled />
      </section>
      <p className="callout">{t.organizationIsolation}</p>
      <a className="auth-link" href="/onboarding">
        {t.createWorkspace} <ShortcutHint id="create-organization" />
      </a>
      <SettingsForm
        organizationId={crm.organizationId}
        canCreateProduct={crm.isAdmin}
        mutate={crm.mutate}
        onOrganizations={async () => {
          await crm.reloadOrganizations();
        }}
      />
      <h2 className="spaced">{t.products}</h2>
      {crm.data.products.map((product) => (
        <div className="setting-row" key={product.id}>
          <span className="product-dot" style={{ background: product.color }} />
          {product.name}
        </div>
      ))}
      <h2 className="spaced">{t.members}</h2>
      {crm.data.members.map((member) => (
        <div className="setting-row" key={member.id}>
          <span>{member.name}</span>
          <span className="badge">{label(member.role)}</span>
        </div>
      ))}
    </div>
  );
}
