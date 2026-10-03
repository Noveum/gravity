let windowBlurred = false;
let watching = false;

function forgetBlur(): void {
  windowBlurred = false;
}

export function watchWindowRefocus(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('blur', () => {
    windowBlurred = true;
  });
  window.addEventListener('pointerdown', forgetBlur, true);
  window.addEventListener('keydown', forgetBlur, true);
}

export function isWindowRefocus(event: { readonly relatedTarget: EventTarget | null }): boolean {
  const refocus = windowBlurred && event.relatedTarget === null;
  windowBlurred = false;
  return refocus;
}
