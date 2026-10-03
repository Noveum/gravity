import { beforeEach, describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');
beforeEach(() => {
  navigation.pathname = '/leads/YOD';
});

const { SidebarBrands } = await import('@/components/layout/sidebar-brands.tsx');

describe('SidebarBrands', () => {
  test('lists each brand with its pipelines as links', () => {
    renderWithClient(<SidebarBrands collapsed={false} touch={false} onNavigate={null} />);
    expect(screen.getByText('Yodu')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Prospecting/ });
    expect(link).toHaveAttribute('href', '/leads/YOD');
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  test('marks the pipeline current when the address spells its key in lower case', () => {
    navigation.pathname = '/leads/yod';
    renderWithClient(<SidebarBrands collapsed={false} touch={false} onNavigate={null} />);
    expect(screen.getByRole('link', { name: /Prospecting/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('the collapsed dot is current while one of its pipelines is open', () => {
    renderWithClient(<SidebarBrands collapsed touch={false} onNavigate={null} />);
    expect(screen.getByRole('link', { name: 'Yodu' })).toHaveAttribute('aria-current', 'page');
  });

  test('collapses to one dot per brand and renders nothing without brands', () => {
    const { unmount } = renderWithClient(
      <SidebarBrands collapsed touch={false} onNavigate={null} />,
    );
    expect(screen.getByRole('link', { name: 'Yodu' })).toHaveAttribute('href', '/leads/YOD');
    unmount();
    const { container } = renderWithClient(
      <SidebarBrands collapsed={false} touch={false} onNavigate={null} />,
      {
        bootstrap: bootstrapFixture({ brands: [], pipelines: [] }),
      },
    );
    expect(container.textContent).toBe('');
  });
});
