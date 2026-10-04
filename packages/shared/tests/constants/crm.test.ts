import { describe, expect, test } from 'bun:test';
import {
  CONTEXT_TOKENS,
  DEFAULT_DEAL_STAGES,
  DEFAULT_PROSPECTING_STAGES,
  defaultStagesFor,
  leadPriorityLabel,
  timelineFilterMatches,
} from '../../src/constants/crm.ts';

describe('default stages', () => {
  test('prospecting has the thirteen spec stages in order with one hold stage', () => {
    expect(DEFAULT_PROSPECTING_STAGES.map((stage) => stage.name)).toEqual([
      'New',
      'Researching',
      'Ready',
      'Contacted',
      'Follow-up',
      'Replied',
      'Meeting booked',
      'Meeting held',
      'Qualified',
      'On hold',
      'Closed: no reply',
      'Closed: not a fit',
      'Do not contact',
    ]);
    expect(DEFAULT_PROSPECTING_STAGES.filter((stage) => stage.category === 'hold')).toHaveLength(1);
    expect(DEFAULT_PROSPECTING_STAGES[0]?.category).toBe('open');
  });

  test('deals pipelines get the deal stages', () => {
    expect(defaultStagesFor('deals')).toBe(DEFAULT_DEAL_STAGES);
    expect(defaultStagesFor('people')).toBe(DEFAULT_PROSPECTING_STAGES);
  });
});

describe('timelineFilterMatches', () => {
  test('changes covers record activity and nothing else', () => {
    expect(timelineFilterMatches('changes', 'lead.stage_changed')).toBe(true);
    expect(timelineFilterMatches('changes', 'note.created')).toBe(false);
    expect(timelineFilterMatches('notes', 'lead.stage_changed')).toBe(false);
    expect(timelineFilterMatches('all', 'anything.at_all')).toBe(true);
  });
});

describe('context bounds and priority labels', () => {
  test('the token bounds are fixed', () => {
    expect(CONTEXT_TOKENS).toEqual({ min: 200, default: 2000, max: 8000 });
  });

  test('a priority is named and an unknown one reads as no priority', () => {
    expect(leadPriorityLabel(1)).toBe('Urgent');
    expect(leadPriorityLabel(2)).toBe('High');
    expect(leadPriorityLabel(4)).toBe('Low');
    expect(leadPriorityLabel(0)).toBe('No priority');
    expect(leadPriorityLabel(9)).toBe('No priority');
  });
});
