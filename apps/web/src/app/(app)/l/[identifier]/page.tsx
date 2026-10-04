import { getLeadByKey } from '@gravity/core';
import { isDomainError } from '@gravity/shared/errors';
import { notFound, redirect } from 'next/navigation';
import { personHref } from '@/features/leads/lead-groups.ts';
import { linkedPageContext, type PageSearchParams } from '@/lib/api/workspace-link.ts';

function decodedIdentifier(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    notFound();
  }
}

export default async function LeadKeyPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ identifier: string }>;
  readonly searchParams: Promise<PageSearchParams>;
}) {
  const raw = (await params).identifier;
  const { principal } = await linkedPageContext(`/l/${raw}`, await searchParams);
  const identifier = decodedIdentifier(raw);
  let target: string;
  try {
    target = personHref(await getLeadByKey(principal, identifier));
  } catch (error: unknown) {
    if (isDomainError(error) && error.code === 'not_found') notFound();
    throw error;
  }
  redirect(target);
}
