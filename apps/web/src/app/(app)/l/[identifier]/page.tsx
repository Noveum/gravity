import { getLeadByKey } from '@gravity/core';
import { isDomainError } from '@gravity/shared/errors';
import { notFound, redirect } from 'next/navigation';
import { personHref } from '@/features/leads/lead-groups.ts';
import { pageContext } from '@/lib/api/handler.ts';

function decodedIdentifier(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    notFound();
  }
}

export default async function LeadKeyPage({
  params,
}: {
  readonly params: Promise<{ identifier: string }>;
}) {
  const { principal } = await pageContext();
  const identifier = decodedIdentifier((await params).identifier);
  let target: string;
  try {
    target = personHref(await getLeadByKey(principal, identifier));
  } catch (error: unknown) {
    if (isDomainError(error) && error.code === 'not_found') notFound();
    throw error;
  }
  redirect(target);
}
