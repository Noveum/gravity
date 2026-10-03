'use client';

import type { LeadRow } from '@gravity/shared/records';
import { useRouter } from 'next/navigation';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';

export type RecordBasePath = '/people' | '/companies';

interface Trail {
  readonly basePath: RecordBasePath;
  readonly ids: readonly string[];
  readonly leadOf: ReadonlyMap<string, string>;
}

let trail: Trail | null = null;

export function setRecordTrail(basePath: RecordBasePath, ids: readonly string[]): void {
  trail = { basePath, ids: [...new Set(ids)], leadOf: new Map() };
}

export function setLeadTrail(leads: readonly Pick<LeadRow, 'personId' | 'id'>[]): void {
  const leadOf = new Map<string, string>();
  for (const lead of leads) {
    if (!leadOf.has(lead.personId)) leadOf.set(lead.personId, lead.id);
  }
  trail = { basePath: '/people', ids: [...leadOf.keys()], leadOf };
}

export function neighbourOf(
  basePath: RecordBasePath,
  id: string,
  direction: 1 | -1,
): string | null {
  if (trail === null || trail.basePath !== basePath) return null;
  const index = trail.ids.indexOf(id);
  if (index === -1) return null;
  return trail.ids[index + direction] ?? null;
}

export function trailHref(basePath: RecordBasePath, id: string): string {
  const lead = trail?.basePath === basePath ? trail.leadOf.get(id) : undefined;
  return lead === undefined ? `${basePath}/${id}` : `${basePath}/${id}?lead=${lead}`;
}

const TRAIL_KEYS = {
  section: 'Records',
  scope: 'records',
  priority: HOTKEY_PRIORITY.surface,
} as const;

export function useTrailKeys(basePath: RecordBasePath, id: string): void {
  const router = useRouter();
  const step = (direction: 1 | -1) => {
    const next = neighbourOf(basePath, id, direction);
    if (next !== null) router.push(trailHref(basePath, next));
  };
  useHotkey('[', () => step(-1), { ...TRAIL_KEYS, label: 'Previous record in the list' });
  useHotkey(']', () => step(1), { ...TRAIL_KEYS, label: 'Next record in the list' });
}
