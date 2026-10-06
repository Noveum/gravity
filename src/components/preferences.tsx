"use client";
import t from "@crm/i18n/translations/en.json";
import { Moon, Sun } from "lucide-react";
import {
  setDensity,
  setThemePreference,
  toggleTheme,
  useAppearance,
} from "./appearance";
import { Select } from "./ui/select";

export function Preferences({
  showDensity = true,
  labelled = false,
}: {
  showDensity?: boolean;
  labelled?: boolean;
} = {}) {
  const appearance = useAppearance();
  const theme = (
    <Select
      label={t.appearance}
      value={appearance.theme}
      options={[
        { value: "system", label: t.system },
        { value: "light", label: t.light },
        { value: "dark", label: t.dark },
      ]}
      onChange={(value) => {
        if (value === "system" || value === "light" || value === "dark")
          setThemePreference(value);
      }}
    />
  );
  const rows = (
    <Select
      label={t.density}
      value={appearance.density}
      options={[
        { value: "compact", label: t.compact },
        { value: "comfortable", label: t.comfortable },
      ]}
      onChange={(value) => {
        if (value === "compact" || value === "comfortable") setDensity(value);
      }}
    />
  );
  return (
    <div className={labelled ? "preference-fields" : "preferences"}>
      {labelled ? (
        <div className="field">
          <span>{t.appearance}</span>
          {theme}
        </div>
      ) : (
        theme
      )}
      {showDensity &&
        (labelled ? (
          <div className="field">
            <span>{t.density}</span>
            {rows}
          </div>
        ) : (
          rows
        ))}
    </div>
  );
}
export function ThemeToggle() {
  const dark = useAppearance().resolved === "dark";
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
