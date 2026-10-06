import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { authorize } from "../core/policy";
import type { Database } from "../database/client";
import * as schema from "../database/schema";
import { canAccessFile, fileDescendants } from "./policy";
import type {
  Executor,
  FilePrincipal as Principal,
  FileBatch as SyncBatch,
  FileContext as WriteContext,
} from "./scope";
import {
  assertCan,
  conflict,
  forbidden,
  notFound,
  requireRow,
  validationFailed,
} from "./scope";
import {
  type FileStorage,
  objectStorage,
  UnsupportedTextEncoding,
  writeLocalUpload,
} from "./storage";
import {
  type FileAccess,
  type FileEntry,
  type FileListing,
  fileCompleteSchema,
  fileCreateSchema,
  fileEntrySchema,
  fileListSchema,
  fileTransferSchema,
  fileUpdateSchema,
  fileUploadSchema,
  MAX_MARKDOWN_LENGTH,
  previewMimeForFile,
  publicFileTokenSchema,
} from "./validators";

const newId = randomUUID;
const newToken = () => randomBytes(32).toString("hex");
const fileColumns = {
  id: schema.fileEntry.id,
  organizationId: schema.fileEntry.organizationId,
  productId: schema.fileEntry.productId,
  parentId: schema.fileEntry.parentId,
  ownerId: schema.fileEntry.ownerId,
  name: schema.fileEntry.name,
  kind: schema.fileEntry.kind,
  visibility: schema.fileEntry.visibility,
  grants: schema.fileEntry.grants,
  publicToken: schema.fileEntry.publicToken,
  mimeType: schema.fileEntry.mimeType,
  size: schema.fileEntry.size,
  syncId: schema.fileEntry.syncId,
  createdAt: schema.fileEntry.createdAt,
  updatedAt: schema.fileEntry.updatedAt,
};

type FileNode = typeof schema.fileEntry.$inferSelect & FileAccess;
type Tree = Map<string, FileNode>;

function ancestorIds(organizationId: string, id: string): SQL {
  return sql`(with recursive ancestry as (
    select id, parent_id, array[id] as path from file_entry
    where organization_id = ${organizationId} and id = ${id}
    union all
    select parent.id, parent.parent_id, child.path || parent.id
    from file_entry parent join ancestry child on parent.id = child.parent_id
    where parent.organization_id = ${organizationId} and not parent.id = any(child.path)
  ) select id from ancestry)`;
}

async function fileTree(
  executor: Executor,
  organizationId: string,
  filter?: SQL,
  contentId?: string,
  productId?: string,
  principal?: Principal,
): Promise<Tree> {
  const rows = await executor
    .select({
      ...fileColumns,
      body:
        contentId === undefined
          ? sql<string | null>`null`
          : sql<
              string | null
            >`case when ${schema.fileEntry.id} = ${contentId} then ${schema.fileEntry.body} else null end`,
      storageKey:
        contentId === undefined
          ? sql<string | null>`null`
          : sql<
              string | null
            >`case when ${schema.fileEntry.id} = ${contentId} then ${schema.fileEntry.storageKey} else null end`,
    })
    .from(schema.fileEntry)
    .where(
      and(
        eq(schema.fileEntry.organizationId, organizationId),
        productId === undefined
          ? undefined
          : eq(schema.fileEntry.productId, productId),
        principal === undefined
          ? undefined
          : sql`exists (
          select 1 from memberships membership
          where membership.organization_id = ${organizationId}
            and membership.user_id = ${principal.userId} and membership.active = true
            and (membership.role = 'admin' or exists (
              select 1 from product_memberships product_membership
              where product_membership.organization_id = ${organizationId}
                and product_membership.user_id = ${principal.userId}
                and product_membership.product_id = ${schema.fileEntry.productId}
            ))
        )`,
        filter,
      ),
    );
  return new Map(
    rows.map((row) => {
      const access = fileEntrySchema
        .pick({ visibility: true, grants: true })
        .parse(row);
      return [row.id, { ...row, ...access }];
    }),
  );
}

function readable(
  tree: Tree,
  id: string,
  principal: Principal | null,
): FileNode {
  const node = tree.get(id);
  if (node === undefined || !canAccessFile(tree, id, principal))
    throw notFound("That file or folder does not exist.");
  return node;
}

function editable(tree: Tree, id: string, principal: Principal): FileNode {
  const node = readable(tree, id, principal);
  if (!canAccessFile(tree, id, principal, "edit"))
    throw forbidden("You can only view this file or folder.");
  return node;
}

function writableParent(
  tree: Tree,
  id: string | null,
  principal: Principal,
): void {
  assertCan(principal, "record:write");
  if (id === null) return;
  const node = editable(tree, id, principal);
  if (node.kind !== "folder")
    throw validationFailed("Files can only be placed inside folders.");
}

function present(
  tree: Tree,
  node: FileNode,
  principal: Principal | null,
): FileEntry {
  const share = canAccessFile(tree, node.id, principal, "share");
  return fileEntrySchema.parse({
    ...node,
    grants: share ? node.grants : [],
    publicToken: canAccessFile(tree, node.id, null) ? node.publicToken : null,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    canEdit: canAccessFile(tree, node.id, principal, "edit"),
    canShare: share,
  });
}

async function validateAccess(
  executor: Executor,
  principal: Principal,
  parentId: string | null,
  access: FileAccess,
): Promise<void> {
  if (parentId === null && access.visibility === "inherit")
    throw validationFailed("A root item cannot inherit access.");
  if (access.visibility !== "shared" && access.grants.length > 0)
    throw validationFailed("Specific people require the shared access scope.");
  if (
    new Set(access.grants.map((grant) => grant.userId)).size !==
    access.grants.length
  )
    throw validationFailed("Each person can only be listed once.");
  const members = await executor
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, principal.organizationId),
        eq(schema.memberships.active, true),
      ),
    );
  const memberIds = new Set(members.map((member) => member.userId));
  if (access.grants.some((grant) => !memberIds.has(grant.userId)))
    throw validationFailed("Share only with current workspace members.");
}

async function fileBatch<T extends object>(
  context: WriteContext,
  run: (batch: SyncBatch, tree: Tree) => Promise<T>,
) {
  assertCan(context.principal, "record:write");
  try {
    return await context.db.transaction(async (tx) => {
      await tx
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, context.principal.organizationId))
        .for("no key update");
      await authorize(
        tx,
        context.principal,
        context.principal.organizationId,
        context.principal.productId,
        true,
      );
      const batch: SyncBatch = {
        tx,
        context,
        organizationId: context.principal.organizationId,
      };
      return run(
        batch,
        await fileTree(
          tx,
          batch.organizationId,
          undefined,
          undefined,
          context.principal.productId,
        ),
      );
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (("code" in error && error.code === "23505") ||
        ("cause" in error &&
          error.cause instanceof Error &&
          "code" in error.cause &&
          error.cause.code === "23505"))
    )
      throw conflict("An item with this name already exists.");
    throw error;
  }
}

async function emitChanges(
  batch: SyncBatch,
  before: Tree,
  after: Tree,
  ids: Iterable<string>,
) {
  for (const id of ids) {
    const syncId = (before.get(id)?.syncId ?? 0) + 1;
    if (after.has(id)) {
      await batch.tx
        .update(schema.fileEntry)
        .set({ syncId })
        .where(eq(schema.fileEntry.id, id));
      const node = after.get(id);
      if (node) after.set(id, { ...node, syncId });
    }
    await batch.tx.insert(schema.changeEvents).values({
      organizationId: batch.organizationId,
      productId: batch.context.principal.productId,
      actorId: batch.context.principal.userId,
      type: "file.changed",
      entityId: id,
    });
  }
}

function entriesOf(
  tree: Tree,
  principal: Principal,
  ids: Iterable<string>,
): FileEntry[] {
  return [...ids].flatMap((id) => {
    const node = tree.get(id);
    return node !== undefined && canAccessFile(tree, id, principal)
      ? [present(tree, node, principal)]
      : [];
  });
}

export async function listFiles(
  db: Database,
  principal: Principal,
  input: unknown,
): Promise<FileListing> {
  await authorize(db, principal, principal.organizationId, principal.productId);
  assertCan(principal, "record:read");
  const { parentId = null } = fileListSchema.parse(input);
  const filter =
    parentId === null
      ? isNull(schema.fileEntry.parentId)
      : or(
          eq(schema.fileEntry.parentId, parentId),
          inArray(
            schema.fileEntry.id,
            ancestorIds(principal.organizationId, parentId),
          ),
        );
  const tree = await fileTree(
    db,
    principal.organizationId,
    filter,
    undefined,
    principal.productId,
    principal,
  );
  const ancestors: FileEntry[] = [];
  let cursor = parentId;
  while (cursor !== null) {
    const node = readable(tree, cursor, principal);
    if (node.kind !== "folder") throw notFound("That folder does not exist.");
    ancestors.unshift(present(tree, node, principal));
    cursor = node.parentId;
  }
  const entries = [...tree.values()]
    .filter(
      (node) =>
        node.parentId === parentId && canAccessFile(tree, node.id, principal),
    )
    .sort(
      (left, right) =>
        Number(right.kind === "folder") - Number(left.kind === "folder") ||
        left.name.localeCompare(right.name, undefined, { numeric: true }),
    );
  return {
    entries: entries.map((node) => present(tree, node, principal)),
    ancestors,
  };
}

async function fileSnapshot(
  db: Database,
  principal: Principal,
  id: string,
  metadataOnly = false,
) {
  await authorize(db, principal, principal.organizationId, principal.productId);
  const tree = await fileTree(
    db,
    principal.organizationId,
    inArray(schema.fileEntry.id, ancestorIds(principal.organizationId, id)),
    metadataOnly ? undefined : id,
    principal.productId,
    principal,
  );
  const node = readable(tree, id, principal);
  return { tree, node };
}

export async function getFile(
  db: Database,
  principal: Principal,
  id: string,
  metadataOnly = false,
) {
  const { tree, node } = await fileSnapshot(db, principal, id, metadataOnly);
  return { entry: present(tree, node, principal), body: node.body };
}

export async function createFile(context: WriteContext, input: unknown) {
  const parsed = fileCreateSchema.parse(input);
  return await fileBatch(context, async (batch, before) => {
    writableParent(before, parsed.parentId, context.principal);
    await validateAccess(batch.tx, context.principal, parsed.parentId, parsed);
    const id = newId();
    await batch.tx.insert(schema.fileEntry).values({
      id,
      organizationId: batch.organizationId,
      productId: context.principal.productId,
      ownerId: context.principal.userId,
      parentId: parsed.parentId,
      name: parsed.name,
      kind: parsed.kind,
      visibility: parsed.visibility,
      grants: parsed.grants,
      publicToken: newToken(),
      body: parsed.kind === "markdown" ? parsed.body : null,
      mimeType: parsed.kind === "markdown" ? "text/markdown" : null,
      size:
        parsed.kind === "markdown"
          ? new TextEncoder().encode(parsed.body).byteLength
          : 0,
    });
    const after = await fileTree(
      batch.tx,
      batch.organizationId,
      undefined,
      undefined,
      context.principal.productId,
    );
    await emitChanges(batch, before, after, [id]);
    return { entries: entriesOf(after, context.principal, [id]) };
  });
}

export async function updateFile(
  context: WriteContext,
  id: string,
  input: unknown,
) {
  const parsed = fileUpdateSchema.parse(input);
  return await fileBatch(context, async (batch, before) => {
    const node = editable(before, id, context.principal);
    if (parsed.expectedSyncId !== node.syncId)
      throw conflict(
        "This item changed. Reload it before saving your changes.",
      );
    if (parsed.body !== undefined && node.kind !== "markdown")
      throw validationFailed("Only Markdown files can be edited here.");
    if (parsed.access !== undefined) {
      if (!canAccessFile(before, id, context.principal, "share"))
        throw forbidden("Only the owner can change sharing.");
      await validateAccess(
        batch.tx,
        context.principal,
        node.parentId,
        parsed.access,
      );
    }
    await batch.tx
      .update(schema.fileEntry)
      .set({
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.body === undefined
          ? {}
          : {
              body: parsed.body,
              size: new TextEncoder().encode(parsed.body).byteLength,
            }),
        ...(parsed.access === undefined ? {} : parsed.access),
        updatedAt: new Date(),
      })
      .where(eq(schema.fileEntry.id, id));
    const after = await fileTree(
      batch.tx,
      batch.organizationId,
      undefined,
      undefined,
      context.principal.productId,
    );
    const changed =
      parsed.access === undefined
        ? new Set([id])
        : fileDescendants(before, [id]);
    await emitChanges(batch, before, after, changed);
    return { entries: entriesOf(after, context.principal, changed) };
  });
}

function transferRoots(
  tree: Tree,
  principal: Principal,
  ids: readonly string[],
): string[] {
  const selected = new Set(ids);
  return [...selected].filter((id) => {
    let parent = readable(tree, id, principal).parentId;
    while (parent !== null) {
      if (selected.has(parent)) return false;
      parent = tree.get(parent)?.parentId ?? null;
    }
    return true;
  });
}

function assertTransferAccess(
  tree: Tree,
  principal: Principal,
  descendants: Set<string>,
  operation: "move" | "copy" | "delete",
  parentId: string | null,
): void {
  if (descendants.size > 1000)
    throw validationFailed("Transfer at most 1,000 items at a time.");
  if (operation !== "delete" && parentId !== null && descendants.has(parentId))
    throw validationFailed("A folder cannot be placed inside itself.");
  for (const id of descendants) {
    const node = readable(tree, id, principal);
    if (operation === "copy") continue;
    editable(tree, id, principal);
    if (node.ownerId !== principal.userId)
      throw forbidden("Only owners can move or delete items.");
  }
}

function availableCopyName(node: FileNode, names: Set<string>): string {
  let name = node.name;
  let suffix = 1;
  const extension = node.kind === "folder" ? -1 : node.name.lastIndexOf(".");
  const base = extension > 0 ? node.name.slice(0, extension) : node.name;
  const ending = extension > 0 ? node.name.slice(extension) : "";
  while (names.has(name.toLowerCase())) {
    const number = suffix === 1 ? "" : ` ${suffix}`;
    const preservedEnding = ending.slice(0, 200);
    const copySuffix = ` copy${number}${preservedEnding}`;
    name = `${base.slice(0, 255 - copySuffix.length)}${copySuffix}`;
    suffix += 1;
  }
  names.add(name.toLowerCase());
  return name;
}

async function copyTree(
  batch: SyncBatch,
  before: Tree,
  roots: readonly string[],
  descendants: Set<string>,
  parentId: string | null,
): Promise<Set<string>> {
  const principal = batch.context.principal;
  const copies = new Map([...descendants].map((id) => [id, newId()]));
  const names = new Set(
    [...before.values()]
      .filter(
        (node) =>
          node.parentId === parentId && node.ownerId === principal.userId,
      )
      .map((node) => node.name.toLowerCase()),
  );
  const affected = new Set<string>();
  const originals = await batch.tx
    .select()
    .from(schema.fileEntry)
    .where(inArray(schema.fileEntry.id, [...descendants]));
  const originalById = new Map(
    originals.map((original) => [original.id, original]),
  );
  for (const id of descendants) {
    const node = readable(before, id, principal);
    const original = requireRow(
      originalById.get(id),
      "That file does not exist.",
    );
    const copyId = requireRow(copies.get(id), "That file does not exist.");
    const root = roots.includes(id);
    await batch.tx.insert(schema.fileEntry).values({
      ...original,
      id: copyId,
      name: root ? availableCopyName(node, names) : node.name,
      parentId: root ? parentId : (copies.get(node.parentId ?? "") ?? parentId),
      ownerId: principal.userId,
      visibility: root ? "private" : "inherit",
      grants: [],
      publicToken: newToken(),
      createdAt: new Date(),
      updatedAt: new Date(),
      syncId: 0,
    });
    affected.add(copyId);
  }
  return affected;
}

async function moveTree(
  batch: SyncBatch,
  before: Tree,
  roots: readonly string[],
  parentId: string | null,
): Promise<void> {
  for (const id of roots) {
    const node = editable(before, id, batch.context.principal);
    writableParent(before, node.parentId, batch.context.principal);
    if (node.visibility === "inherit" && parentId === null)
      await batch.tx
        .update(schema.fileEntry)
        .set({ visibility: "private" })
        .where(eq(schema.fileEntry.id, id));
  }
  await batch.tx
    .update(schema.fileEntry)
    .set({ parentId, updatedAt: new Date() })
    .where(inArray(schema.fileEntry.id, roots));
}

export async function transferFiles(context: WriteContext, input: unknown) {
  const parsed = fileTransferSchema.parse(input);
  return await fileBatch(context, async (batch, before) => {
    const principal = context.principal;
    if (parsed.operation !== "delete")
      writableParent(before, parsed.parentId, principal);
    const roots = transferRoots(before, principal, parsed.ids);
    const descendants = fileDescendants(before, roots);
    assertTransferAccess(
      before,
      principal,
      descendants,
      parsed.operation,
      parsed.parentId,
    );
    let affected = descendants;
    if (parsed.operation === "delete")
      await batch.tx
        .delete(schema.fileEntry)
        .where(inArray(schema.fileEntry.id, [...descendants]));
    if (parsed.operation === "move")
      await moveTree(batch, before, roots, parsed.parentId);
    if (parsed.operation === "copy")
      affected = await copyTree(
        batch,
        before,
        roots,
        descendants,
        parsed.parentId,
      );
    const after = await fileTree(
      batch.tx,
      batch.organizationId,
      undefined,
      undefined,
      context.principal.productId,
    );
    await emitChanges(batch, before, after, affected);
    return { entries: entriesOf(after, principal, affected) };
  });
}

export async function startFileUpload(
  db: Database,
  principal: Principal,
  input: unknown,
  storage: FileStorage = objectStorage(),
) {
  const parsed = fileUploadSchema.parse(input);
  await authorize(
    db,
    principal,
    principal.organizationId,
    principal.productId,
    true,
  );
  const tree = await fileTree(
    db,
    principal.organizationId,
    undefined,
    undefined,
    principal.productId,
    principal,
  );
  writableParent(tree, parsed.parentId, principal);
  const id = newId();
  const storageKey = `${principal.organizationId}/pending/${id}`;
  const url = await storage.uploadUrl(storageKey, parsed.mimeType, parsed.size);
  await db.insert(schema.fileUpload).values({
    ...parsed,
    id,
    organizationId: principal.organizationId,
    productId: principal.productId,
    ownerId: principal.userId,
    storageKey,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return { uploadId: id, url };
}

async function ownedUpload(
  executor: Executor,
  principal: Principal,
  id: string,
) {
  const [pending] = await executor
    .select()
    .from(schema.fileUpload)
    .where(
      and(
        eq(schema.fileUpload.id, id),
        eq(schema.fileUpload.organizationId, principal.organizationId),
        eq(schema.fileUpload.ownerId, principal.userId),
        eq(schema.fileUpload.productId, principal.productId),
      ),
    );
  const upload = requireRow(pending, "That upload does not exist.");
  if (upload.expiresAt.getTime() < Date.now())
    throw conflict("The upload expired. Upload the file again.");
  return upload;
}

export async function completeFileUpload(
  context: WriteContext,
  input: unknown,
  storage: FileStorage = objectStorage(),
) {
  const { uploadId } = fileCompleteSchema.parse(input);
  const principal = context.principal;
  assertCan(principal, "record:write");
  await authorize(
    context.db,
    principal,
    principal.organizationId,
    principal.productId,
    true,
  );
  const reserved = await ownedUpload(context.db, principal, uploadId);
  const destination = await fileTree(
    context.db,
    principal.organizationId,
    reserved.parentId === null
      ? isNull(schema.fileEntry.parentId)
      : inArray(
          schema.fileEntry.id,
          ancestorIds(principal.organizationId, reserved.parentId),
        ),
    undefined,
    principal.productId,
    principal,
  );
  writableParent(destination, reserved.parentId, principal);
  const id = newId();
  const storageKey = `${principal.organizationId}/files/${id}`;
  await storage.sealUpload(reserved.storageKey, storageKey, reserved.size);
  let body: string | null = null;
  if (
    /\.(md|markdown)$/i.test(reserved.name) &&
    reserved.size <= MAX_MARKDOWN_LENGTH
  ) {
    try {
      body = await storage.readText(storageKey);
    } catch (error) {
      if (!(error instanceof UnsupportedTextEncoding)) throw error;
    }
  }
  const markdown = body !== null;
  return await fileBatch(context, async (batch, before) => {
    const upload = await ownedUpload(batch.tx, principal, uploadId);
    if (
      upload.storageKey !== reserved.storageKey ||
      upload.size !== reserved.size ||
      upload.name !== reserved.name ||
      upload.mimeType !== reserved.mimeType ||
      upload.parentId !== reserved.parentId
    )
      throw conflict("The upload changed. Upload the file again.");
    writableParent(before, upload.parentId, principal);
    await batch.tx.insert(schema.fileEntry).values({
      id,
      organizationId: batch.organizationId,
      productId: context.principal.productId,
      ownerId: context.principal.userId,
      parentId: upload.parentId,
      name: upload.name,
      kind: markdown ? "markdown" : "file",
      visibility: upload.parentId === null ? "private" : "inherit",
      publicToken: newToken(),
      body,
      storageKey: markdown ? null : storageKey,
      mimeType: markdown ? "text/markdown" : upload.mimeType,
      size:
        body === null ? upload.size : new TextEncoder().encode(body).byteLength,
    });
    await batch.tx
      .delete(schema.fileUpload)
      .where(eq(schema.fileUpload.id, uploadId));
    const after = await fileTree(
      batch.tx,
      batch.organizationId,
      undefined,
      undefined,
      context.principal.productId,
    );
    await emitChanges(batch, before, after, [id]);
    return { entries: entriesOf(after, context.principal, [id]) };
  });
}

async function publicFileSnapshot(db: Database, token: string) {
  publicFileTokenSchema.parse(token);
  const [reference] = await db
    .select({
      id: schema.fileEntry.id,
      organizationId: schema.fileEntry.organizationId,
    })
    .from(schema.fileEntry)
    .where(eq(schema.fileEntry.publicToken, token));
  const ref = requireRow(reference, "This public link is unavailable.");
  const tree = await fileTree(
    db,
    ref.organizationId,
    or(
      eq(schema.fileEntry.parentId, ref.id),
      inArray(schema.fileEntry.id, ancestorIds(ref.organizationId, ref.id)),
    ),
    ref.id,
  );
  const node = readable(tree, ref.id, null);
  return { tree, node };
}

export async function getPublicFile(db: Database, token: string) {
  const { tree, node } = await publicFileSnapshot(db, token);
  return {
    entry: present(tree, node, null),
    body: node.body,
    entries: [...tree.values()]
      .filter(
        (child) =>
          child.parentId === node.id && canAccessFile(tree, child.id, null),
      )
      .map((child) => present(tree, child, null)),
  };
}

export async function fileDownload(
  db: Database,
  principal: Principal | null,
  reference: string,
  preview: boolean,
  storage?: FileStorage,
) {
  const { node: file } =
    principal === null
      ? await publicFileSnapshot(db, reference)
      : await fileSnapshot(db, principal, reference);
  if (file.kind === "folder")
    throw validationFailed("Open the folder to download its files.");
  if (file.kind === "markdown")
    return { body: file.body ?? "", name: file.name, url: null };
  if (file.storageKey === null)
    throw notFound("That file has no uploaded content.");
  const previewMime = previewMimeForFile(file.name, file.mimeType);
  const url = await (storage ?? objectStorage()).downloadUrl(
    file.storageKey,
    file.name,
    preview && previewMime !== undefined,
    previewMime === "text/csv" ? "text/plain" : previewMime,
  );
  return { body: null, name: file.name, url };
}

export async function putLocalUpload(
  context: WriteContext,
  uploadId: string,
  bytes: Uint8Array,
) {
  return fileBatch(context, async (batch) => {
    const [upload] = await batch.tx
      .select()
      .from(schema.fileUpload)
      .where(
        and(
          eq(schema.fileUpload.id, uploadId),
          eq(
            schema.fileUpload.organizationId,
            context.principal.organizationId,
          ),
          eq(schema.fileUpload.productId, context.principal.productId),
          eq(schema.fileUpload.ownerId, context.principal.userId),
        ),
      );
    if (!upload) throw notFound("This upload is unavailable.");
    if (upload.expiresAt.getTime() < Date.now())
      throw conflict("This upload expired.");
    if (upload.size !== bytes.length)
      throw validationFailed("The uploaded size differs from the reservation.");
    await writeLocalUpload(upload.storageKey, bytes);
    return { ok: true };
  });
}
