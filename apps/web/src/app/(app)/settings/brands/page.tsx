import type { Metadata } from 'next';
import { BrandsPanel } from '@/features/settings/brands-panel.tsx';

export const metadata: Metadata = { title: 'Brands' };

export default function BrandsSettingsPage() {
  return <BrandsPanel />;
}
