import { canIndexPublicSite, publicOrigin } from "@crm/public-site/metadata";
import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  if (!canIndexPublicSite())
    return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/docs", "/blog"],
      disallow: "/",
    },
    sitemap: `${publicOrigin()}/sitemap.xml`,
  };
}
