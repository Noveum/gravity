import { describe, expect, test } from 'bun:test';
import { holdChoices, nextActionChoices } from '@/features/leads/next-action-dates.ts';

describe('date choices', () => {
  test('next action choices land at 09:00 local tomorrow, in three days and next Monday', () => {
    const wednesday = new Date(2026, 9, 7, 15, 30);
    const [tomorrow, threeDays, nextWeek] = nextActionChoices(wednesday).map(
      (choice) => new Date(choice.at ?? ''),
    );
    expect([tomorrow?.getDate(), tomorrow?.getHours()]).toEqual([8, 9]);
    expect(threeDays?.getDate()).toBe(10);
    expect([nextWeek?.getDay(), nextWeek?.getDate()]).toEqual([1, 12]);
  });

  test('on a Monday, next week means the following Monday', () => {
    const monday = new Date(2026, 9, 5, 8, 0);
    expect(new Date(nextActionChoices(monday)[2]?.at ?? '').getDate()).toBe(12);
  });

  test('hold choices start with no end date', () => {
    const choices = holdChoices(new Date(2026, 9, 7));
    expect(choices[0]).toEqual({ label: 'No end date', at: null });
    expect(choices.map((choice) => choice.label)).toEqual([
      'No end date',
      'One week',
      'One month',
      'Three months',
    ]);
  });
});
