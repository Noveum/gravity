"use client";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useState } from "react";

export function TimeZoneSelect({ disabled = false }: { disabled?: boolean }) {
  const [timezone, setTimezone] = useState("UTC");
  const [zones, setZones] = useState(["UTC"]);
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
    <label>
      {t.organizationTimezone}
      <select
        name="timezone"
        value={timezone}
        disabled={disabled}
        onChange={(event) => setTimezone(event.target.value)}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
    </label>
  );
}
