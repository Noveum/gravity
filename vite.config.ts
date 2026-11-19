import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import nextConfig from "./next.config";
import { assetHeadersFile } from "./worker/asset-headers";

export default defineConfig({
  plugins: [
    // A Worker has no standalone Node server to emit; the rest of the Next
    // config (headers, external packages) is shared with the Next.js build.
    vinext({ nextConfig: { ...nextConfig, output: undefined } }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
    {
      name: "gravity-asset-headers",
      applyToEnvironment: (environment) => environment.name === "client",
      async generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "_headers",
          source: assetHeadersFile(await nextConfig.headers()),
        });
      },
    },
  ],
});
