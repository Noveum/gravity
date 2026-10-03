import { describe, expect, mock, test } from 'bun:test';
import { paletteCommands } from '@/components/command-palette.tsx';

describe('paletteCommands', () => {
  test('offers one navigation command per section with its chord', () => {
    const navigate = mock();
    const commands = paletteCommands(navigate);
    const today = commands.find((command) => command.id === 'go-today');
    expect(today?.shortcut).toBe('g t');
    today?.run();
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  test('includes theme and shortcut help commands', () => {
    const ids = paletteCommands(mock()).map((command) => command.id);
    expect(ids).toContain('toggle-theme');
    expect(ids).toContain('show-shortcuts');
  });
});
