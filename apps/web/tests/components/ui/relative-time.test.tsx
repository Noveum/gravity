import { describe, expect, test } from 'bun:test';
import { relativeTime } from '@gravity/shared/utils';
import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { RelativeTime } from '@/components/ui/relative-time.tsx';

describe('RelativeTime', () => {
  test('replaces the server text with the client reading once it mounts', async () => {
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const container = document.createElement('div');
    container.innerHTML = `<time datetime="${at}">server text</time>`;
    document.body.append(container);
    const root = await act(async () => hydrateRoot(container, <RelativeTime at={at} />));
    expect(container.textContent).toBe(relativeTime(new Date(at)));
    act(() => root.unmount());
    container.remove();
  });
});
