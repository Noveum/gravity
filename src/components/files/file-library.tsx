"use client";
import type { FileEntry, FileGrant, FileListing } from "@crm/files/validators";
import { MAX_UPLOAD_BYTES } from "@crm/files/validators";
import t from "@crm/i18n/translations/en.json";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  File,
  FileText,
  Folder,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Scissors,
  Search,
  Share2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { errorText } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { useModalLifecycle } from "../modal-lifecycle";
import {
  command,
  detail,
  type FileScope,
  fileUrl,
  listFiles,
  reserve,
} from "./file-api";
import {
  cachedFiles,
  fileKey,
  filesKey,
  folderKey,
  patchFiles,
} from "./file-cache";
import { FilePreview } from "./file-preview";
import { fileShortcut, isFileInput } from "./file-shortcuts";
import { MarkdownPreview } from "./markdown-preview";
import {
  availableUploadName,
  nativeFileDrop,
  selectedUpload,
  type UploadBatch,
} from "./native-file-drop";
import "./file-library.css";

const labels = t.files;
const dragType = "application/x-gravity-library";
const sizeLabel = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
function Icon({ entry }: { entry: FileEntry }) {
  const Component =
    entry.kind === "folder"
      ? Folder
      : entry.kind === "markdown"
        ? FileText
        : File;
  return <Component size={18} />;
}
export function FileLibrary() {
  const crm = useWorkspaceData();
  const [selectedProduct, setSelectedProduct] = useState("");
  const productId =
    crm.productId ||
    (crm.data.products.some((p) => p.id === selectedProduct)
      ? selectedProduct
      : (crm.data.products[0]?.id ?? ""));
  return (
    <div className="file-library-page">
      {!crm.productId && (
        <label className="library-product">
          {t.product}
          <select
            value={productId}
            onChange={(event) => {
              setSelectedProduct(event.target.value);
              window.history.replaceState(null, "", "/files");
            }}
          >
            {crm.data.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {productId ? (
        <ScopedLibrary
          key={`${crm.organizationId}/${productId}`}
          scope={{ organizationId: crm.organizationId, productId }}
        />
      ) : (
        <p>{labels.chooseProduct}</p>
      )}
    </div>
  );
}
function ScopedLibrary({ scope }: { scope: FileScope }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: true },
        },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <Browser scope={scope} />
    </QueryClientProvider>
  );
}
function Browser({ scope }: { scope: FileScope }) {
  const crm = useWorkspaceData();
  const params = useSearchParams();
  const parentId = params.get("folder");
  const cacheScope = `${scope.organizationId}/${scope.productId}`;
  const client = useQueryClient();
  const listing = useQuery({
    queryKey: folderKey(cacheScope, parentId),
    queryFn: ({ signal }) => listFiles(scope, parentId, signal),
    staleTime: 60_000,
  });
  const [view, setView] = useState<"list" | "grid" | "columns">("list");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{
    ids: string[];
    operation: "copy" | "move";
  } | null>(null);
  const [opened, setOpened] = useState<FileEntry | null>(null);
  const [dialog, setDialog] = useState<{
    kind: "folder" | "markdown" | "rename" | "share" | "delete";
    entry?: FileEntry;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<
    { id: string; name: string; progress: number; error: string }[]
  >([]);
  const lock = useRef(false);
  const uploadLock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const revision = useRef(crm.sourceData.asOf);
  const previousFolder = useRef(parentId);
  useEffect(() => {
    if (revision.current === crm.sourceData.asOf) return;
    revision.current = crm.sourceData.asOf;
    void client.cancelQueries();
    client.removeQueries({ queryKey: ["file", cacheScope] });
    client.removeQueries({ queryKey: ["file-preview"] });
    client.removeQueries({ queryKey: ["file-text-preview"] });
    for (const [key] of client.getQueriesData({
      queryKey: filesKey(cacheScope),
    }))
      void client.resetQueries({ queryKey: key, exact: true }).catch(() => {});
  }, [crm.sourceData.asOf, client, cacheScope]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gravity-file-view");
      if (saved === "grid" || saved === "columns" || saved === "list")
        setView(saved);
    } catch {}
  }, []);
  useEffect(() => {
    if (previousFolder.current === parentId) return;
    previousFolder.current = parentId;
    setSelection([]);
    setSearch("");
    setOpened(null);
    setError("");
  }, [parentId]);
  useEffect(
    () =>
      crm.registerCreate(() => {
        setDialog({ kind: "folder" });
        return true;
      }),
    [crm.registerCreate],
  );
  const entries = listing.data?.entries ?? [];
  const visible = entries.filter((entry) =>
    entry.name.toLowerCase().includes(search.toLowerCase()),
  );
  const ancestors = listing.data?.ancestors ?? [];
  const current = ancestors.at(-1);
  const writable =
    listing.data !== undefined && (current?.canEdit ?? parentId === null);
  const selected = cachedFiles(client, cacheScope).filter((entry) =>
    selection.includes(entry.id),
  );
  const owned =
    selected.length > 0 &&
    selected.every((entry) => entry.ownerId === crm.userId && entry.canEdit);
  function navigate(id: string | null) {
    window.history.pushState(null, "", id ? `/files?folder=${id}` : "/files");
    root.current?.focus();
  }
  async function run(operation: string, input: object) {
    if (lock.current) throw new Error(t.stillSaving);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await command(scope, operation, input);
      const removed =
        operation === "transfer" &&
        "operation" in input &&
        input.operation === "delete" &&
        "ids" in input &&
        Array.isArray(input.ids)
          ? input.ids.filter((id): id is string => typeof id === "string")
          : [];
      patchFiles(client, cacheScope, result.entries, removed);
      if (operation === "update" && "id" in input)
        await client.invalidateQueries({
          queryKey: fileKey(cacheScope, String(input.id)),
        });
      if (operation === "transfer")
        await client.invalidateQueries({ queryKey: filesKey(cacheScope) });
      setSelection([]);
      return result;
    } catch (failure) {
      setError(errorText(failure));
      throw failure;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function paste(destination = parentId, data = clipboard) {
    if (!data || busy) return;
    try {
      await run("transfer", { ...data, parentId: destination });
      if (data.operation === "move") setClipboard(null);
    } catch {}
  }
  function choose(
    entry: FileEntry,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    range = visible,
  ) {
    if (event.shiftKey && anchor) {
      const start = range.findIndex((item) => item.id === anchor),
        end = range.findIndex((item) => item.id === entry.id);
      if (start >= 0 && end >= 0)
        setSelection(
          range
            .slice(Math.min(start, end), Math.max(start, end) + 1)
            .map((item) => item.id),
        );
    } else if (event.metaKey || event.ctrlKey)
      setSelection((current) =>
        current.includes(entry.id)
          ? current.filter((id) => id !== entry.id)
          : [...current, entry.id],
      );
    else setSelection([entry.id]);
    if (!event.shiftKey) setAnchor(entry.id);
  }
  function open(entry: FileEntry) {
    if (entry.kind === "folder") navigate(entry.id);
    else setOpened(entry);
  }
  function prefetch(entry: FileEntry) {
    if (entry.kind === "folder")
      void client.prefetchQuery({
        queryKey: folderKey(cacheScope, entry.id),
        queryFn: ({ signal }) => listFiles(scope, entry.id, signal),
        staleTime: 60_000,
      });
  }
  async function uploadBatch(batch: UploadBatch, destination = parentId) {
    if (uploadLock.current) return;
    uploadLock.current = true;
    setError("");
    setUploads(
      batch.files.map(({ file }) => ({
        id: crypto.randomUUID(),
        name: file.name,
        progress: 0,
        error: "",
      })),
    );
    const paths = new Map<string, string | null>([["[]", destination]]);
    const update = (index: number, progress: number, error = "") =>
      setUploads((current) =>
        current.map((item, i) =>
          i === index ? { ...item, progress, error } : item,
        ),
      );
    try {
      for (const path of [...batch.folders].sort(
        (a, b) => a.length - b.length,
      )) {
        const parent = paths.get(JSON.stringify(path.slice(0, -1))),
          name = path.at(-1);
        if (parent === undefined || name === undefined)
          throw new Error(labels.badPath);
        const contents = await client.fetchQuery({
          queryKey: folderKey(cacheScope, parent),
          queryFn: ({ signal }) => listFiles(scope, parent, signal),
          staleTime: 0,
        });
        const existing =
          parent === null
            ? undefined
            : contents.entries.find(
                (entry) =>
                  entry.kind === "folder" &&
                  entry.name.toLowerCase() === name.toLowerCase(),
              );
        if (existing && !existing.canEdit) throw new Error(t.errors.FORBIDDEN);
        const folder =
          existing ??
          (
            await run("create", {
              name:
                parent === null
                  ? availableUploadName(
                      name,
                      contents.entries.map((entry) => entry.name),
                    )
                  : name,
              kind: "folder",
              parentId: parent,
              visibility: parent === null ? "private" : "inherit",
            })
          ).entries[0];
        if (!folder) throw new Error(labels.badPath);
        paths.set(JSON.stringify(path), folder.id);
      }
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const index = cursor++,
            item = batch.files[index];
          if (!item) return;
          try {
            const parent = paths.get(JSON.stringify(item.path));
            if (parent === undefined) throw new Error(labels.badPath);
            if (item.file.size > MAX_UPLOAD_BYTES)
              throw new Error(labels.tooLarge);
            const reservation = await reserve(scope, item.file, parent);
            const url = reservation.url.startsWith("/")
              ? `${reservation.url}&${new URLSearchParams({ ...scope })}`
              : reservation.url;
            await new Promise<void>((resolve, reject) => {
              const request = new XMLHttpRequest();
              request.open("PUT", url);
              request.setRequestHeader(
                "Content-Type",
                item.file.type || "application/octet-stream",
              );
              request.timeout = 600_000;
              request.upload.onprogress = (event) =>
                update(
                  index,
                  event.lengthComputable
                    ? Math.min(
                        95,
                        Math.round((event.loaded / event.total) * 95),
                      )
                    : 0,
                );
              request.onload = () =>
                request.status >= 200 && request.status < 300
                  ? resolve()
                  : reject(new Error(labels.uploadFailed));
              request.onerror = () => reject(new Error(labels.uploadFailed));
              request.ontimeout = () => reject(new Error(labels.uploadFailed));
              request.send(item.file);
            });
            const result = await command(scope, "complete", {
              uploadId: reservation.uploadId,
            });
            patchFiles(client, cacheScope, result.entries);
            update(index, 100);
          } catch (failure) {
            update(
              index,
              0,
              failure instanceof Error ? failure.message : labels.uploadFailed,
            );
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : labels.uploadFailed,
      );
    } finally {
      uploadLock.current = false;
    }
  }
  function drop(event: DragEvent, destination: string | null) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (busy) return;
    if (event.dataTransfer.types.includes("Files")) {
      void nativeFileDrop(event.dataTransfer)
        .then((batch) => uploadBatch(batch, destination))
        .catch((failure) => setError(String(failure)));
      return;
    }
    try {
      const value = JSON.parse(event.dataTransfer.getData(dragType)) as {
        scope?: string;
        ids?: unknown;
      };
      if (
        value.scope !== cacheScope ||
        !Array.isArray(value.ids) ||
        !value.ids.every((id) => typeof id === "string")
      )
        return;
      void paste(destination, {
        ids: value.ids,
        operation:
          event.altKey || event.dataTransfer.effectAllowed === "copy"
            ? "copy"
            : "move",
      });
    } catch {
      setError(labels.badDrag);
    }
  }
  function drag(event: DragEvent, entry: FileEntry) {
    event.dataTransfer.setData(
      dragType,
      JSON.stringify({
        scope: cacheScope,
        ids: selection.includes(entry.id) ? selection : [entry.id],
      }),
    );
    event.dataTransfer.effectAllowed =
      entry.canEdit && entry.ownerId === crm.userId ? "copyMove" : "copy";
  }
  const common = {
    selection,
    choose,
    open,
    prefetch,
    drag,
    drop,
    setDialog,
    scope,
    userId: crm.userId,
    busy,
  };
  return (
    <section
      className="file-library"
      ref={root}
      tabIndex={-1}
      aria-label={labels.browser}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDragOver={(event) => {
        if (writable) event.preventDefault();
      }}
      onDrop={(event) => {
        if (writable) drop(event, parentId);
      }}
      onKeyDown={(event) => {
        if (isFileInput(event.target) || dialog || opened || busy) return;
        const shortcut = fileShortcut(event);
        if (!shortcut) return;
        event.stopPropagation();
        event.preventDefault();
        if (shortcut === "all") setSelection(visible.map((entry) => entry.id));
        if (shortcut === "copy" && selected.length)
          setClipboard({ ids: selection, operation: "copy" });
        if (shortcut === "cut" && owned)
          setClipboard({ ids: selection, operation: "move" });
        if (shortcut === "paste" && writable) void paste();
        if (shortcut === "delete" && owned) setDialog({ kind: "delete" });
        if (shortcut === "open" && selected.length === 1 && selected[0])
          open(selected[0]);
        if (shortcut === "clear") setSelection([]);
        if (shortcut === "up" || shortcut === "down") {
          const index = visible.findIndex((entry) => entry.id === anchor);
          const next =
            visible[
              Math.max(
                0,
                Math.min(
                  visible.length - 1,
                  index + (shortcut === "up" ? -1 : 1),
                ),
              )
            ];
          if (next) choose(next, event);
        }
      }}
    >
      <div
        className="library-toolbar"
        role="toolbar"
        aria-label={labels.toolbar}
      >
        <button
          type="button"
          className="icon-button"
          aria-label={labels.parent}
          disabled={!parentId}
          onClick={() => navigate(current?.parentId ?? null)}
        >
          <ArrowUp size={16} />
        </button>
        <nav aria-label={labels.path}>
          <button
            type="button"
            onClick={() => navigate(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, null)}
          >
            {labels.title}
          </button>
          {ancestors.map((folder) => (
            <span key={folder.id}>
              <ChevronRight size={12} />
              <button
                type="button"
                title={folder.name}
                onClick={() => navigate(folder.id)}
                onDragOver={(event) => {
                  if (folder.canEdit) event.preventDefault();
                }}
                onDrop={(event) => drop(event, folder.id)}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
        <label className="library-search">
          <Search size={14} />
          <input
            aria-label={labels.search}
            placeholder={labels.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="library-view-buttons">
          {(
            [
              { id: "list", Icon: List, label: labels.list },
              { id: "grid", Icon: LayoutGrid, label: labels.grid },
              { id: "columns", Icon: Columns3, label: labels.columns },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              className="icon-button"
              aria-pressed={view === item.id}
              aria-label={item.label}
              onClick={() => {
                setView(item.id);
                try {
                  localStorage.setItem("gravity-file-view", item.id);
                } catch {}
              }}
            >
              <item.Icon size={15} />
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!writable || busy}
          onClick={() => setDialog({ kind: "folder" })}
        >
          <FolderPlus size={15} />
          {labels.newFolder}
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={!writable || busy}
          aria-label={labels.newDocument}
          onClick={() => setDialog({ kind: "markdown" })}
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className="primary"
          disabled={!writable || uploadLock.current}
          onClick={() => input.current?.click()}
        >
          <Upload size={15} />
          {labels.uploadFiles}
        </button>
        <details className="library-upload-menu">
          <summary aria-label={labels.uploadFolder}>
            <ChevronDown size={13} />
          </summary>
          <button
            type="button"
            disabled={!writable || uploadLock.current}
            onClick={() => folderInput.current?.click()}
          >
            {labels.uploadFolder}
          </button>
        </details>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={labels.uploadFiles}
          onChange={(event) => {
            if (event.target.files)
              void uploadBatch(selectedUpload([...event.target.files]));
            event.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          {...{ webkitdirectory: "" }}
          aria-label={labels.uploadFolder}
          onChange={(event) => {
            if (event.target.files)
              void uploadBatch(selectedUpload([...event.target.files]));
            event.target.value = "";
          }}
        />
      </div>
      {(selection.length > 0 || clipboard) && (
        <div className="library-selection">
          <span>
            {selection.length} {labels.selected}
          </span>
          <button
            type="button"
            disabled={!selection.length || busy}
            onClick={() => setClipboard({ ids: selection, operation: "copy" })}
          >
            <Copy size={14} />
            {labels.copy}
          </button>
          <button
            type="button"
            disabled={!owned || busy}
            onClick={() => setClipboard({ ids: selection, operation: "move" })}
          >
            <Scissors size={14} />
            {labels.cut}
          </button>
          <button
            type="button"
            disabled={!clipboard || !writable || busy}
            onClick={() => void paste()}
          >
            {labels.paste}
          </button>
          <button
            type="button"
            disabled={!owned || busy}
            onClick={() => setDialog({ kind: "delete" })}
          >
            <Trash2 size={14} />
            {labels.delete}
          </button>
        </div>
      )}
      {(error || listing.error) && (
        <p role="alert">{error || errorText(listing.error)}</p>
      )}
      {uploads.length > 0 && (
        <div className="library-uploads" aria-live="polite">
          {uploads.map((upload) => (
            <div key={upload.id}>
              <span>{upload.name}</span>
              <progress max={100} value={upload.progress} />
              <span>{upload.error || `${upload.progress}%`}</span>
            </div>
          ))}
        </div>
      )}
      <div className="library-layout">
        <aside className="library-tree" aria-label={labels.folders}>
          <button
            type="button"
            aria-pressed={!parentId}
            onClick={() => navigate(null)}
          >
            <Folder size={16} />
            {labels.title}
          </button>
          <FolderBranch
            scope={scope}
            cacheScope={cacheScope}
            parentId={null}
            active={parentId}
            navigate={navigate}
            drop={drop}
          />
        </aside>
        <div className="library-content" aria-busy={listing.isPending}>
          {listing.isPending ? (
            <p role="status">{labels.loading}</p>
          ) : view === "columns" ? (
            <Columns
              scope={scope}
              cacheScope={cacheScope}
              listing={listing.data}
              common={common}
            />
          ) : view === "grid" ? (
            <div
              className="library-grid"
              role="tree"
              aria-label={labels.title}
              aria-multiselectable="true"
            >
              {visible.map((entry) => (
                <EntryTile
                  key={entry.id}
                  entry={entry}
                  range={visible}
                  common={common}
                />
              ))}
            </div>
          ) : (
            <FileRows entries={visible} common={common} />
          )}
          {!listing.isPending &&
            !listing.error &&
            !visible.length &&
            view !== "columns" && (
              <div className="library-empty">
                <Folder size={34} />
                <p>{search ? labels.noResults : labels.empty}</p>
                {writable && (
                  <button type="button" onClick={() => input.current?.click()}>
                    <Upload size={15} />
                    {labels.uploadFiles}
                  </button>
                )}
              </div>
            )}
        </div>
      </div>
      <footer>
        <span>
          {entries.length} {labels.items}
        </span>
        <a href="/materials">{labels.stageMaterials}</a>
        <span>{labels.dropHint}</span>
      </footer>
      {dragging && writable && (
        <div className="library-drop-overlay">{labels.dropUpload}</div>
      )}
      {dialog && (
        <EntryDialog
          dialog={dialog}
          parentId={parentId}
          selected={selection}
          members={crm.data.members}
          run={run}
          close={() => setDialog(null)}
          busy={busy}
        />
      )}
      {opened && (
        <Preview
          entry={opened}
          scope={scope}
          cacheScope={cacheScope}
          run={run}
          close={() => setOpened(null)}
          busy={busy}
        />
      )}
    </section>
  );
}
type Common = {
  selection: string[];
  choose: (
    entry: FileEntry,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    range?: FileEntry[],
  ) => void;
  open: (entry: FileEntry) => void;
  prefetch: (entry: FileEntry) => void;
  drag: (event: DragEvent, entry: FileEntry) => void;
  drop: (event: DragEvent, id: string | null) => void;
  setDialog: (value: {
    kind: "rename" | "share" | "delete";
    entry?: FileEntry;
  }) => void;
  scope: FileScope;
  userId: string;
  busy: boolean;
};
function EntryActions({ entry, common }: { entry: FileEntry; common: Common }) {
  return (
    <details
      className="library-entry-menu"
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <summary aria-label={`${labels.actions} ${entry.name}`}>
        <MoreHorizontal size={16} />
      </summary>
      <div>
        <button type="button" onClick={() => common.open(entry)}>
          {labels.open}
        </button>
        {entry.kind !== "folder" && (
          <a
            href={fileUrl(common.scope, {
              operation: "download",
              id: entry.id,
            })}
          >
            <Download size={13} />
            {t.download}
          </a>
        )}
        {entry.canEdit && (
          <button
            type="button"
            disabled={common.busy}
            onClick={() => common.setDialog({ kind: "rename", entry })}
          >
            {labels.rename}
          </button>
        )}
        {entry.canShare && (
          <button
            type="button"
            disabled={common.busy}
            onClick={() => common.setDialog({ kind: "share", entry })}
          >
            <Share2 size={13} />
            {labels.share}
          </button>
        )}
        {entry.canEdit && entry.ownerId === common.userId && (
          <button
            type="button"
            disabled={common.busy}
            onClick={() => common.setDialog({ kind: "delete", entry })}
          >
            {labels.delete}
          </button>
        )}
      </div>
    </details>
  );
}
function FileRows({
  entries,
  common,
}: {
  entries: FileEntry[];
  common: Common;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 42,
    overscan: 8,
    enabled: entries.length > 100,
  });
  const items =
    entries.length > 100
      ? virtual
          .getVirtualItems()
          .map((row) => ({ entry: entries[row.index], top: row.start }))
      : entries.map((entry) => ({ entry, top: 0 }));
  return (
    <div
      className="library-rows"
      ref={scroll}
      role="tree"
      aria-label={labels.title}
      aria-multiselectable="true"
    >
      <div className="library-row library-column-header">
        <span />
        <span>{t.name}</span>
        <span>{labels.access}</span>
        <span>{t.size}</span>
        <span />
      </div>
      <div
        style={
          entries.length > 100
            ? { height: virtual.getTotalSize(), position: "relative" }
            : undefined
        }
      >
        {items.map(
          ({ entry, top }) =>
            entry && (
              <div
                role="treeitem"
                aria-selected={common.selection.includes(entry.id)}
                key={entry.id}
                className="library-row"
                style={
                  entries.length > 100
                    ? { position: "absolute", top, left: 0, right: 0 }
                    : undefined
                }
                tabIndex={0}
                draggable
                onDragStart={(event) => common.drag(event, entry)}
                onDragOver={(event) => {
                  if (entry.kind === "folder" && entry.canEdit)
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  if (entry.kind === "folder" && entry.canEdit)
                    common.drop(event, entry.id);
                }}
                onClick={(event) => common.choose(entry, event, entries)}
                onDoubleClick={() => common.open(entry)}
                onFocus={() => common.prefetch(entry)}
                onMouseEnter={() => common.prefetch(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    common.open(entry);
                  }
                }}
              >
                <input
                  type="checkbox"
                  aria-label={`${labels.select} ${entry.name}`}
                  checked={common.selection.includes(entry.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() =>
                    common.choose(
                      entry,
                      { shiftKey: false, metaKey: true, ctrlKey: false },
                      entries,
                    )
                  }
                />
                <button
                  type="button"
                  className="library-name"
                  onClick={(event) => {
                    event.stopPropagation();
                    common.open(entry);
                  }}
                >
                  <Icon entry={entry} />
                  <span>{entry.name}</span>
                </button>
                <span className="library-access">
                  {labels[entry.visibility]}
                </span>
                <span>
                  {entry.kind === "folder"
                    ? labels.folder
                    : sizeLabel(entry.size)}
                </span>
                <EntryActions entry={entry} common={common} />
              </div>
            ),
        )}
      </div>
    </div>
  );
}
function EntryTile({
  entry,
  range,
  common,
}: {
  entry: FileEntry;
  range: FileEntry[];
  common: Common;
}) {
  return (
    <div
      role="treeitem"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          common.open(entry);
        }
      }}
      className="library-tile"
      aria-selected={common.selection.includes(entry.id)}
      onClick={(event) => common.choose(entry, event, range)}
      onDoubleClick={() => common.open(entry)}
      draggable
      onDragStart={(event) => common.drag(event, entry)}
      onDragOver={(event) => {
        if (entry.kind === "folder" && entry.canEdit) event.preventDefault();
      }}
      onDrop={(event) => {
        if (entry.kind === "folder" && entry.canEdit)
          common.drop(event, entry.id);
      }}
    >
      <EntryActions entry={entry} common={common} />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          common.open(entry);
        }}
      >
        <Icon entry={entry} />
        <strong>{entry.name}</strong>
      </button>
      <small>
        {labels[entry.visibility]} ·{" "}
        {entry.kind === "folder" ? labels.folder : sizeLabel(entry.size)}
      </small>
    </div>
  );
}
function FolderBranch({
  scope,
  cacheScope,
  parentId,
  active,
  navigate,
  drop,
  depth = 0,
}: {
  scope: FileScope;
  cacheScope: string;
  parentId: string | null;
  active: string | null;
  navigate: (id: string) => void;
  drop: Common["drop"];
  depth?: number;
}) {
  const query = useQuery({
    queryKey: folderKey(cacheScope, parentId),
    queryFn: ({ signal }) => listFiles(scope, parentId, signal),
    staleTime: 60_000,
  });
  const [expanded, setExpanded] = useState<string[]>([]);
  if (depth >= 32) return null;
  return (
    <>
      {query.data?.entries
        .filter((entry) => entry.kind === "folder")
        .map((folder) => (
          <div key={folder.id}>
            <div
              className="library-tree-row"
              style={{ paddingLeft: depth * 12 }}
            >
              <button
                type="button"
                className="icon-button"
                aria-label={`${labels.expand} ${folder.name}`}
                aria-expanded={expanded.includes(folder.id)}
                onClick={() =>
                  setExpanded((current) =>
                    current.includes(folder.id)
                      ? current.filter((id) => id !== folder.id)
                      : [...current, folder.id],
                  )
                }
              >
                {expanded.includes(folder.id) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>
              <button
                type="button"
                aria-pressed={active === folder.id}
                onClick={() => navigate(folder.id)}
              >
                <Folder size={15} />
                <span>{folder.name}</span>
              </button>
            </div>
            {expanded.includes(folder.id) && (
              <FolderBranch
                scope={scope}
                cacheScope={cacheScope}
                parentId={folder.id}
                active={active}
                navigate={navigate}
                drop={drop}
                depth={depth + 1}
              />
            )}
          </div>
        ))}
    </>
  );
}
function Columns({
  scope,
  cacheScope,
  listing,
  common,
}: {
  scope: FileScope;
  cacheScope: string;
  listing: FileListing | undefined;
  common: Common;
}) {
  return (
    <div className="library-columns">
      {[null, ...(listing?.ancestors.map((entry) => entry.id) ?? [])].map(
        (parent, index) => (
          <Column
            key={parent ?? "root"}
            scope={scope}
            cacheScope={cacheScope}
            parent={parent}
            active={listing?.ancestors[index]?.id}
            common={common}
          />
        ),
      )}
    </div>
  );
}
function Column({
  scope,
  cacheScope,
  parent,
  active,
  common,
}: {
  scope: FileScope;
  cacheScope: string;
  parent: string | null;
  active?: string;
  common: Common;
}) {
  const query = useQuery({
    queryKey: folderKey(cacheScope, parent),
    queryFn: ({ signal }) => listFiles(scope, parent, signal),
    staleTime: 60_000,
  });
  return (
    <div
      role="tree"
      aria-label={labels.columns}
      aria-multiselectable="true"
      className="library-column"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => common.drop(event, parent)}
    >
      {query.isPending ? (
        <p>{labels.loading}</p>
      ) : query.error ? (
        <p role="alert">{errorText(query.error)}</p>
      ) : (
        query.data?.entries.map((entry) => (
          <div
            role="treeitem"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                common.open(entry);
              }
            }}
            key={entry.id}
            aria-selected={
              common.selection.includes(entry.id) || active === entry.id
            }
            draggable
            onDragStart={(event) => common.drag(event, entry)}
            onClick={(event) =>
              common.choose(entry, event, query.data?.entries)
            }
            onDoubleClick={() => common.open(entry)}
            onDragOver={(event) => {
              if (entry.kind === "folder" && entry.canEdit)
                event.preventDefault();
            }}
            onDrop={(event) => {
              if (entry.kind === "folder" && entry.canEdit)
                common.drop(event, entry.id);
            }}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                common.open(entry);
              }}
            >
              <Icon entry={entry} />
              <span>{entry.name}</span>
              {entry.kind === "folder" && <ChevronRight size={14} />}
            </button>
            <EntryActions entry={entry} common={common} />
          </div>
        ))
      )}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  actions,
  close,
  children,
  wide = false,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalLifecycle(ref);
  return (
    <dialog
      ref={ref}
      className={`dialog library-dialog ${wide ? "library-preview-dialog" : ""}`}
      aria-labelledby="library-dialog-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
    >
      <header>
        <div className="library-dialog-heading">
          <h2 id="library-dialog-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
        <button
          type="button"
          className="icon-button"
          aria-label={t.close}
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function EntryDialog({
  dialog,
  parentId,
  selected,
  members,
  run,
  close,
  busy,
}: {
  dialog: {
    kind: "folder" | "markdown" | "rename" | "share" | "delete";
    entry?: FileEntry;
  };
  parentId: string | null;
  selected: string[];
  members: { id: string; name: string }[];
  run: (operation: string, input: object) => Promise<unknown>;
  close: () => void;
  busy: boolean;
}) {
  const entry = dialog.entry;
  const [name, setName] = useState(
    entry?.name ?? (dialog.kind === "markdown" ? labels.untitled : ""),
  );
  const [visibility, setVisibility] = useState<FileEntry["visibility"]>(
    entry?.visibility ?? (parentId ? "inherit" : "private"),
  );
  const [grants, setGrants] = useState<FileGrant[]>(entry?.grants ?? []);
  const [error, setError] = useState("");
  const title =
    dialog.kind === "folder"
      ? labels.newFolder
      : dialog.kind === "markdown"
        ? labels.newDocument
        : labels[dialog.kind];
  return (
    <Modal title={title} close={close} busy={busy}>
      <form
        className="dialog-fields"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            if (dialog.kind === "delete")
              await run("transfer", {
                ids: entry ? [entry.id] : selected,
                operation: "delete",
                parentId: null,
              });
            else if (dialog.kind === "rename" && entry)
              await run("update", {
                id: entry.id,
                name,
                expectedSyncId: entry.syncId,
              });
            else if (dialog.kind === "share" && entry)
              await run("update", {
                id: entry.id,
                access: {
                  visibility,
                  grants: visibility === "shared" ? grants : [],
                },
                expectedSyncId: entry.syncId,
              });
            else
              await run("create", {
                name,
                kind: dialog.kind,
                parentId,
                visibility,
                body:
                  dialog.kind === "markdown"
                    ? `# ${name.replace(/\.(md|markdown)$/i, "")}\n`
                    : "",
              });
            close();
          } catch (failure) {
            setError(errorText(failure));
          }
        }}
      >
        <fieldset disabled={busy}>
          {dialog.kind === "delete" ? (
            <p>{labels.deleteHint}</p>
          ) : (
            dialog.kind !== "share" && (
              <label>
                {t.name}
                <input
                  required
                  maxLength={255}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  data-primary-field
                />
              </label>
            )
          )}
          {dialog.kind !== "rename" && dialog.kind !== "delete" && (
            <>
              <label>
                {labels.access}
                <select
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as FileEntry["visibility"])
                  }
                >
                  {(
                    [
                      "private",
                      "workspace",
                      "public",
                      "shared",
                      ...(entry?.parentId || parentId ? ["inherit"] : []),
                    ] as FileEntry["visibility"][]
                  ).map((value) => (
                    <option key={value} value={value}>
                      {labels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                {visibility === "public"
                  ? labels.publicHint
                  : labels.productHint}
              </p>
            </>
          )}
          {visibility === "shared" && dialog.kind === "share" && (
            <div className="library-grants">
              {members.map((member) => {
                const grant = grants.find((item) => item.userId === member.id);
                return (
                  <label key={member.id}>
                    <input
                      type="checkbox"
                      checked={!!grant}
                      onChange={(event) =>
                        setGrants((current) =>
                          event.target.checked
                            ? [
                                ...current,
                                { userId: member.id, role: "viewer" },
                              ]
                            : current.filter(
                                (item) => item.userId !== member.id,
                              ),
                        )
                      }
                    />
                    {member.name}
                    {grant && (
                      <select
                        aria-label={`${labels.role} ${member.name}`}
                        value={grant.role}
                        onChange={(event) =>
                          setGrants((current) =>
                            current.map((item) =>
                              item.userId === member.id
                                ? {
                                    ...item,
                                    role:
                                      event.target.value === "editor"
                                        ? "editor"
                                        : "viewer",
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="viewer">{labels.viewer}</option>
                        <option value="editor">{labels.editor}</option>
                      </select>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
        {entry?.publicToken && dialog.kind === "share" && (
          <label>
            {labels.publicLink}
            <input
              readOnly
              value={`${window.location.origin}/shared/files/${entry.publicToken}`}
              onFocus={(event) => event.target.select()}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={close}>
            {t.cancel}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy
              ? t.saving
              : dialog.kind === "delete"
                ? labels.delete
                : t.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Preview({
  entry,
  scope,
  cacheScope,
  run,
  close,
  busy,
}: {
  entry: FileEntry;
  scope: FileScope;
  cacheScope: string;
  run: (operation: string, input: object) => Promise<unknown>;
  close: () => void;
  busy: boolean;
}) {
  const query = useQuery({
    queryKey: fileKey(cacheScope, entry.id),
    queryFn: ({ signal }) => detail(scope, entry.id, signal),
    staleTime: 0,
    gcTime: 0,
  });
  const current = query.data?.entry;
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [version, setVersion] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (query.error || query.data?.entry.canEdit === false) {
      setEditing(false);
      setDraft("");
    }
  }, [query.error, query.data?.entry.canEdit]);
  return (
    <Modal
      title={current?.name ?? entry.name}
      close={close}
      wide
      busy={busy}
      subtitle={
        current
          ? `${current.kind === "markdown" ? labels.markdown : current.name.split(".").at(-1)?.toUpperCase()} · ${sizeLabel(current.size)}`
          : labels.loading
      }
      actions={
        current &&
        !query.isFetching &&
        !query.error && (
          <a
            className="button"
            aria-label={`${t.download} ${current.name}`}
            href={fileUrl(scope, { operation: "download", id: entry.id })}
          >
            <Download size={15} />
            {t.download}
          </a>
        )
      }
    >
      <div className="file-preview">
        {query.isFetching ? (
          <p role="status">{labels.loading}</p>
        ) : query.error ? (
          <p role="alert">{errorText(query.error)}</p>
        ) : current?.kind === "file" ? (
          <FilePreview
            entry={current}
            downloadPath={fileUrl(scope, {
              operation: "download",
              id: entry.id,
            })}
          />
        ) : (
          current && (
            <>
              {editing ? (
                <>
                  <div className="library-markdown-editor">
                    <textarea
                      aria-label={labels.source}
                      maxLength={1_000_000}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <MarkdownPreview body={draft} />
                  </div>
                  <div className="dialog-actions">
                    <button type="button" onClick={() => setEditing(false)}>
                      {t.cancel}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await run("update", {
                            id: entry.id,
                            body: draft,
                            expectedSyncId: version,
                          });
                          setEditing(false);
                        } catch (failure) {
                          setError(errorText(failure));
                        }
                      }}
                    >
                      {t.save}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <MarkdownPreview body={query.data?.body ?? ""} />
                  {current.canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(query.data?.body ?? "");
                        setVersion(current.syncId);
                        setEditing(true);
                      }}
                    >
                      {labels.editMarkdown}
                    </button>
                  )}
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          )
        )}
      </div>
    </Modal>
  );
}
