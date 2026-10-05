import {
  type AnchorHTMLAttributes,
  forwardRef,
  type MouseEvent,
  useMemo,
  useSyncExternalStore,
} from "react";

const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
window.addEventListener("popstate", emit);

export const navigations: string[] = [];

export function visit(href: string) {
  window.history.replaceState(null, "", href);
  emit();
}
function push(href: string) {
  navigations.push(href);
  window.history.pushState(null, "", href);
  emit();
}
function replace(href: string) {
  navigations.push(href);
  window.history.replaceState(null, "", href);
  emit();
}
const router = {
  push,
  replace,
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => {},
  prefetch: () => {},
};

export function useRouter() {
  return router;
}
export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}
export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}
export function redirect(href: string): never {
  throw new Error(`NEXT_REDIRECT ${href}`);
}
export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: boolean;
  scroll?: boolean;
  replace?: boolean;
};
const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    href,
    prefetch: _prefetch,
    scroll: _scroll,
    replace: swap,
    onClick,
    ...rest
  },
  ref,
) {
  return (
    <a
      ref={ref}
      href={href}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        if (swap) replace(href);
        else push(href);
      }}
    />
  );
});
export default Link;
