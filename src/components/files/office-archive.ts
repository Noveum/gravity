import t from "@crm/i18n/translations/en.json";
import JSZip from "jszip";

interface OfficeXml {
  readonly parse: (source: string) => Document;
  readonly serialize: (document: Document) => string;
}

const MAX_EMBEDDED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

type StreamedZipEntry = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

async function verifyExpandedSize(
  entry: JSZip.JSZipObject,
  remaining: number,
): Promise<number> {
  const stream = (entry as StreamedZipEntry).internalStream("uint8array");
  let size = 0;
  return await new Promise<number>((resolve, reject) => {
    stream
      .on("data", (chunk) => {
        size += chunk.byteLength;
        if (size > MAX_EMBEDDED_BYTES || size > remaining) {
          stream.pause();
          reject(new Error(t.files.thisDocumentIsTooLargeToPreview));
        }
      })
      .on("error", reject)
      .on("end", () => resolve(size))
      .resume();
  });
}

const browserXml: OfficeXml = {
  parse: (source) => new DOMParser().parseFromString(source, "application/xml"),
  serialize: (document) => new XMLSerializer().serializeToString(document),
};

export function validateArchive(data: ArrayBuffer): void {
  const view = new DataView(data);
  let end = data.byteLength - 22;
  const minimum = Math.max(0, end - 65535);
  while (
    end >= minimum &&
    (view.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + view.getUint16(end + 20, true) !== data.byteLength)
  )
    end -= 1;
  if (end < minimum) throw new Error(t.files.thisFileIsNotAValidDocument);
  const count = view.getUint16(end + 10, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== count
  )
    throw new Error(t.files.thisDocumentArchiveIsDamagedOrUnsupported);
  if (count > 4000)
    throw new Error(t.files.thisDocumentContainsTooManyEmbeddedFiles);
  let cursor = view.getUint32(end + 16, true);
  if (cursor + view.getUint32(end + 12, true) !== end)
    throw new Error(t.files.thisDocumentArchiveIsDamaged);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error(t.files.thisDocumentArchiveIsDamaged);
    const size = view.getUint32(cursor + 24, true);
    total += size;
    if (size > MAX_EMBEDDED_BYTES || total > MAX_ARCHIVE_BYTES)
      throw new Error(t.files.thisDocumentIsTooLargeToPreview);
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
  if (cursor !== end) throw new Error(t.files.thisDocumentArchiveIsDamaged);
}

export async function validatedOfficeZip(
  data: ArrayBuffer,
  maximum = MAX_ARCHIVE_BYTES,
): Promise<JSZip> {
  validateArchive(data);
  const zip = await JSZip.loadAsync(data);
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir)
      expanded += await verifyExpandedSize(entry, maximum - expanded);
  }
  return zip;
}

export async function localOfficeArchive(
  data: ArrayBuffer,
  xmlTools: OfficeXml = browserXml,
): Promise<ArrayBuffer> {
  const zip = await validatedOfficeZip(data);
  let changed = false;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith(".rels")) continue;
    const xml = xmlTools.parse(await entry.async("string"));
    if (xml.getElementsByTagName("parsererror").length > 0)
      throw new Error(t.files.thisDocumentContainsDamagedRelationships);
    let removed = false;
    for (const relationship of [
      ...xml.getElementsByTagNameNS("*", "Relationship"),
    ]) {
      if (relationship.getAttribute("TargetMode")?.toLowerCase() !== "external")
        continue;
      relationship.remove();
      removed = true;
    }
    if (removed) {
      zip.file(entry.name, xmlTools.serialize(xml));
      changed = true;
    }
  }
  return changed ? await zip.generateAsync({ type: "arraybuffer" }) : data;
}
