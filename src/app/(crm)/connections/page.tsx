import { redirect } from "next/navigation";
import { settingsPath } from "@/components/routes";

const notices = ["integration", "integrationError"];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const kept = new URLSearchParams();
  for (const key of notices) {
    const value = query[key];
    if (typeof value === "string" && value) kept.set(key, value);
  }
  const path = settingsPath("connections");
  redirect(kept.size ? `${path}?${kept}` : path);
}
