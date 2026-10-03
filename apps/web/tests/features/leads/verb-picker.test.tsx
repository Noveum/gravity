import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { HoldPicker, NextActionPicker } from '@/features/leads/text-pickers.tsx';
import { VerbPicker } from '@/features/leads/verb-picker.tsx';

const getElementById = spyOn(document, 'getElementById');

afterEach(() => {
  getElementById.mockClear();
});

const noop = () => undefined;

describe('anchored pickers', () => {
  test('render on the server without reading the document', () => {
    const html = renderToString(
      <>
        <VerbPicker
          open
          anchorId="lead-l1"
          title="Move to stage"
          options={[{ id: 'ready', label: 'Ready' }]}
          onPick={noop}
          onClose={noop}
        />
        <NextActionPicker open anchorId="lead-l1" initial="" onSubmit={noop} onClose={noop} />
        <HoldPicker open anchorId="lead-l1" onSubmit={noop} onClose={noop} />
      </>,
    );
    expect(typeof html).toBe('string');
    expect(getElementById).not.toHaveBeenCalled();
  });
});
