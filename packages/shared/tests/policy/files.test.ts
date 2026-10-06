import { describe, expect, test } from 'bun:test';
import {
  canAccessFile,
  type FileAccessNode,
  fileDescendants,
  type Principal,
} from '../../src/policy/index.ts';

const member: Principal = { userId: 'member', organizationId: 'org', role: 'member' };
const owner: Principal = { userId: 'owner', organizationId: 'org', role: 'admin' };
function node(id: string, overrides: Partial<FileAccessNode> = {}): FileAccessNode {
  return {
    id,
    organizationId: 'org',
    parentId: null,
    ownerId: 'owner',
    visibility: 'private',
    grants: [],
    ...overrides,
  };
}

describe('file policy', () => {
  test('inherits specific viewer and editor roles through nested folders', () => {
    const root = node('root', {
      visibility: 'shared',
      grants: [{ userId: 'member', role: 'viewer' }],
    });
    const folder = node('folder', { parentId: 'root', visibility: 'inherit' });
    const document = node('document', { parentId: 'folder', visibility: 'inherit' });
    const tree = new Map([root, folder, document].map((item) => [item.id, item]));
    expect(canAccessFile(tree, 'document', member)).toBe(true);
    expect(canAccessFile(tree, 'document', member, 'edit')).toBe(false);
    tree.set('root', { ...root, grants: [{ userId: 'member', role: 'editor' }] });
    expect(canAccessFile(tree, 'document', member, 'edit')).toBe(true);
    expect(canAccessFile(tree, 'document', member, 'share')).toBe(false);
  });

  test('an explicit private descendant restricts a public folder', () => {
    const tree = new Map([
      ['root', node('root', { visibility: 'public' })],
      ['document', node('document', { parentId: 'root' })],
    ]);
    expect(canAccessFile(tree, 'root', null)).toBe(true);
    expect(canAccessFile(tree, 'document', null)).toBe(false);
    expect(canAccessFile(tree, 'document', owner)).toBe(true);
    expect(canAccessFile(tree, 'root', null, 'edit')).toBe(false);
  });

  test('editing inherits the nearest explicit access while every ancestor still requires read access', () => {
    const root = node('root', {
      visibility: 'shared',
      grants: [{ userId: 'member', role: 'viewer' }],
    });
    const folder = node('folder', { parentId: 'root', visibility: 'workspace' });
    const nested = node('nested', { parentId: 'folder', visibility: 'inherit' });
    const document = node('document', { parentId: 'nested', visibility: 'inherit' });
    const tree = new Map([root, folder, nested, document].map((item) => [item.id, item]));
    expect(canAccessFile(tree, 'folder', member, 'edit')).toBe(true);
    expect(canAccessFile(tree, 'document', member, 'edit')).toBe(true);
    tree.set('root', { ...root, grants: [] });
    expect(canAccessFile(tree, 'document', member, 'edit')).toBe(false);
    expect(canAccessFile(tree, 'document', member)).toBe(false);
  });

  test('cannot grant access across workspaces even when the user matches the owner', () => {
    const tree = new Map([['document', node('document', { visibility: 'public' })]]);
    expect(canAccessFile(tree, 'document', { ...owner, organizationId: 'other' })).toBe(false);
  });

  test('cycles, missing ancestors and root inheritance fail closed', () => {
    const tree = new Map([
      ['a', node('a', { visibility: 'public', parentId: 'b' })],
      ['b', node('b', { visibility: 'public', parentId: 'a' })],
    ]);
    expect(canAccessFile(tree, 'a', owner)).toBe(false);
    expect([...fileDescendants(tree, ['a'])].sort()).toEqual(['a', 'b']);
    tree.delete('b');
    expect(canAccessFile(tree, 'a', null)).toBe(false);
    tree.set('a', node('a', { visibility: 'inherit' }));
    expect(canAccessFile(tree, 'a', owner)).toBe(false);
  });
});
