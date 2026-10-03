import { afterAll, mock } from 'bun:test';

export interface NavigationControls {
  pathname: string;
  search: string;
  readonly push: ReturnType<typeof mock<(href: string) => void>>;
  readonly replace: ReturnType<typeof mock<(href: string) => void>>;
}

export function mockNavigation(pathname = '/', search = ''): NavigationControls {
  const controls: NavigationControls = {
    pathname,
    search,
    push: mock<(href: string) => void>(),
    replace: mock<(href: string) => void>(),
  };
  mock.module('next/navigation', () => ({
    usePathname: () => controls.pathname,
    useSearchParams: () => new URLSearchParams(controls.search),
    useRouter: () => ({
      push: controls.push,
      replace: (href: string) => {
        controls.replace(href);
        controls.search = href.split('?')[1] ?? '';
      },
      refresh: mock(),
      prefetch: mock(),
      back: mock(),
    }),
    redirect: mock(),
    notFound: mock(),
  }));
  return controls;
}

export function watchHistoryReplace(
  controls: NavigationControls,
): ReturnType<typeof mock<(href: string) => void>> {
  const replaced = mock<(href: string) => void>();
  const original = window.history.replaceState;
  window.history.replaceState = (_data: unknown, _unused: string, url?: string | URL | null) => {
    const href = url === undefined || url === null ? '' : String(url);
    replaced(href);
    controls.search = href.split('?')[1] ?? '';
  };
  afterAll(() => {
    window.history.replaceState = original;
  });
  return replaced;
}
