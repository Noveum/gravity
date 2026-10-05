import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { publicPaths, siteCopy } from "../packages/public-site/content";

// Exercise the built application without auth credentials, SQL, or a demo identity.
const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const address = socket.address();
if (!address || typeof address === "string")
  throw new Error("SMOKE_PORT_MISSING");
const port = address.port;
await new Promise<void>((resolve, reject) =>
  socket.close((error) => (error ? reject(error) : resolve())),
);
const base = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      CRM_DEMO_MODE: "false",
      DATABASE_URL: "",
      PUBLIC_SITE_INDEXING: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
let spawnFailed = false;
const exited = new Promise<void>((resolve) => {
  child.once("exit", () => resolve());
  child.once("error", () => {
    spawnFailed = true;
    resolve();
  });
});
const request = (path: string) =>
  fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
child.stdout.on("data", (chunk) => {
  log = (log + chunk.toString()).slice(-6000);
});
child.stderr.on("data", (chunk) => {
  log = (log + chunk.toString()).slice(-6000);
});
child.on("error", (error) => {
  log += error.message;
});
try {
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && child.exitCode === null && !spawnFailed) {
    try {
      const response = await fetch(`${base}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!ready) throw new Error(`SMOKE_START_FAILED\n${log}`);
  for (const path of publicPaths) {
    const response = await request(path);
    const html = await response.text();
    if (
      response.status !== 200 ||
      !html.includes('id="public-main"') ||
      !html.includes('name="robots" content="noindex, nofollow"')
    )
      throw new Error(`SMOKE_PAGE_FAILED: ${path}`);
    if (path === "/" && !html.includes(siteCopy.heroTitle))
      throw new Error("SMOKE_COPY_MISSING");
  }
  const welcome = await fetch(new URL("/welcome", base), {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (
    welcome.status !== 308 ||
    new URL(welcome.headers.get("location") ?? "", base).pathname !== "/"
  )
    throw new Error("LANDING_REDIRECT_FAILED");
  for (const path of ["/docs/missing-guide", "/blog/missing-article"]) {
    if ((await request(path)).status !== 404)
      throw new Error(`SMOKE_NOT_FOUND_FAILED: ${path}`);
  }
  const robots = await request("/robots.txt").then((response) =>
    response.text(),
  );
  if (!robots.includes("Disallow: /")) throw new Error("SMOKE_ROBOTS_FAILED");
  const sitemap = await request("/sitemap.xml").then((response) =>
    response.text(),
  );
  if (sitemap.includes("<loc>")) throw new Error("SMOKE_SITEMAP_FAILED");
  console.log(
    `Verified ${publicPaths.length} built public pages, two 404s, robots and sitemap with demo mode disabled.`,
  );
} finally {
  child.kill("SIGTERM");
  const forceStop = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(forceStop);
  }
}
