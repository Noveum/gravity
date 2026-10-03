import { z } from 'zod';
import { emptyFilterGroup, type FilterGroup, filterGroupSchema, isEmptyFilter } from './ast.ts';

export function encodeFilter(group: FilterGroup): string {
  return isEmptyFilter(group) ? '' : JSON.stringify(filterGroupSchema.parse(group));
}

export function decodeFilter(raw: string): FilterGroup {
  if (raw.trim().length === 0) return emptyFilterGroup();
  try {
    const parsed = filterGroupSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyFilterGroup();
  } catch {
    return emptyFilterGroup();
  }
}

export const filterGroupQuerySchema = z
  .unknown()
  .optional()
  .transform((value, ctx): FilterGroup => {
    if (value === undefined) return emptyFilterGroup();
    let candidate: unknown = value;
    if (typeof value === 'string') {
      if (value.trim().length === 0) return emptyFilterGroup();
      try {
        candidate = JSON.parse(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'The filter is not valid JSON.' });
        return z.NEVER;
      }
    }
    const parsed = filterGroupSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
    return z.NEVER;
  });

export interface ListQuery {
  readonly filter: FilterGroup;
  readonly q: string;
}

export const EMPTY_LIST_QUERY: ListQuery = { filter: emptyFilterGroup(), q: '' };

export function encodeListQuery(query: ListQuery): string {
  const params = new URLSearchParams();
  const filter = encodeFilter(query.filter);
  if (filter.length > 0) params.set('filter', filter);
  const q = query.q.trim();
  if (q.length > 0) params.set('q', q);
  return params.toString();
}

export function decodeListQuery(search: string): ListQuery {
  const params = new URLSearchParams(search);
  return { filter: decodeFilter(params.get('filter') ?? ''), q: (params.get('q') ?? '').trim() };
}
