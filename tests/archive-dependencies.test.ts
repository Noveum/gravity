import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
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

// Run extraction in its own process so a dependency throwing from a filesystem
// callback fails this assertion instead of becoming an unhandled test-runner error.
test.each(["Extract", "Open"])(
  "unzipper %s extracts literal glob characters and nested files",
  async (api) => {
    const folder = await mkdtemp(join(tmpdir(), "gravity-extract-"));
    try {
      const zipPath = join(folder, "fictional.zip");
      const destination = join(folder, "output[fictional]");
      const zip = new JSZip();
      zip.file("nested/report[1].txt", "Fictional archive content");
      await writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
      await promisify(execFile)(
        process.execPath,
        [
          "-e",
          `
      const fs = require("node:fs");
      const unzipper = require(process.argv[1]);
      const [zipPath, destination, api] = process.argv.slice(2);
      (async () => {
        if (api === "Extract") {
          const extraction = unzipper.Extract({ path: destination });
          const completed = extraction.promise();
          fs.createReadStream(zipPath).pipe(extraction);
          await completed;
        } else {
          const directory = await unzipper.Open.file(zipPath);
          await directory.extract({ path: destination });
        }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
          require.resolve("unzipper"),
          zipPath,
          destination,
          api,
        ],
        { timeout: 10000 },
      );
      expect(
        await readFile(join(destination, "nested", "report[1].txt"), "utf8"),
      ).toBe("Fictional archive content");
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

test("ExcelJS streaming writer and reader retain shared strings, numeric values and multiple sheets", async () => {
  const output = new PassThrough();
  const collected = (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of output) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  })();
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useSharedStrings: true,
  });
  const first = writer.addWorksheet("Fictional accounts");
  first.addRow(["Name", "Amount"]).commit();
  first.addRow(["Fictional Cedar", 125.5]).commit();
  first.addRow(["Fictional Cedar", 0]).commit();
  first.commit();
  const second = writer.addWorksheet("Fictional notes");
  second.addRow(["Fictional note", true]).commit();
  second.commit();
  await writer.commit();
  const bytes = await collected;
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.read(Readable.from([bytes]));
  const expected = [
    {
      name: "Fictional accounts",
      rows: [
        ["Name", "Amount"],
        ["Fictional Cedar", 125.5],
        ["Fictional Cedar", 0],
      ],
    },
    { name: "Fictional notes", rows: [["Fictional note", true]] },
  ];
  expect(
    loaded.worksheets.map((sheet) => ({
      name: sheet.name,
      rows: (sheet.getRows(1, sheet.rowCount) ?? []).map((row) =>
        (row.values as ExcelJS.CellValue[]).slice(1),
      ),
    })),
  ).toEqual(expected);

  // ExcelJS's streaming reader assumes workbook metadata precedes worksheets.
  // Order those entries explicitly so this checks the parser contract separately
  // from the streaming writer's concurrent entry scheduling.
  const archive = await JSZip.loadAsync(bytes);
  const ordered = new JSZip();
  const metadata = [
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/sharedStrings.xml",
  ];
  for (const name of [
    ...metadata,
    ...Object.keys(archive.files).filter((name) => !metadata.includes(name)),
  ]) {
    const entry = archive.files[name];
    if (entry && !entry.dir)
      ordered.file(name, await entry.async("nodebuffer"));
  }
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(
    Readable.from([await ordered.generateAsync({ type: "nodebuffer" })]),
    {},
  );
  const sheets: ExcelJS.CellValue[][][] = [];
  for await (const sheet of reader) {
    const rows: ExcelJS.CellValue[][] = [];
    for await (const row of sheet)
      rows.push((row.values as ExcelJS.CellValue[]).slice(1));
    sheets.push(rows);
  }
  expect(sheets).toEqual(expected.map((sheet) => sheet.rows));
});
