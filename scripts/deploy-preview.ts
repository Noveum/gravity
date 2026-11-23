import { spawnSync } from "node:child_process";
import { previewAlias } from "./preview-alias";

// Uploads the "pr" build as a new gravity-pr version without deploying it,
// so each branch gets its own preview URL and the Worker's own URL is left
// alone. Workers Builds names the branch in WORKERS_CI_BRANCH.
const branch = process.env.WORKERS_CI_BRANCH || process.argv[2];
if (!branch) throw new Error("PREVIEW_BRANCH_REQUIRED");
const alias = previewAlias(branch, "gravity-pr");
console.log(`Preview alias: ${alias}`);
const upload = spawnSync(
  "node_modules/.bin/cf",
  [
    "workers",
    "versions",
    "create",
    "--prebuilt",
    "--mode",
    "pr",
    "--preview-alias",
    alias,
    "--message",
    `Preview of ${branch}`.slice(0, 100),
  ],
  { stdio: "inherit" },
);
process.exitCode = upload.status ?? 1;
