"use client";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useState } from "react";
export function Preferences() {
  const [theme, setTheme] = useState("system");
  const [density, setDensity] = useState("comfortable");
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    function restore() {
      let selected = "system",
        rows = "comfortable";
      try {
        selected = localStorage.getItem("gravity-theme") || selected;
        rows = localStorage.getItem("gravity-density") || rows;
      } catch {}
      setTheme(selected);
      setDensity(rows);
      document.documentElement.dataset.theme =
        selected === "system" ? (query.matches ? "dark" : "light") : selected;
      document.documentElement.dataset.density = rows;
    }
    restore();
    query.addEventListener("change", restore);
    window.addEventListener("storage", restore);
    return () => {
      query.removeEventListener("change", restore);
      window.removeEventListener("storage", restore);
    };
  }, []);
  return (
    <div className="preferences">
      <select
        aria-label={t.appearance}
        value={theme}
        onChange={(e) => {
          const next = e.target.value;
          setTheme(next);
          document.documentElement.dataset.theme =
            next === "system"
              ? window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light"
              : next;
          try {
            localStorage.setItem("gravity-theme", next);
          } catch {}
        }}
      >
        <option value="system">{t.system}</option>
        <option value="light">{t.light}</option>
        <option value="dark">{t.dark}</option>
      </select>
      <select
        aria-label={t.density}
        value={density}
        onChange={(e) => {
          setDensity(e.target.value);
          document.documentElement.dataset.density = e.target.value;
          try {
            localStorage.setItem("gravity-density", e.target.value);
          } catch {}
        }}
      >
        <option value="comfortable">{t.comfortable}</option>
        <option value="compact">{t.compact}</option>
      </select>
    </div>
  );
}
