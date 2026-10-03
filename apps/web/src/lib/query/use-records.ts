'use client';

import type { ActivityEntityType, TimelineFilter } from '@gravity/shared/constants';
import { encodeListQuery, type ListQuery } from '@gravity/shared/filters';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from './fetcher.ts';
import { COMPANIES_ROOT, PEOPLE_ROOT, queryKeys, TIMELINE_ROOT } from './keys.ts';
import { keepPreviousWithin } from './pages.ts';
import {
  companyPageSchema,
  companyRecordSchema,
  personPageSchema,
  personRecordSchema,
  timelinePageSchema,
} from './schemas.ts';
import { useAllPages } from './use-all-pages.ts';

function withCursor(base: string, search: string, cursor: string | null): string {
  const params = new URLSearchParams(search);
  if (cursor !== null) params.set('cursor', cursor);
  const query = params.toString();
  return query.length === 0 ? base : `${base}?${query}`;
}

export function usePeopleList(query: ListQuery) {
  const search = encodeListQuery(query);
  const result = useInfiniteQuery({
    queryKey: queryKeys.people(search),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(withCursor('/api/people', search, pageParam), personPageSchema, { signal }),
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousWithin([PEOPLE_ROOT]),
  });
  useAllPages(result);
  const people = useMemo(
    () => (result.data?.pages ?? []).flatMap((page) => page.people),
    [result.data],
  );
  return { ...result, people, search };
}

export function useCompanyList(query: ListQuery) {
  const search = encodeListQuery(query);
  const result = useInfiniteQuery({
    queryKey: queryKeys.companies(search),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(withCursor('/api/companies', search, pageParam), companyPageSchema, { signal }),
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousWithin([COMPANIES_ROOT]),
  });
  useAllPages(result);
  const companies = useMemo(
    () => (result.data?.pages ?? []).flatMap((page) => page.companies),
    [result.data],
  );
  return { ...result, companies, search };
}

export function usePersonRecord(id: string) {
  return useQuery({
    queryKey: queryKeys.person(id),
    queryFn: ({ signal }) =>
      apiFetch(`/api/people/${encodeURIComponent(id)}`, personRecordSchema, { signal }),
  });
}

export function useCompanyRecord(id: string) {
  return useQuery({
    queryKey: queryKeys.company(id),
    queryFn: ({ signal }) =>
      apiFetch(`/api/companies/${encodeURIComponent(id)}`, companyRecordSchema, { signal }),
  });
}

export function useTimeline(
  subjectType: ActivityEntityType,
  subjectId: string,
  filter: TimelineFilter,
) {
  const search = new URLSearchParams({ subjectType, subjectId, filter }).toString();
  const result = useInfiniteQuery({
    queryKey: queryKeys.timeline(subjectType, subjectId, filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(withCursor('/api/timeline', search, pageParam), timelinePageSchema, { signal }),
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousWithin([TIMELINE_ROOT, subjectType, subjectId]),
  });
  const activities = useMemo(
    () => (result.data?.pages ?? []).flatMap((page) => page.activities),
    [result.data],
  );
  return { ...result, activities };
}
