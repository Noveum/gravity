import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { ListSkeleton } from '@/components/ui/list-skeleton.tsx';

describe('ListSkeleton', () => {
  test('announces loading and draws compact 28px rows with no row borders, like the lead rows', () => {
    render(<ListSkeleton />);
    const skeleton = screen.getByRole('status', { name: 'Loading' });
    const rows = skeleton.querySelectorAll('.h-7');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toContain('px-3');
      expect(row.className).not.toContain('border-b');
    }
  });
});
