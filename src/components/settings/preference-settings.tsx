"use client";
import { Preferences } from "../preferences";
import { SettingsPanel } from "./settings-ui";

export function PreferenceSettings() {
  return (
    <SettingsPanel section="preferences">
      <Preferences labelled />
    </SettingsPanel>
  );
}
