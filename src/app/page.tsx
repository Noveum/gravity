import { redirect } from "next/navigation";
import { homePath } from "@/components/routes";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const link = new URLSearchParams();
  for (const key of ["workspace", "organizationId", "productId"]) {
    const value = query[key];
    if (typeof value === "string" && value) link.set(key, value);
  }
  if (link.has("workspace") || link.has("organizationId")) {
    link.set("next", homePath);
    redirect(`/api/workspace?${link.toString()}`);
  }
  redirect(homePath);
}
