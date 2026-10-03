import { validationFailed } from '../errors/index.ts';
import {
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOperator,
  ME_FILTER_VALUE,
  NAMED_DATE_VALUES,
  UNSET_FILTER_VALUE,
} from './ast.ts';

export type FilterObject = 'lead' | 'person' | 'company';
export type FilterValueKind = 'id' | 'enum' | 'number' | 'text' | 'date' | 'boolean' | 'multi';
export type FilterReadValue = string | number | boolean | null | readonly string[];

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterProperty<TRecord> {
  readonly key: string;
  readonly label: string;
  readonly kind: FilterValueKind;
  readonly allowsMe?: boolean;
  readonly options?: readonly FilterOption[];
  readonly read: (record: TRecord) => FilterReadValue;
}

export interface FilterRegistry<TRecord> {
  readonly object: FilterObject;
  readonly properties: readonly FilterProperty<TRecord>[];
  readonly search: (record: TRecord) => readonly (string | null)[];
}

export const OPERATORS_BY_KIND: Record<FilterValueKind, readonly FilterOperator[]> = {
  id: ['in'],
  enum: ['in'],
  number: ['in', 'range'],
  text: ['contains'],
  date: ['in', 'range', 'relative'],
  boolean: ['in'],
  multi: ['in'],
};

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function propertyOf<T>(
  registry: FilterRegistry<T>,
  key: string,
): FilterProperty<T> | undefined {
  return registry.properties.find((property) => property.key === key);
}

const NAMED_DATES: readonly string[] = NAMED_DATE_VALUES;

function isNumberToken(value: string): boolean {
  return value === UNSET_FILTER_VALUE || Number.isFinite(Number(value));
}

function inValueIssue<T>(property: FilterProperty<T>, values: readonly string[]): string | null {
  if (values.includes(ME_FILTER_VALUE) && property.allowsMe !== true) {
    return `${property.label} cannot be filtered by me.`;
  }
  if (property.kind === 'date' && values.some((value) => !NAMED_DATES.includes(value))) {
    return `${property.label} takes none, any, overdue or today.`;
  }
  if (
    property.kind === 'boolean' &&
    values.some((value) => value !== 'true' && value !== 'false')
  ) {
    return `${property.label} takes true or false.`;
  }
  if (property.kind === 'number' && !values.every(isNumberToken)) {
    return `${property.label} takes numbers.`;
  }
  return null;
}

function rangeValueIssue<T>(
  property: FilterProperty<T>,
  from: string | null,
  to: string | null,
): string | null {
  const bounds = [from, to].filter((bound): bound is string => bound !== null);
  if (property.kind === 'number') {
    return bounds.every((bound) => Number.isFinite(Number(bound)))
      ? null
      : `${property.label} needs numbers.`;
  }
  return bounds.every((bound) => CALENDAR_DAY.test(bound))
    ? null
    : `${property.label} needs days like 2026-10-03.`;
}

function valueIssue<T>(property: FilterProperty<T>, condition: FilterCondition): string | null {
  if (condition.operator === 'in') return inValueIssue(property, condition.values);
  if (condition.operator === 'range')
    return rangeValueIssue(property, condition.from, condition.to);
  return null;
}

function conditionIssue<T>(registry: FilterRegistry<T>, condition: FilterCondition): string | null {
  const property = propertyOf(registry, condition.property);
  if (property === undefined) {
    return `There is no ${registry.object} filter called ${condition.property}.`;
  }
  if (!OPERATORS_BY_KIND[property.kind].includes(condition.operator)) {
    return `${property.label} does not support ${condition.operator}.`;
  }
  return valueIssue(property, condition);
}

function collectIssues<T>(node: FilterNode, registry: FilterRegistry<T>, issues: string[]): void {
  if (node.kind === 'condition') {
    const issue = conditionIssue(registry, node);
    if (issue !== null) issues.push(issue);
    return;
  }
  for (const child of node.children) collectIssues(child, registry, issues);
}

export function filterIssues<T>(group: FilterGroup, registry: FilterRegistry<T>): string[] {
  const issues: string[] = [];
  collectIssues(group, registry, issues);
  return issues;
}

export function assertFilterFits<T>(group: FilterGroup, registry: FilterRegistry<T>): FilterGroup {
  const issues = filterIssues(group, registry);
  const first = issues[0];
  if (first !== undefined) throw validationFailed(first, { details: { issues } });
  return group;
}

function pruneNode<T>(node: FilterNode, registry: FilterRegistry<T>): FilterNode | null {
  if (node.kind === 'condition') return conditionIssue(registry, node) === null ? node : null;
  const children = node.children.flatMap((child) => {
    const kept = pruneNode(child, registry);
    return kept === null ? [] : [kept];
  });
  return { ...node, children };
}

export function pruneFilter<T>(group: FilterGroup, registry: FilterRegistry<T>): FilterGroup {
  const pruned = pruneNode(group, registry);
  return pruned === null || pruned.kind === 'condition' ? { ...group, children: [] } : pruned;
}
