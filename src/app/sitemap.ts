import { publicPaths } from "@crm/public-site/content";
import { canIndexPublicSite, publicOrigin } from "@crm/public-site/metadata";
import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  if (!canIndexPublicSite()) return [];
  return publicPaths.map((path) => ({ url: `${publicOrigin()}${path}` }));
}
