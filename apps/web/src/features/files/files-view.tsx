'use client';

import { messageOf } from '@/lib/api/client.ts';
import {
  FilesContents,
  FilesDialogs,
  FilesSelection,
  FilesToolbar,
  FilesUploads,
} from './file-browser-parts.tsx';
import { FolderTree } from './folder-tree.tsx';
import { useFileBrowser } from './use-file-browser.ts';

export function FilesView() {
  const browser = useFileBrowser();
  return (
    <section
      ref={browser.browserRef}
      tabIndex={-1}
      aria-label="File browser"
      className="relative flex h-full min-h-0 flex-col outline-none"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) browser.setDraggingFiles(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          browser.setDraggingFiles(false);
      }}
      onDropCapture={() => browser.setDraggingFiles(false)}
      onKeyDown={browser.onKeyDown}
    >
      <FilesToolbar browser={browser} />
      <FilesSelection browser={browser} />
      {browser.error === null ? null : (
        <p role="alert" className="mx-6 my-2 text-danger text-sm">
          {browser.error}
        </p>
      )}
      {browser.deepFile.error === null ? null : (
        <p role="alert" className="mx-6 my-2 text-danger text-sm">
          {messageOf(browser.deepFile.error)}
        </p>
      )}
      <FilesUploads browser={browser} />
      <div className="flex min-h-0 flex-1">
        <FolderTree browser={browser} />
        <FilesContents browser={browser} />
      </div>
      {browser.draggingFiles && browser.writable ? (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border-2 border-accent border-dashed bg-accent-subtle/90 text-accent">
          <p className="rounded-md bg-surface px-5 py-3 font-medium">
            Drop files or folders to upload
          </p>
        </div>
      ) : null}
      <footer className="flex items-center gap-3 border-border border-t px-3 py-1.5 text-faint text-xs">
        <span>{browser.entries.length} items</span>
        <span className="ml-auto">Drop files or folders · Up to 100 MB per file</span>
      </footer>
      <FilesDialogs browser={browser} />
    </section>
  );
}
