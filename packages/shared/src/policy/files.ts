import type { FileAccess } from '../validators/files.ts';
import { can, type Principal } from './index.ts';

export interface FileAccessNode extends FileAccess {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly ownerId: string;
}

export type FileAccessTree = ReadonlyMap<string, FileAccessNode>;

function permits(node: FileAccessNode, principal: Principal | null, edit: boolean): boolean {
  if (principal !== null && principal.organizationId !== node.organizationId) return false;
  if (principal?.userId === node.ownerId) return true;
  if (node.visibility === 'inherit') return node.parentId !== null;
  if (node.visibility === 'public' && !edit) return true;
  if (principal === null) return false;
  if (node.visibility === 'workspace' || node.visibility === 'public') {
    return can(principal, edit ? 'record:write' : 'record:read');
  }
  return (
    node.visibility === 'shared' &&
    node.grants.some(
      (grant) => grant.userId === principal.userId && (!edit || grant.role === 'editor'),
    )
  );
}

export function canAccessFile(
  tree: FileAccessTree,
  id: string,
  principal: Principal | null,
  action: 'read' | 'edit' | 'share' = 'read',
): boolean {
  const node = tree.get(id);
  if (node === undefined) return false;
  if (action === 'share' && principal?.userId !== node.ownerId) return false;
  if (action !== 'read' && (principal === null || !can(principal, 'record:write'))) return false;
  let current: FileAccessNode | undefined = node;
  let inheritEdit = action === 'edit';
  const visited = new Set<string>();
  while (current !== undefined) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (!permits(current, principal, inheritEdit)) return false;
    inheritEdit = inheritEdit && current.visibility === 'inherit';
    if (current.parentId === null) return current.visibility !== 'inherit';
    current = tree.get(current.parentId);
  }
  return false;
}

export function fileDescendants(tree: FileAccessTree, ids: readonly string[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of tree.values()) {
    if (node.parentId === null) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const result = new Set<string>();
  const pending = [...ids];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || result.has(id)) continue;
    result.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return result;
}
