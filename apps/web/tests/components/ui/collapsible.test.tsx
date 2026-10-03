import { describe, expect, test } from 'bun:test';
import { act, render, screen } from '@testing-library/react';
import { Collapsible } from '@/components/ui/collapsible.tsx';

async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe('Collapsible', () => {
  test('renders nothing while closed', () => {
    render(
      <Collapsible open={false}>
        <span>Details</span>
      </Collapsible>,
    );
    expect(screen.queryByText('Details')).toBeNull();
  });

  test('renders its children when open and fades them in', async () => {
    const { rerender } = render(
      <Collapsible open={false}>
        <span>Details</span>
      </Collapsible>,
    );
    rerender(
      <Collapsible open>
        <span>Details</span>
      </Collapsible>,
    );
    const panel = screen.getByText('Details').parentElement;
    expect(panel).toHaveAttribute('data-state', 'closed');
    expect(panel?.className).toContain('opacity-0');
    await nextFrame();
    expect(panel).toHaveAttribute('data-state', 'open');
    expect(panel?.className).toContain('opacity-100');
  });

  test('unmounts again when closed', () => {
    const { rerender } = render(
      <Collapsible open>
        <span>Details</span>
      </Collapsible>,
    );
    expect(screen.getByText('Details')).toBeInTheDocument();
    rerender(
      <Collapsible open={false}>
        <span>Details</span>
      </Collapsible>,
    );
    expect(screen.queryByText('Details')).toBeNull();
  });

  test('transitions opacity only, never a layout property', () => {
    render(
      <Collapsible open className="extra">
        <span>Details</span>
      </Collapsible>,
    );
    const panel = screen.getByText('Details').parentElement;
    expect(panel?.className).toContain('transition-opacity');
    expect(panel?.className).toContain('motion-reduce:transition-none');
    expect(panel?.className).toContain('extra');
    expect(panel?.className).not.toContain('grid-template-rows');
    expect(panel?.getAttribute('style') ?? '').not.toContain('grid-template-rows');
  });
});
