import { describe, expect, mock, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ListSearch } from '@/features/filters/list-search.tsx';
import { SEARCH_DEBOUNCE_MS } from '@/lib/use-debounced-value.ts';
import { renderWithClient } from '../../support/render.tsx';

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Controlled({
  initial,
  onChange,
}: {
  readonly initial: string;
  readonly onChange: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setValue('')}>
        Clear from outside
      </button>
      <ListSearch
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next.trim());
        }}
      />
    </>
  );
}

describe('ListSearch', () => {
  test('/ focuses the box and the term is sent once typing pauses', async () => {
    const onChange = mock<(value: string) => void>();
    renderWithClient(<ListSearch value="" onChange={onChange} />);
    await userEvent.keyboard('/');
    const box = screen.getByRole('searchbox', { name: 'Search this list' });
    expect(document.activeElement).toBe(box);
    await userEvent.type(box, 'ada');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('ada'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('the debounce is 140ms', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(140);
  });

  test('an outside change replaces the draft and is not sent back', async () => {
    const onChange = mock<(value: string) => void>();
    renderWithClient(<Controlled initial="ada" onChange={onChange} />);
    const box = screen.getByRole('searchbox', { name: 'Search this list' });
    expect(box).toHaveValue('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Clear from outside' }));
    expect(box).toHaveValue('');
    await pause(SEARCH_DEBOUNCE_MS * 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('a trailing space survives the round trip through the URL', async () => {
    const onChange = mock<(value: string) => void>();
    renderWithClient(<Controlled initial="" onChange={onChange} />);
    const box = screen.getByRole('searchbox', { name: 'Search this list' });
    await userEvent.type(box, 'ada ');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('ada '));
    await pause(SEARCH_DEBOUNCE_MS * 2);
    expect(box).toHaveValue('ada ');
  });
});
