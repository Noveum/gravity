import { afterEach, describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { ImportScreen } from '@/features/import/import-screen.tsx';
import { renderWithClient } from '../../support/render.tsx';
import { setViewportWidth } from '../../support/viewport.ts';

afterEach(() => {
  setViewportWidth(0);
});

describe('ImportScreen', () => {
  test('shows the wider screen notice below 900px and no controls', () => {
    setViewportWidth(375);
    renderWithClient(<ImportScreen initialTarget="people" initialPipelineKey={null} />);
    expect(
      screen.getByText('Imports are available on screens 900 pixels wide and larger.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Import file')).not.toBeInTheDocument();
  });

  test('shows the import page from 900px', () => {
    setViewportWidth(1440);
    renderWithClient(<ImportScreen initialTarget="people" initialPipelineKey={null} />);
    expect(screen.getByLabelText('Import file')).toBeInTheDocument();
    expect(
      screen.queryByText('Imports are available on screens 900 pixels wide and larger.'),
    ).not.toBeInTheDocument();
  });
});
