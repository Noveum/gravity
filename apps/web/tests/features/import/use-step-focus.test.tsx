import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { useStepFocus } from '@/features/import/use-step-focus.ts';

function Heading({ signal }: { readonly signal: object }) {
  const target = useStepFocus(signal);
  return (
    <h2 ref={target} tabIndex={-1}>
      Step
    </h2>
  );
}

describe('useStepFocus', () => {
  test('leaves focus alone on the first render, even when strict mode runs effects twice', () => {
    const signal = {};
    render(
      <StrictMode>
        <Heading signal={signal} />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(document.body);
  });

  test('moves focus to the heading when the step changes', () => {
    const view = render(
      <StrictMode>
        <Heading signal={{}} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Heading signal={{}} />
      </StrictMode>,
    );
    expect(document.activeElement?.textContent).toBe('Step');
  });
});
