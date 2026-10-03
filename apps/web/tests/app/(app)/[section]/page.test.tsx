import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import SectionPage from '@/app/(app)/[section]/page.tsx';

function params(section: string) {
  return { params: Promise.resolve({ section }) };
}

describe('section page', () => {
  test('shows an empty state for a navigable section', async () => {
    render(await SectionPage(params('companies')));
    expect(screen.getByText('Companies')).toBeInTheDocument();
    expect(screen.getByText(/arrives in the next milestone/)).toBeInTheDocument();
  });

  test('is not found for an unknown section', async () => {
    await expect(SectionPage(params('issues'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  test('is not found for settings, which has its own pages', async () => {
    await expect(SectionPage(params('settings'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });
});
