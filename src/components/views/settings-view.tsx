"use client";
import type { ComponentType } from "react";
import { useCrm } from "../crm/crm-context";
import {
  type SettingsSection,
  settingsSectionFor,
  settingsSections,
} from "../routes";
import { AssistantSettings } from "../settings/assistant-settings";
import { ConnectionSettings } from "../settings/connection-settings";
import { PreferenceSettings } from "../settings/preference-settings";
import { ProductSettings } from "../settings/product-settings";
import { SettingsNav } from "../settings/settings-nav";
import { WorkspaceSettings } from "../settings/workspace-settings";

const panels: Partial<Record<SettingsSection, ComponentType>> = {
  workspace: WorkspaceSettings,
  brands: ProductSettings,
  connections: ConnectionSettings,
  assistants: AssistantSettings,
  preferences: PreferenceSettings,
};
const available = settingsSections.filter((section) => panels[section]);

export function SettingsView() {
  const { pathname } = useCrm();
  const requested = settingsSectionFor(pathname);
  const section =
    requested && panels[requested] ? requested : ("workspace" as const);
  const Panel = panels[section] ?? WorkspaceSettings;
  return (
    <div className="settings-layout">
      <SettingsNav sections={available} current={section} />
      <div className="settings-content">
        <Panel />
      </div>
    </div>
  );
}
