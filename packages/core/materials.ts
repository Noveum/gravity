import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { scopeSchema } from "./crm";
import { authorize, DomainError, type Principal } from "./policy";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const folderScope = scopeSchema.extend({ folderId: z.uuid() });
export const folderRenameSchema = folderScope.extend({
  name: z.string().trim().min(1).max(100),
});
export const folderDeleteSchema = folderScope;
export const materialStatusSchema = scopeSchema.extend({
  assetId: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "approved", "archived"]),
});

export class MaterialService {
  constructor(private db: Database) {}

  private async lockFolder(
    tx: Transaction,
    principal: Principal,
    input: z.infer<typeof folderScope>,
  ) {
    const [found] = await tx
      .select()
      .from(s.folders)
      .where(
        and(
          eq(s.folders.id, input.folderId),
          eq(s.folders.organizationId, input.organizationId),
        ),
      );
    if (!found) throw new DomainError("NOT_FOUND", 404);
    await authorize(tx, principal, input.organizationId, found.productId, true);
    if (input.productId && input.productId !== found.productId)
      throw new DomainError("FORBIDDEN", 403);
    const [folder] = await tx
      .select()
      .from(s.folders)
      .where(eq(s.folders.id, found.id))
      .for("update");
    if (!folder) throw new DomainError("NOT_FOUND", 404);
    return folder;
  }

  private event(
    tx: Transaction,
    principal: Principal,
    row: { organizationId: string; productId: string; id: string },
    type: string,
  ) {
    return tx.insert(s.changeEvents).values({
      organizationId: row.organizationId,
      productId: row.productId,
      actorId: principal.userId,
      type,
      entityId: row.id,
    });
  }

  async renameFolder(
    principal: Principal,
    input: z.infer<typeof folderRenameSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const folder = await this.lockFolder(tx, principal, input);
      const [renamed] = await tx
        .update(s.folders)
        .set({ name: input.name })
        .where(eq(s.folders.id, folder.id))
        .returning();
      if (!renamed) throw new DomainError("NOT_FOUND", 404);
      await this.event(tx, principal, renamed, "folder.renamed");
      return renamed;
    });
  }

  async deleteFolder(
    principal: Principal,
    input: z.infer<typeof folderDeleteSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const folder = await this.lockFolder(tx, principal, input);
      const [child] = await tx
        .select({ id: s.folders.id })
        .from(s.folders)
        .where(
          and(
            eq(s.folders.organizationId, folder.organizationId),
            eq(s.folders.parentId, folder.id),
          ),
        )
        .limit(1);
      const [asset] = await tx
        .select({ id: s.assets.id })
        .from(s.assets)
        .where(
          and(
            eq(s.assets.organizationId, folder.organizationId),
            eq(s.assets.folderId, folder.id),
          ),
        )
        .limit(1);
      if (child || asset) throw new DomainError("FOLDER_NOT_EMPTY", 409);
      await tx.delete(s.folders).where(eq(s.folders.id, folder.id));
      await this.event(tx, principal, folder, "folder.deleted");
      return { id: folder.id, productId: folder.productId, deleted: true };
    });
  }

  async setStatus(
    principal: Principal,
    input: z.infer<typeof materialStatusSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ id: s.assets.id, productId: s.assets.productId })
        .from(s.assets)
        .where(
          and(
            eq(s.assets.id, input.assetId),
            eq(s.assets.organizationId, input.organizationId),
          ),
        );
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      if (input.productId && input.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      const [updated] = await tx
        .update(s.assets)
        .set({ status: input.status, version: input.version + 1 })
        .where(
          and(eq(s.assets.id, found.id), eq(s.assets.version, input.version)),
        )
        .returning({
          id: s.assets.id,
          organizationId: s.assets.organizationId,
          productId: s.assets.productId,
          folderId: s.assets.folderId,
          name: s.assets.name,
          status: s.assets.status,
          version: s.assets.version,
        });
      if (!updated) throw new DomainError("CONFLICT", 409);
      await this.event(tx, principal, updated, "asset.status_changed");
      return updated;
    });
  }
}
