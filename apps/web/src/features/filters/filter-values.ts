import {
  type FilterCondition,
  type FilterOption,
  type FilterProperty,
  type FilterRegistry,
  propertyOf,
  type RelativeDate,
} from '@gravity/shared/filters';
import type { MemberRow, StageRow } from '@gravity/shared/records';

export interface FilterSources {
  readonly stages: readonly StageRow[];
  readonly members: readonly MemberRow[];
}

export const DATE_OPTIONS: readonly FilterOption[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'any', label: 'Set' },
  { value: 'none', label: 'Not set' },
];

export const DATE_PRESETS: readonly { readonly label: string; readonly relative: RelativeDate }[] =
  [
    { label: 'In the past 7 days', relative: { unit: 'day', offset: 7, direction: 'past' } },
    { label: 'In the past 30 days', relative: { unit: 'day', offset: 30, direction: 'past' } },
    { label: 'In the next 7 days', relative: { unit: 'day', offset: 7, direction: 'future' } },
  ];

export function valueOptionsFor<T>(
  property: FilterProperty<T>,
  sources: FilterSources,
): FilterOption[] {
  if (property.key === 'stage') {
    return sources.stages
      .filter((stage) => stage.archivedAt === null)
      .map((stage) => ({ value: stage.id, label: stage.name }));
  }
  if (property.key === 'owner') {
    return [
      { value: 'me', label: 'Me' },
      { value: 'none', label: 'Unassigned' },
      ...sources.members.map((member) => ({ value: member.userId, label: member.name })),
    ];
  }
  if (property.kind === 'date') return [...DATE_OPTIONS];
  if (property.kind === 'boolean') {
    return [
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ];
  }
  return [...(property.options ?? [])];
}

function unitLabel(relative: RelativeDate): string {
  return relative.offset === 1 ? relative.unit : `${relative.unit}s`;
}

function stageLabel(value: string, sources: FilterSources): string | undefined {
  return sources.stages.find((stage) => stage.id === value)?.name;
}

export function describeCondition<T>(
  condition: FilterCondition,
  registry: FilterRegistry<T>,
  sources: FilterSources,
): string {
  const property = propertyOf(registry, condition.property);
  const label = property?.label ?? condition.property;
  const verb = condition.negate ? 'is not' : 'is';
  switch (condition.operator) {
    case 'in': {
      const options = property === undefined ? [] : valueOptionsFor(property, sources);
      const values = condition.values.map(
        (value) =>
          options.find((option) => option.value === value)?.label ??
          (property?.key === 'stage' ? stageLabel(value, sources) : undefined) ??
          value,
      );
      return `${label} ${verb} ${values.join(' or ')}`;
    }
    case 'contains':
      return `${label} ${condition.negate ? 'does not contain' : 'contains'} ${condition.value}`;
    case 'range':
      return `${label} ${condition.negate ? 'outside' : 'between'} ${condition.from ?? 'any'} and ${condition.to ?? 'any'}`;
    case 'relative': {
      const direction = condition.relative.direction === 'past' ? 'in the past' : 'in the next';
      return `${label} ${direction} ${condition.relative.offset} ${unitLabel(condition.relative)}`;
    }
  }
}
