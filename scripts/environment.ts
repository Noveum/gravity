import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Match Next's file precedence while preserving shell/CI values. Parse as
// data, never execute the file or expand characters inside database passwords.
export function loadScriptEnvironment(directory = process.cwd()) {
  const mode = process.env.NODE_ENV ?? "development";
  for (const name of [
    `.env.${mode}.local`,
    ...(mode === "test" ? [] : [".env.local"]),
    `.env.${mode}`,
    ".env",
  ]) {
    let contents: string;
    try {
      contents = readFileSync(`${directory}/${name}`, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("ENV_FILE_READ_FAILED");
    }
    for (const [key, value] of Object.entries(parseEnv(contents)))
      process.env[key] ??= value;
  }
}
