"use client";
import t from "@crm/i18n/translations/en.json";
import { Moon, Sun } from "lucide-react";
import { useId } from "react";
import {
  type Density,
  setDensity,
  setThemePreference,
  type ThemePreference,
  toggleTheme,
  useAppearance,
} from "./appearance";

export function Preferences({
  showDensity = true,
  labelled = false,
}: {
  showDensity?: boolean;
  labelled?: boolean;
} = {}) {
  const appearance = useAppearance();
  const id = useId();
  const theme = (
    <select
      id={`${id}-theme`}
      aria-label={t.appearance}
      value={appearance.theme}
      onChange={(event) =>
        setThemePreference(event.target.value as ThemePreference)
      }
    >
      <option value="system">{t.system}</option>
      <option value="light">{t.light}</option>
      <option value="dark">{t.dark}</option>
    </select>
  );
  const rows = (
    <select
      id={`${id}-density`}
      aria-label={t.density}
      value={appearance.density}
      onChange={(event) => setDensity(event.target.value as Density)}
    >
      <option value="compact">{t.compact}</option>
      <option value="comfortable">{t.comfortable}</option>
    </select>
  );
  if (labelled)
    return (
      <div className="preference-fields">
        <label className="field" htmlFor={`${id}-theme`}>
          <span>{t.appearance}</span>
          {theme}
        </label>
        {showDensity && (
          <label className="field" htmlFor={`${id}-density`}>
            <span>{t.density}</span>
            {rows}
          </label>
        )}
      </div>
    );
  return (
    <div className="preferences">
      {theme}
      {showDensity && rows}
    </div>
  );
}

export function ThemeToggle() {
  const { resolved } = useAppearance();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      className="ghost icon-button"
      aria-label={t.toggleTheme}
      aria-pressed={dark}
      aria-keyshortcuts="Meta+Shift+L Control+Shift+L"
      title={dark ? t.useLightTheme : t.useDarkTheme}
      onClick={toggleTheme}
    >
      {dark ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}
