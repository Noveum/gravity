import {
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  ME_FILTER_VALUE,
  type RelativeDate,
  UNSET_FILTER_VALUE,
} from './ast.ts';
import {
  type FilterProperty,
  type FilterReadValue,
  type FilterRegistry,
  propertyOf,
} from './registry.ts';

export interface FilterContext {
  readonly now: Date;
  readonly userId: string;
}

export interface DayRange {
  readonly from: string;
  readonly to: string;
}

export function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  const base = new Date(`${day}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function daysInUnit(unit: RelativeDate['unit']): number {
  if (unit === 'day') return 1;
  if (unit === 'week') return 7;
  return 30;
}

export function resolveRelativeRange(relative: RelativeDate, today: string): DayRange {
  const span = daysInUnit(relative.unit) * relative.offset;
  if (relative.direction === 'future') return { from: today, to: shiftDay(today, span) };
  return { from: shiftDay(today, -span), to: today };
}

export interface ResolvedValues {
  readonly concrete: readonly string[];
  readonly unset: boolean;
}

export function resolveFilterValues(
  property: { readonly allowsMe?: boolean | undefined },
  values: readonly string[],
  context: FilterContext,
): ResolvedValues {
  const wanted = values.map((value) =>
    value === ME_FILTER_VALUE && property.allowsMe === true ? context.userId : value,
  );
  return {
    concrete: wanted.filter((value) => value !== UNSET_FILTER_VALUE),
    unset: wanted.includes(UNSET_FILTER_VALUE),
  };
}

function isList(value: FilterReadValue): value is readonly string[] {
  return Array.isArray(value);
}

function dayOf(value: FilterReadValue): string | null {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

function matchesNamedDate(day: string | null, values: readonly string[], today: string): boolean {
  return values.some((value) => {
    if (value === UNSET_FILTER_VALUE) return day === null;
    if (value === 'any') return day !== null;
    if (value === 'overdue') return day !== null && day < today;
    if (value === 'today') return day === today;
    return false;
  });
}

function matchesIn<T>(
  property: FilterProperty<T>,
  value: FilterReadValue,
  values: readonly string[],
  context: FilterContext,
): boolean {
  if (property.kind === 'date') return matchesNamedDate(dayOf(value), values, utcDay(context.now));
  const { concrete, unset } = resolveFilterValues(property, values, context);
  if (property.kind === 'multi') {
    const list = isList(value) ? value : [];
    return (unset && list.length === 0) || list.some((entry) => concrete.includes(entry));
  }
  if (property.kind === 'boolean') {
    return typeof value === 'boolean' && concrete.includes(String(value));
  }
  if (value === null) return unset;
  if (property.kind === 'number') {
    return typeof value === 'number' && concrete.some((entry) => Number(entry) === value);
  }
  return typeof value === 'string' && concrete.includes(value);
}

function inRange<T>(
  property: FilterProperty<T>,
  value: FilterReadValue,
  from: string | null,
  to: string | null,
): boolean {
  if (property.kind === 'number') {
    if (typeof value !== 'number') return false;
    return (from === null || value >= Number(from)) && (to === null || value <= Number(to));
  }
  const day = dayOf(value);
  if (day === null) return false;
  return (from === null || day >= from) && (to === null || day <= to);
}

function matchesCondition<T>(
  condition: FilterCondition,
  record: T,
  registry: FilterRegistry<T>,
  context: FilterContext,
): boolean | null {
  const property = propertyOf(registry, condition.property);
  if (property === undefined) return null;
  const value = property.read(record);
  switch (condition.operator) {
    case 'in':
      return matchesIn(property, value, condition.values, context);
    case 'contains':
      return (
        typeof value === 'string' && value.toLowerCase().includes(condition.value.toLowerCase())
      );
    case 'range':
      return inRange(property, value, condition.from, condition.to);
    case 'relative': {
      const range = resolveRelativeRange(condition.relative, utcDay(context.now));
      return inRange(property, value, range.from, range.to);
    }
  }
}

function evaluateNode<T>(
  node: FilterNode,
  record: T,
  registry: FilterRegistry<T>,
  context: FilterContext,
): boolean | null {
  if (node.kind === 'condition') {
    const positive = matchesCondition(node, record, registry, context);
    if (positive === null) return null;
    return node.negate ? !positive : positive;
  }
  const results = node.children
    .map((child) => evaluateNode(child, record, registry, context))
    .filter((result): result is boolean => result !== null);
  if (results.length === 0) return null;
  return node.combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
}

export function evaluateFilter<T>(
  group: FilterGroup,
  record: T,
  registry: FilterRegistry<T>,
  context: FilterContext,
): boolean {
  return evaluateNode(group, record, registry, context) ?? true;
}

export function searchTokens(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function matchesSearch<T>(record: T, q: string, registry: FilterRegistry<T>): boolean {
  const tokens = searchTokens(q);
  if (tokens.length === 0) return true;
  const haystack = registry
    .search(record)
    .filter((field): field is string => field !== null)
    .map((field) => field.toLowerCase());
  return tokens.every((token) => haystack.some((field) => field.includes(token)));
}
