import { describe, expect, test } from 'bun:test';
import {
  breadcrumbsFor,
  isNavItemActive,
  isRecordPath,
  leadsHref,
  NAV_ITEMS,
  navItemFor,
  pipelineKeyOf,
} from '@/lib/navigation.ts';

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
    expect(breadcrumbsFor('/import')).toEqual([{ label: 'Import' }]);
    expect(breadcrumbsFor('/settings/members')).toEqual([
      { label: 'Settings', href: '/settings/members' },
      { label: 'Members' },
    ]);
    expect(breadcrumbsFor('/settings/mcp')).toEqual([
      { label: 'Settings', href: '/settings/members' },
      { label: 'MCP clients' },
    ]);
    expect(breadcrumbsFor('/onboarding')).toEqual([]);
  });

  test('a record page links back to its list and never shows the raw id', () => {
    expect(breadcrumbsFor('/people/019a2b3c')).toEqual([{ label: 'People', href: '/people' }]);
    expect(breadcrumbsFor('/companies/c1')).toEqual([{ label: 'Companies', href: '/companies' }]);
  });
});

describe('breadcrumbsFor with a pipeline lookup', () => {
  test('names the brand and pipeline of a lead list', () => {
    const lookup = {
      pipeline: (key: string) =>
        key === 'YOD' ? { brandName: 'Yodu', pipelineName: 'Prospecting' } : undefined,
    };
    expect(breadcrumbsFor('/leads/YOD', lookup)).toEqual([
      { label: 'Leads', href: '/leads' },
      { label: 'Yodu' },
      { label: 'Prospecting' },
    ]);
    expect(breadcrumbsFor('/leads/YOD', { ...lookup, viewName: 'Hot leads' })).toEqual([
      { label: 'Leads', href: '/leads' },
      { label: 'Yodu' },
      { label: 'Prospecting', href: '/leads/YOD' },
      { label: 'Hot leads' },
    ]);
    expect(breadcrumbsFor('/leads/NOPE', lookup)).toEqual([
      { label: 'Leads', href: '/leads' },
      { label: 'NOPE' },
    ]);
  });

  test('reads a lowercase key in the address as the pipeline key', () => {
    const lookup = {
      pipeline: (key: string) =>
        key === 'YOD' ? { brandName: 'Yodu', pipelineName: 'Prospecting' } : undefined,
    };
    expect(breadcrumbsFor('/leads/yod', lookup).map((crumb) => crumb.label)).toEqual([
      'Leads',
      'Yodu',
      'Prospecting',
    ]);
    expect(breadcrumbsFor('/leads/nope').at(-1)).toEqual({ label: 'NOPE' });
  });
});

describe('lead routes', () => {
  test('a pipeline list lives under its key, read back in upper case', () => {
    expect(leadsHref('YOD')).toBe('/leads/YOD');
    expect(pipelineKeyOf('/leads/yod')).toBe('YOD');
    expect(pipelineKeyOf('/leads')).toBeNull();
    expect(pipelineKeyOf('/people/yod')).toBeNull();
  });

  test('only a person or company page is a record page', () => {
    expect(isRecordPath('/people/per1')).toBe(true);
    expect(isRecordPath('/companies/co1')).toBe(true);
    expect(isRecordPath('/people')).toBe(false);
    expect(isRecordPath('/companies/')).toBe(false);
    expect(isRecordPath('/leads/YOD')).toBe(false);
    expect(isRecordPath('/peoplex/per1')).toBe(false);
  });
});
