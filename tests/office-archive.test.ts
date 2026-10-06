import { JSDOM } from "jsdom";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  localOfficeArchive,
  validateArchive,
} from "@/components/files/office-archive";

describe("Office preview archives", () => {
  it("rejects hidden entries when an archive underreports its entry count", async () => {
    const zip = new JSZip();
    zip.file("document.xml", "<document>Saved</document>");
    const data = await zip.generateAsync({ type: "arraybuffer" });
    const view = new DataView(data);
    const end = data.byteLength - 22;
    view.setUint16(end + 8, 0, true);
    view.setUint16(end + 10, 0, true);
    expect(() => validateArchive(data)).toThrow("damaged");
    await expect(localOfficeArchive(data)).rejects.toThrow("damaged");
  });

  it("bounds actual expansion even when a compressed entry lies about its size", async () => {
    const zip = new JSZip();
    zip.file("oversized.bin", new Uint8Array(65 * 1024 * 1024));
    const data = await zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
    });
    const view = new DataView(data);
    const central = view.getUint32(data.byteLength - 22 + 16, true);
    view.setUint32(central + 24, 1, true);
    expect(() => validateArchive(data)).not.toThrow();
    await expect(localOfficeArchive(data)).rejects.toThrow("too large");
  });

  it("rejects damaged archives and declared decompression bombs before loading them", async () => {
    expect(() => validateArchive(new ArrayBuffer(0))).toThrow("valid document");
    const zip = new JSZip();
    zip.file("document.xml", "<document>Saved</document>");
    const data = await zip.generateAsync({ type: "arraybuffer" });
    expect(() => validateArchive(data)).not.toThrow();
    const view = new DataView(data);
    const end = data.byteLength - 22;
    const central = view.getUint32(end + 16, true);
    view.setUint32(central + 24, 100 * 1024 * 1024, true);
    expect(() => validateArchive(data)).toThrow("too large");
  });

  it("keeps embedded images while removing external image and hyperlink relationships", async () => {
    const zip = new JSZip();
    zip.file(
      "word/_rels/document.xml.rels",
      '<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="embedded" Target="media/image.png"/><r:Relationship Id="remote" TargetMode="External" Target="https://example.com/private-tracker"/></r:Relationships>',
    );
    zip.file("word/media/image.png", "embedded bytes");
    const dom = new JSDOM("");
    const bytes = await localOfficeArchive(
      await zip.generateAsync({ type: "arraybuffer" }),
      {
        parse: (source) =>
          new dom.window.DOMParser().parseFromString(source, "application/xml"),
        serialize: (document) =>
          new dom.window.XMLSerializer().serializeToString(document),
      },
    );
    const result = await JSZip.loadAsync(bytes);
    const relationships = await result
      .file("word/_rels/document.xml.rels")
      ?.async("string");
    expect(relationships).toContain("embedded");
    expect(relationships).not.toContain("remote");
    expect(await result.file("word/media/image.png")?.async("string")).toBe(
      "embedded bytes",
    );
    dom.window.close();
  });
});
