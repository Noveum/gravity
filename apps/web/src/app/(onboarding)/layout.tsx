import type { ReactNode } from 'react';
import { GravityMark } from '@/components/brand/gravity-mark.tsx';
import { requireSession } from '@/lib/auth/session.ts';

export default async function OnboardingLayout({ children }: { readonly children: ReactNode }) {
  await requireSession();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-5 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <GravityMark size={28} />
        {children}
      </div>
    </main>
  );
}
