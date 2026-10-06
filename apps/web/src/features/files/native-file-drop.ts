import { fileNameSchema } from '@gravity/shared/validators';

export interface UploadBatch {
  readonly files: readonly { readonly file: File; readonly path: readonly string[] }[];
  readonly folders: readonly (readonly string[])[];
}

export function availableUploadName(name: string, names: readonly string[]): string {
  const occupied = new Set(names.map((item) => item.toLowerCase()));
  let candidate = fileNameSchema.parse(name);
  let index = 2;
  while (occupied.has(candidate.toLowerCase())) {
    const suffix = ` (${index++})`;
    candidate = `${name.slice(0, 255 - suffix.length)}${suffix}`;
  }
  return candidate;
}

function safePath(path: readonly string[]): string[] {
  if (path.length > 32) throw new Error('Folders can be nested up to 32 levels for an upload.');
  return path.map((name) => fileNameSchema.parse(name));
}

export function selectedUpload(files: readonly File[]): UploadBatch {
  const folders = new Map<string, string[]>();
  const items = files.map((file) => {
    const relative = file.webkitRelativePath ?? '';
    const path = safePath(relative === '' ? [] : relative.split('/').slice(0, -1));
    for (let i = 1; i <= path.length; i++)
      folders.set(JSON.stringify(path.slice(0, i)), path.slice(0, i));
    return { file, path };
  });
  if (items.length + folders.size > 1000)
    throw new Error('Upload up to 1,000 files and folders at a time.');
  return { files: items, folders: [...folders.values()] };
}

export function nativeFileDrop(transfer: DataTransfer): Promise<UploadBatch> {
  const entries = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry());
  const fallback = [...transfer.files];
  if (entries.length === 0 || entries.some((entry) => entry === null))
    return Promise.resolve(selectedUpload(fallback));
  const files: { file: File; path: string[] }[] = [];
  const folders: string[][] = [];
  let count = 0;
  async function visit(entry: FileSystemEntry, parent: readonly string[]) {
    if (++count > 1000) throw new Error('Upload up to 1,000 files and folders at a time.');
    fileNameSchema.parse(entry.name);
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ file, path: [...parent] });
    } else if (entry.isDirectory) {
      const path = safePath([...parent, entry.name]);
      folders.push(path);
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const children = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (children.length === 0) break;
        for (const child of children) await visit(child, path);
      }
    }
  }
  return (async () => {
    for (const entry of entries) if (entry !== null) await visit(entry, []);
    return { files, folders };
  })();
}
