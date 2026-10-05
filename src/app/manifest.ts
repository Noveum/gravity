import { gravityIdentity } from "@crm/brand/identity";
import t from "@crm/i18n/translations/en.json";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t.brand,
    short_name: t.brand,
    description: t.actionsSubtitle,
    start_url: "/actions",
    display: "standalone",
    background_color: "#101117",
    theme_color: gravityIdentity.light,
    icons: [192, 512].map((size) => ({
      src: `/brand/gravity-app-${size}.png`,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose: "any",
    })),
  };
}
