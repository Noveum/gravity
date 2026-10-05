import t from "@crm/i18n/translations/en.json";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isOutreachTab } from "@/components/routes";
import { OutreachView } from "@/components/views/outreach-view";
import { pageTitle } from "../../page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tab: string }>;
}): Promise<Metadata> {
  const { tab } = await params;
  return pageTitle(
    isOutreachTab(tab) ? `${t.outreachTabs[tab]} · ${t.outreach}` : t.outreach,
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  if (!isOutreachTab(tab)) notFound();
  return <OutreachView />;
}
