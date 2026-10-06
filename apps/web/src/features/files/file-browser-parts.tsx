'use client';

import {
  ArrowUp,
  ChevronRight,
  Columns3,
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  List,
  Menu,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { useShellActions } from '@/components/layout/shell-actions.tsx';
import { ThemeToggle } from '@/components/theme-toggle.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Input } from '@/components/ui/input.tsx';
import { messageOf } from '@/lib/api/client.ts';
import { NewFileDialog, RenameFileDialog, ShareFileDialog } from './file-dialogs.tsx';
import { FileEditor } from './file-editor.tsx';
import { FileTable } from './file-table.tsx';
import { FileTransferDialog } from './file-transfer-dialog.tsx';
import { FileColumns, FileGrid } from './file-views.tsx';
import type { FileBrowser } from './use-file-browser.ts';

export function FilesToolbar({ browser }: { readonly browser: FileBrowser }) {
  const shell = useShellActions();
  const { writable, busy, setCreating, uploading, uploadInput, folderUploadInput } = browser;
  return (
    <header
      role="toolbar"
      aria-label="File toolbar"
      className="flex min-h-12 flex-wrap items-center gap-2 border-border border-b px-3 py-2"
    >
      <h1 className="sr-only">Files</h1>
      {shell === null ? null : (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Open navigation"
          onClick={shell.openNavigation}
          className="shrink-0 lg:hidden"
        >
          <Menu className="size-4" />
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label="Go to parent folder"
        disabled={browser.parentId === null}
        onClick={() => browser.navigate(browser.currentFolder?.parentId ?? null)}
      >
        <ArrowUp className="size-4" />
      </Button>
      <FilesNavigation browser={browser} />
      <label htmlFor="file-folder-search" className="relative ml-auto min-w-32 max-w-52 flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted" />
        <Input
          id="file-folder-search"
          className="h-8 pl-7"
          aria-label="Search this folder"
          placeholder="Search folder"
          value={browser.search}
          onChange={(event) => browser.setSearch(event.target.value)}
        />
      </label>
      <fieldset className="flex rounded-md border border-border">
        <legend className="sr-only">Folder view</legend>
        {(
          [
            { value: 'list', label: 'List view', Icon: List },
            { value: 'grid', label: 'Grid view', Icon: LayoutGrid },
            { value: 'columns', label: 'Columns view', Icon: Columns3 },
          ] as const
        ).map(({ value, label, Icon }) => (
          <Button
            key={value}
            size="sm"
            variant={browser.view === value ? 'secondary' : 'ghost'}
            aria-label={label}
            aria-pressed={browser.view === value}
            onClick={() => browser.changeView(value)}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </fieldset>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" disabled={!writable || busy}>
            <Plus className="size-4" />
            New
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setCreating('folder')}>
            <FolderPlus className="size-4" />
            New folder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreating('markdown')}>
            <FilePlus2 className="size-4" />
            New document
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={uploading}
            onSelect={() => folderUploadInput.current?.click()}
          >
            <Upload className="size-4" />
            Upload folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="primary"
        disabled={!writable || uploading}
        onClick={() => uploadInput.current?.click()}
      >
        <Upload className="size-4" />
        <span className="hidden sm:inline">Upload files</span>
        <span className="sm:hidden">Upload</span>
      </Button>
      <input
        ref={uploadInput}
        type="file"
        multiple
        className="hidden"
        aria-label="Upload files"
        onChange={(event) => {
          if (event.target.files !== null) browser.uploadSelected([...event.target.files]);
          event.target.value = '';
        }}
      />
      <span className="inline-flex">
        <ThemeToggle compact />
      </span>
      <input
        ref={folderUploadInput}
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        className="hidden"
        aria-label="Upload folder"
        onChange={(event) => {
          if (event.target.files !== null) browser.uploadSelected([...event.target.files]);
          event.target.value = '';
        }}
      />
    </header>
  );
}

export function FilesNavigation({ browser }: { readonly browser: FileBrowser }) {
  return (
    <nav
      aria-label="Folder path"
      className="flex min-w-24 max-w-[38%] items-center gap-1 overflow-x-auto whitespace-nowrap"
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={() => browser.navigate(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => browser.drop(event, null)}
      >
        Files
      </Button>
      {browser.files.listing.data?.ancestors.map((folder) => (
        <span key={folder.id} className="flex items-center gap-1">
          <ChevronRight className="size-3 shrink-0 text-faint" />
          <Button
            size="sm"
            variant="ghost"
            className="max-w-44 truncate"
            onClick={() => browser.navigate(folder.id)}
            onDragOver={(event) => {
              if (folder.canEdit) event.preventDefault();
            }}
            onDrop={(event) => browser.drop(event, folder.id)}
          >
            {folder.name}
          </Button>
        </span>
      ))}
    </nav>
  );
}

export function FilesSelection({ browser }: { readonly browser: FileBrowser }) {
  const {
    selected,
    entries,
    clipboard,
    writable,
    busy,
    mayMove,
    setClipboard,
    setTransfer,
    paste,
  } = browser;
  if (selected.length === 0 && clipboard === null) return null;
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 px-6 py-2 text-muted text-xs">
      <span>{selected.length > 0 ? `${selected.length} selected` : `${entries.length} items`}</span>
      {selected.length > 0 ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              setClipboard({ ids: selected.map((entry) => entry.id), operation: 'copy' })
            }
          >
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!mayMove || busy}
            onClick={() =>
              setClipboard({ ids: selected.map((entry) => entry.id), operation: 'move' })
            }
          >
            Cut
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!mayMove || busy}
            onClick={() => setTransfer({ entries: selected, operation: 'move' })}
          >
            Move to…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!mayMove || busy}
            onClick={() => setTransfer({ entries: selected, operation: 'delete' })}
          >
            Delete
          </Button>
        </>
      ) : null}
      {clipboard === null ? null : (
        <Button size="sm" disabled={!writable || busy} onClick={() => paste()}>
          Paste {clipboard.ids.length} {clipboard.ids.length === 1 ? 'item' : 'items'}
        </Button>
      )}
      <span className="ml-auto hidden sm:inline">⌘/Ctrl C, X, V</span>
    </div>
  );
}

export function FilesUploads({ browser }: { readonly browser: FileBrowser }) {
  const { files } = browser;
  return files.uploads.length === 0 ? null : (
    <div
      aria-live="polite"
      className="mx-6 mb-3 flex flex-col gap-1 rounded-lg border border-border p-3"
    >
      {files.uploads.map((upload) => (
        <div key={upload.id} className="flex items-center gap-3 text-xs">
          <span className="w-40 truncate">{upload.name}</span>
          {upload.error === null ? (
            <>
              <progress
                aria-label={`Uploading ${upload.name}`}
                value={upload.progress}
                max={100}
                className="h-1.5 flex-1"
              />
              <span>{upload.progress === 100 ? 'Uploaded' : `${upload.progress}%`}</span>
            </>
          ) : (
            <span role="alert" className="text-danger">
              {upload.error}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function FilesContents({ browser }: { readonly browser: FileBrowser }) {
  const { writable, busy, drop, parentId, files, visible, navigate, search } = browser;
  return (
    <section
      aria-label="Folder contents"
      className="relative min-h-0 min-w-0 flex-1 overflow-auto px-3 pb-3"
      onDragOver={(event) => {
        if (writable && !busy) event.preventDefault();
      }}
      onDrop={(event) => drop(event, parentId)}
    >
      {files.listing.isPending ? (
        <p role="status" className="py-12 text-center text-muted text-dense">
          Loading files…
        </p>
      ) : null}
      {!files.listing.isPending && files.listing.error === null ? (
        <FolderView browser={browser} />
      ) : null}
      {files.listing.error === null ? null : (
        <div className="py-12 text-center">
          <p role="alert" className="text-danger">
            {messageOf(files.listing.error)}
          </p>
          <Button className="mt-4" onClick={() => navigate(null)}>
            Back to Files
          </Button>
        </div>
      )}
      {!files.listing.isPending && files.listing.error === null && visible.length === 0 ? (
        <div className="py-16 text-center">
          <FolderPlus className="mx-auto mb-3 size-8 text-faint" />
          <p className="text-muted text-dense">
            {search === '' ? 'This folder is empty.' : 'No files match your search.'}
          </p>
          <p className="mt-2 text-faint text-xs">
            {search === '' && writable
              ? 'Drop files here, upload documents, or create a folder.'
              : ''}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function FilesDialogs({ browser }: { readonly browser: FileBrowser }) {
  const {
    creating,
    parentId,
    setCreating,
    run,
    busy,
    sharing,
    setSharing,
    renaming,
    setRenaming,
    transfer,
    files,
    setTransfer,
    editorEntry,
    closeEditor,
  } = browser;
  return (
    <>
      {' '}
      {creating === null ? null : (
        <NewFileDialog
          kind={creating}
          parentId={parentId}
          close={() => setCreating(null)}
          run={run}
          pending={busy}
        />
      )}
      {sharing === null ? null : (
        <ShareFileDialog entry={sharing} close={() => setSharing(null)} run={run} pending={busy} />
      )}
      {renaming === null ? null : (
        <RenameFileDialog
          entry={renaming}
          close={() => setRenaming(null)}
          run={run}
          pending={busy}
        />
      )}
      {transfer === null ? null : (
        <FileTransferDialog
          {...transfer}
          organizationId={files.organizationId}
          close={() => setTransfer(null)}
          run={run}
          pending={busy}
        />
      )}
      {editorEntry === null || editorEntry.kind === 'folder' ? null : (
        <FileEditor
          key={editorEntry.id}
          entry={editorEntry}
          organizationId={files.organizationId}
          close={closeEditor}
          run={run}
          pending={busy}
        />
      )}
    </>
  );
}

function FolderView({ browser }: { readonly browser: FileBrowser }) {
  if (browser.view === 'grid') return <FileGrid browser={browser} />;
  if (browser.view === 'columns') return <FileColumns browser={browser} />;
  return <FileTable browser={browser} />;
}
