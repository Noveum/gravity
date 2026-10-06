import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { MarkdownPreview } from '@/features/files/markdown-preview.tsx';

describe('Markdown documents', () => {
  test('renders headings, links, lists and GFM tables', () => {
    render(
      <MarkdownPreview
        body={
          '# Project\n\n- First\n- Second\n\n[Reference](https://example.com)\n\n| File | Scope |\n| --- | --- |\n| Guide | Private |'
        }
      />,
    );
    expect(screen.getByRole('heading', { name: 'Project' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Reference' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
    expect(screen.getByRole('table')).toBeVisible();
  });

  test('does not execute HTML or automatically load embedded remote images', () => {
    const { container } = render(
      <MarkdownPreview
        body={
          '<script>window.privateData = true</script>\n\n![Private image](https://example.com/tracker.png)\n\n[Unsafe](javascript:alert(1))'
        }
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Private image' })).toHaveAttribute(
      'href',
      'https://example.com/tracker.png',
    );
    expect(screen.getByText('Unsafe').getAttribute('href')).not.toMatch(/^javascript:/);
  });
});
