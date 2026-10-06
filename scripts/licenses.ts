import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
// Bun's text lockfile uses JSON with trailing commas; it is trusted repository data.
const lock = JSON.parse(
  readFileSync("bun.lock", "utf8").replace(/,(?=\s*[}\]])/g, ""),
);
const locked = new Set<string>(
  Object.values(lock.packages).map((entry) => (entry as string[])[0]),
);
interface DependencyLicense {
  name: string;
  version: string;
  license: string;
  direct: boolean;
  repository: string | null;
  resolutionSource?: string;
}
const reviewedLicenses = JSON.parse(
  readFileSync("docs/dependency-license-resolutions.json", "utf8"),
) as Record<string, { license: string; source: string }>;
const inventory = new Map<string, DependencyLicense>();
const seen = new Set<string>();
const directKeys = new Set(
  Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).flatMap((name) => {
    const path = join("node_modules", name, "package.json");
    if (!existsSync(path)) return [];
    const dependency = JSON.parse(readFileSync(path, "utf8"));
    return [`${dependency.name}@${dependency.version}`];
  }),
);
function scan(directory: string) {
  if (!existsSync(directory)) return;
  const canonical = realpathSync(directory);
  if (seen.has(canonical)) return;
  seen.add(canonical);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith("@")) {
      scan(path);
      continue;
    }
    const file = join(path, "package.json");
    if (!existsSync(file)) continue;
    const dependency = JSON.parse(readFileSync(file, "utf8"));
    const key = `${dependency.name}@${dependency.version}`;
    if (locked.has(key)) {
      const license =
        typeof dependency.license === "string"
          ? dependency.license
          : dependency.license?.type ||
            reviewedLicenses[key]?.license ||
            "UNDECLARED";
      inventory.set(key, {
        name: dependency.name,
        version: dependency.version,
        license,
        direct: directKeys.has(key),
        repository:
          typeof dependency.repository === "string"
            ? dependency.repository
            : dependency.repository?.url || null,
        ...(!dependency.license && reviewedLicenses[key]
          ? { resolutionSource: reviewedLicenses[key].source }
          : {}),
      });
    }
    scan(join(path, "node_modules"));
  }
}
scan("node_modules");
if (existsSync("node_modules/.bun")) {
  for (const entry of readdirSync("node_modules/.bun", {
    withFileTypes: true,
  })) {
    if (entry.isDirectory())
      scan(join("node_modules/.bun", entry.name, "node_modules"));
  }
}
const dependencies = [...inventory.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const missingDirect = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
}).filter(
  (name) =>
    !dependencies.some(
      (dependency) => dependency.name === name && dependency.direct,
    ),
);
if (missingDirect.length)
  throw new Error(
    `Uninstalled direct dependencies: ${missingDirect.join(", ")}`,
  );
const undeclared = dependencies.filter(
  (dependency) => dependency.license === "UNDECLARED",
);
if (process.argv.includes("--check")) {
  if (undeclared.length)
    throw new Error(
      `Undeclared dependency licenses: ${undeclared.map((item) => `${item.name}@${item.version}`).join(", ")}`,
    );
  console.log(
    `Checked ${dependencies.length} installed locked packages; all direct packages are present and all declare a license or have an exact-version reviewed resolution. Review the inventory before distribution; this is not license-policy approval.`,
  );
  process.exit(0);
}
writeFileSync(
  "docs/dependency-licenses.json",
  `${JSON.stringify({ coverage: "Declared or exact-version reviewed package licenses for locked dependencies installed on the generating platform. Optional packages for other platforms may be absent; inspect their licenses before distributing those binaries. This inventory does not replace upstream license text and notices.", missingLockedPackages: [...locked].filter((key) => !inventory.has(key)).sort(), dependencies }, null, 2)}\n`,
);
console.log(
  `Recorded ${dependencies.length} installed locked packages; ${dependencies.filter((dependency) => dependency.license === "UNDECLARED").length} undeclared licenses.`,
);
