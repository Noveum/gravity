import type { Metadata } from "next";
import t from "../i18n/translations/en.json";
export function publicOrigin() {
  try {
    const url = new URL(process.env.PUBLIC_SITE_URL ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function canIndexPublicSite() {
  return (
    !!publicOrigin() &&
    process.env.PUBLIC_SITE_INDEXING === "true" &&
    (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production") &&
    process.env.NODE_ENV === "production"
  );
}
export function publicMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  const origin = publicOrigin();
  return {
    title: `${title} · ${t.brand}`,
    description,
    robots: { index: canIndexPublicSite(), follow: canIndexPublicSite() },
    ...(origin
      ? {
          alternates: { canonical: `${origin}${path}` },
          openGraph: {
            title,
            description,
            url: `${origin}${path}`,
            siteName: t.brand,
            type: "website",
          },
        }
      : {}),
  };
}
