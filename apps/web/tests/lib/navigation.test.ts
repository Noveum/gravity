import { describe, expect, test } from 'bun:test';
import { breadcrumbsFor, isNavItemActive, NAV_ITEMS, navItemFor } from '@/lib/navigation.ts';

describe('navigation', () => {
  test('lists work, records and settings in that order', () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      'today',
      'inbox',
      'meetings',
      'leads',
      'people',
      'companies',
      'deals',
      'sequences',
      'settings',
    ]);
  });

  test('every item has a unique g-chord', () => {
    const chords = NAV_ITEMS.map((item) => item.chord);
    expect(new Set(chords).size).toBe(chords.length);
    expect(navItemFor('today')?.chord).toBe('g t');
  });

  test('unknown sections are not navigable', () => {
    expect(navItemFor('issues')).toBeUndefined();
  });

  test('an item is active on its own path and below it, never on a sibling that shares a prefix', () => {
    const people = navItemFor('people');
    const settings = navItemFor('settings');
    if (people === undefined || settings === undefined) throw new Error('missing nav item');
    expect(isNavItemActive(people, '/people')).toBe(true);
    expect(isNavItemActive(people, '/people/abc')).toBe(true);
    expect(isNavItemActive(people, '/peoplex')).toBe(false);
    expect(isNavItemActive(settings, '/settings/members')).toBe(true);
  });

  test('breadcrumbs name the section and its page', () => {
    expect(breadcrumbsFor('/today')).toEqual([{ label: 'Today' }]);
    expect(breadcrumbsFor('/settings/members')).toEqual([
      { label: 'Settings', href: '/settings/members' },
      { label: 'Members' },
    ]);
    expect(breadcrumbsFor('/onboarding')).toEqual([]);
  });
});
