import t from "@crm/i18n/translations/en.json";
import type { Metadata } from "next";

export const pageTitle = (name: string): Metadata => ({
  title: `${name} · ${t.brand}`,
});
