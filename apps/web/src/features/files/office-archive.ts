import JSZip from 'jszip';

interface OfficeXml {
  readonly parse: (source: string) => Document;
  readonly serialize: (document: Document) => string;
}

const browserXml: OfficeXml = {
  parse: (source) => new DOMParser().parseFromString(source, 'application/xml'),
  serialize: (document) => new XMLSerializer().serializeToString(document),
};

export function validateArchive(data: ArrayBuffer): void {
  const view = new DataView(data);
  let end = data.byteLength - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < minimum) throw new Error('This file is not a valid document archive.');
  const count = view.getUint16(end + 10, true);
  if (count > 4000) throw new Error('This document contains too many embedded files.');
  let cursor = view.getUint32(end + 16, true);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('This document archive is damaged.');
    const size = view.getUint32(cursor + 24, true);
    total += size;
    if (size > 64 * 1024 * 1024 || total > 256 * 1024 * 1024)
      throw new Error('This document is too large to preview safely.');
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
}

export async function localOfficeArchive(
  data: ArrayBuffer,
  xmlTools: OfficeXml = browserXml,
): Promise<ArrayBuffer> {
  validateArchive(data);
  const zip = await JSZip.loadAsync(data);
  let changed = false;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith('.rels')) continue;
    const xml = xmlTools.parse(await entry.async('string'));
    let removed = false;
    for (const relationship of [...xml.getElementsByTagNameNS('*', 'Relationship')]) {
      if (relationship.getAttribute('TargetMode')?.toLowerCase() !== 'external') continue;
      relationship.remove();
      removed = true;
    }
    if (removed) {
      zip.file(entry.name, xmlTools.serialize(xml));
      changed = true;
    }
  }
  return changed ? await zip.generateAsync({ type: 'arraybuffer' }) : data;
}
