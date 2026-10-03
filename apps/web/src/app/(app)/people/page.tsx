import { PeopleView } from '@/features/people/people-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function PeoplePage() {
  await pageContext();
  return <PeopleView />;
}
