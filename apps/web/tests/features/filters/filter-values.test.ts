import { describe, expect, test } from 'bun:test';
import {
  containsCondition,
  inCondition,
  leadFilterRegistry,
  propertyOf,
} from '@gravity/shared/filters';
import { describeCondition, valueOptionsFor } from '@/features/filters/filter-values.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';

const bootstrap = bootstrapFixture();
const sources = { stages: bootstrap.stages, members: bootstrap.members };
const registry = leadFilterRegistry();

describe('filter values', () => {
  test('owner offers me, unassigned and every member', () => {
    const owner = propertyOf(registry, 'owner');
    if (owner === undefined) throw new Error('owner property');
    expect(valueOptionsFor(owner, sources).map((option) => option.label)).toEqual([
      'Me',
      'Unassigned',
      'Ada Admin',
      'Tess Teammate',
    ]);
  });

  test('stage offers live stages only', () => {
    const stage = propertyOf(registry, 'stage');
    if (stage === undefined) throw new Error('stage property');
    const stages = bootstrap.stages.map((entry) =>
      entry.id === 'ready' ? { ...entry, archivedAt: '2026-10-02T10:00:00.000Z' } : entry,
    );
    const labels = valueOptionsFor(stage, { stages, members: [] }).map((option) => option.label);
    expect(labels).toContain('New');
    expect(labels).not.toContain('Ready');
  });

  test('describes conditions in words', () => {
    expect(describeCondition(inCondition('stage', ['new', 'ready']), registry, sources)).toBe(
      'Stage is New or Ready',
    );
    expect(describeCondition(inCondition('owner', ['me'], true), registry, sources)).toBe(
      'Owner is not Me',
    );
    expect(describeCondition(containsCondition('company', 'acme'), registry, sources)).toBe(
      'Company contains acme',
    );
    expect(describeCondition(inCondition('nextActionAt', ['overdue']), registry, sources)).toBe(
      'Next action date is Overdue',
    );
    expect(
      describeCondition(
        {
          kind: 'condition',
          property: 'created',
          operator: 'relative',
          relative: { unit: 'day', offset: 7, direction: 'past' },
          negate: false,
        },
        registry,
        sources,
      ),
    ).toBe('Created in the past 7 days');
  });
});
