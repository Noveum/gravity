"use client";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useState } from "react";

export function TimeZoneSelect({
  disabled = false,
  initial = "",
  className,
}: {
  disabled?: boolean;
  initial?: string;
  className?: string;
}) {
  const [timezone, setTimezone] = useState(initial || "UTC");
  const [zones, setZones] = useState([initial || "UTC"]);
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const chosen = initial || detected;
    setZones(
      [
        ...new Set(["UTC", chosen, ...Intl.supportedValuesOf("timeZone")]),
      ].sort(),
    );
    setTimezone(chosen);
  }, [initial]);
  return (
    <label className={className}>
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
