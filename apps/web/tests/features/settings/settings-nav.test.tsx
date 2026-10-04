import { describe, expect, test } from 'bun:test';
import { screen, within } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/settings/members');
const { SettingsNav } = await import('@/features/settings/settings-nav.tsx');
const { SettingsContent } = await import('@/features/settings/settings-content.tsx');

describe('SettingsNav', () => {
  test('lists the settings pages and marks the open one', () => {
    navigation.pathname = '/settings/brands';
    renderWithClient(<SettingsNav />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/settings/members',
    );
    expect(within(nav).getByRole('link', { name: 'Brands' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Custom fields' })).toHaveAttribute(
      'href',
      '/settings/fields',
    );
    expect(within(nav).getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current');
  });

  test('lists each pipeline under Brands with its brand', () => {
    navigation.pathname = '/settings/pipelines/p1';
    renderWithClient(<SettingsNav />);
    const link = screen.getByRole('link', { name: 'Yodu · Prospecting' });
    expect(link).toHaveAttribute('href', '/settings/pipelines/p1');
    expect(link).toHaveAttribute('aria-current', 'page');
  });
});

describe('SettingsContent', () => {
  test('members stay open at every width', () => {
    navigation.pathname = '/settings/members';
    renderWithClient(<SettingsContent>members here</SettingsContent>);
    expect(screen.getByText('members here')).toBeInTheDocument();
    expect(screen.queryByText(/900 pixels/)).not.toBeInTheDocument();
    expect(screen.getByText('members here')).not.toHaveClass('hidden');
  });

  test('brands, pipelines and fields give way to a notice under 900px', () => {
    for (const path of ['/settings/brands', '/settings/pipelines/p1', '/settings/fields']) {
      navigation.pathname = path;
      const view = renderWithClient(<SettingsContent>panel here</SettingsContent>);
      expect(screen.getByText(/900 pixels wide and larger/)).toHaveClass('min-[900px]:hidden');
      expect(screen.getByText('panel here')).toHaveClass('hidden', 'min-[900px]:block');
      view.unmount();
    }
  });
});
