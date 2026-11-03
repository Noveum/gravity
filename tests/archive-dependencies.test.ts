import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import JSZip from "jszip";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);

test("patched archive dependencies preserve nested glob matching and exclusions", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gravity-archive-"));
  try {
    await mkdir(join(folder, "nested"));
    await writeFile(join(folder, "nested", "fictional.txt"), "Fictional text");
    await writeFile(join(folder, "nested", "ignored.txt"), "Excluded text");
    const files = require("archiver-utils/file") as {
      expand(options: { cwd: string }, patterns: string[]): string[];
    };
    expect(
      files.expand({ cwd: folder }, ["**/*.txt", "!**/ignored.txt"]),
    ).toEqual(["nested/fictional.txt"]);

    const archiver = require("archiver") as (format: string) => Readable & {
      glob(pattern: string, options: { cwd: string; ignore: string[] }): void;
      finalize(): Promise<void>;
    };
    const archive = archiver("zip");
    const result = (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of archive) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    })();
    archive.glob("**/*.txt", { cwd: folder, ignore: ["**/ignored.txt"] });
    await archive.finalize();
    const zip = await JSZip.loadAsync(await result);
    expect(
      Object.keys(zip.files).filter((name) => !zip.files[name]?.dir),
    ).toEqual(["nested/fictional.txt"]);
    expect(await zip.file("nested/fictional.txt")?.async("string")).toBe(
      "Fictional text",
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
