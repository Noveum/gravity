interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

// Workers serves /_next/static before the Worker runs, so the headers from
// next.config.ts reach those files only through the assets' _headers file.
export function assetHeadersFile(rules: HeaderRule[]) {
  return rules
    .map((rule) => {
      if (rule.source !== "/:path*")
        throw new Error(`Unsupported header source for assets: ${rule.source}`);
      const lines = rule.headers.map(({ key, value }) => `  ${key}: ${value}`);
      return ["/*", ...lines].join("\n");
    })
    .join("\n")
    .concat("\n");
}
