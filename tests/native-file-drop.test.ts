import { describe, expect, it } from "vitest";
import {
  availableUploadName,
  nativeFileDrop,
  selectedUpload,
} from "@/components/files/native-file-drop";

describe("native file uploads", () => {
  it("creates a fresh root folder name without merging into a shared folder", () => {
    expect(availableUploadName("Projects", ["projects", "Projects (2)"])).toBe(
      "Projects (3)",
    );
    expect(
      availableUploadName("A".repeat(255), ["A".repeat(255)]),
    ).toHaveLength(255);
  });
  it("preserves nested paths from folder selection and rejects unsafe names", () => {
    const file = new File(["Saved"], "Report.txt");
    Object.defineProperty(file, "webkitRelativePath", {
      value: "Projects/Reports/Report.txt",
    });
    const batch = selectedUpload([file]);
    expect(batch.files[0]?.path).toEqual(["Projects", "Reports"]);
    expect(batch.folders).toEqual([["Projects"], ["Projects", "Reports"]]);
    const unsafe = new File([""], "bad.txt");
    Object.defineProperty(unsafe, "webkitRelativePath", {
      value: "Projects/../bad.txt",
    });
    expect(() => selectedUpload([unsafe])).toThrow();
  });

  it("drains every native directory batch and retains empty subfolders", async () => {
    const file = new File(["Saved"], "Report.txt");
    const child = {
      name: file.name,
      isFile: true,
      isDirectory: false,
      file: (resolve: (file: File) => void) => resolve(file),
    };
    const empty = {
      name: "Empty",
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) => resolve([]),
      }),
    };
    let index = 0;
    const directory = {
      name: "Projects",
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) =>
          resolve([[child], [empty], []][index++] ?? []),
      }),
    };
    const transfer = {
      items: [{ kind: "file", webkitGetAsEntry: () => directory }],
      files: [],
    } as unknown as DataTransfer;
    const batch = await nativeFileDrop(transfer);
    expect(batch.files[0]?.file).toBe(file);
    expect(batch.files[0]?.path).toEqual(["Projects"]);
    expect(batch.folders).toEqual([["Projects"], ["Projects", "Empty"]]);
    expect(index).toBe(3);
  });
});
