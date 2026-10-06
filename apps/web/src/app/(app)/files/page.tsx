import { FilesView } from '@/features/files/files-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function FilesPage() {
  await pageContext();
  return <FilesView />;
}
