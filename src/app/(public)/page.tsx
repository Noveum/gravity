import { siteCopy } from "@crm/public-site/content";
import { publicMetadata } from "@crm/public-site/metadata";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/public-site/landing-page";
import { legacyDestination } from "@/components/routes";

export const metadata = publicMetadata(
  siteCopy.metaTitle,
  siteCopy.metaDescription,
  "/",
);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Existing workspace links and provider callbacks still select the CRM context.
  if (
    ["view", "workspace", "organizationId", "productId"].some(
      (key) => key in query,
    )
  )
    redirect(legacyDestination(query));
  return <LandingPage />;
}
