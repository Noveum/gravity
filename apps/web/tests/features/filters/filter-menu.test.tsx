import { describe, expect, mock, test } from 'bun:test';
import { emptyFilterGroup, type FilterGroup, leadFilterRegistry } from '@gravity/shared/filters';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { FilterMenu } from '@/features/filters/filter-menu.tsx';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { renderWithClient } from '../../support/render.tsx';

const bootstrap = bootstrapFixture();

function Harness({ onChange }: { readonly onChange: (filter: FilterGroup) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(emptyFilterGroup());
  return (
    <FilterMenu
      registry={leadFilterRegistry()}
      sources={{ stages: bootstrap.stages, members: bootstrap.members }}
      filter={filter}
      onChange={(next) => {
        onChange(next);
        setFilter(next);
      }}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

describe('FilterMenu', () => {
  test('F opens the property list, then values; Enter adds the condition', async () => {
    const onChange = mock<(filter: FilterGroup) => void>();
    renderWithClient(<Harness onChange={onChange} />);
    await userEvent.keyboard('f');
    await userEvent.type(await screen.findByPlaceholderText('Filter by'), 'stage');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(await screen.findByPlaceholderText('Stage'), 'ready');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'group',
      combinator: 'and',
      children: [
        { kind: 'condition', property: 'stage', operator: 'in', values: ['ready'], negate: false },
      ],
    });
  });

  test('a text property takes what you type', async () => {
    const onChange = mock<(filter: FilterGroup) => void>();
    renderWithClient(<Harness onChange={onChange} />);
    await userEvent.keyboard('f');
    await userEvent.type(await screen.findByPlaceholderText('Filter by'), 'company');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(await screen.findByPlaceholderText('Company contains'), 'acme{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'condition',
          property: 'company',
          operator: 'contains',
          value: 'acme',
          negate: false,
        },
      ],
    });
  });

  test('each step takes the keyboard focus as it opens', async () => {
    renderWithClient(<Harness onChange={mock()} />);
    await userEvent.keyboard('f');
    expect(await screen.findByPlaceholderText('Filter by')).toHaveFocus();
    await userEvent.keyboard('owner{Enter}');
    expect(await screen.findByPlaceholderText('Owner')).toHaveFocus();
  });

  test('Esc steps back to the property list, then closes the menu', async () => {
    renderWithClient(<Harness onChange={mock()} />);
    await userEvent.keyboard('f');
    await userEvent.type(await screen.findByPlaceholderText('Filter by'), 'stage');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByPlaceholderText('Stage')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByPlaceholderText('Filter by')).toHaveFocus();
    expect(screen.queryByPlaceholderText('Stage')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByPlaceholderText('Filter by')).not.toBeInTheDocument());
  });

  test('picking a second value keeps the menu open and widens the condition', async () => {
    const onChange = mock<(filter: FilterGroup) => void>();
    renderWithClient(<Harness onChange={onChange} />);
    await userEvent.keyboard('f');
    await userEvent.type(await screen.findByPlaceholderText('Filter by'), 'stage');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('option', { name: 'New' }));
    await userEvent.click(screen.getByRole('option', { name: 'Ready' }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'condition',
          property: 'stage',
          operator: 'in',
          values: ['new', 'ready'],
          negate: false,
        },
      ],
    });
    await userEvent.click(screen.getByRole('option', { name: 'New' }));
    await userEvent.click(screen.getByRole('option', { name: 'Ready' }));
    expect(onChange).toHaveBeenLastCalledWith(emptyFilterGroup());
  });
});
