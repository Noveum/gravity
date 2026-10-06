import t from "@crm/i18n/translations/en.json";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSettingsSection } from "@/components/routes";
import { SettingsView } from "@/components/views/settings-view";
import { pageTitle } from "../../page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  return pageTitle(
    isSettingsSection(section)
      ? `${t.settingsSections[section]} · ${t.settings}`
      : t.settings,
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isSettingsSection(section)) notFound();
  return <SettingsView />;
}
