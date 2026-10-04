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

  test('offers the panel toggle and copy link only when the shell provides them', () => {
    const toggle = mock();
    const copy = mock();
    const bare = paletteCommands(mock()).map((command) => command.id);
    expect(bare).not.toContain('toggle-context-panel');
    expect(bare).not.toContain('copy-link');
    const commands = paletteCommands(mock(), { toggleContextPanel: toggle, copyLink: copy });
    const panel = commands.find((command) => command.id === 'toggle-context-panel');
    const link = commands.find((command) => command.id === 'copy-link');
    expect([panel?.shortcut, link?.shortcut]).toEqual([']', 'mod+shift+c']);
    panel?.run();
    link?.run();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  test('offers copy for agent with its shortcut only when the shell provides it', () => {
    const copy = mock();
    expect(paletteCommands(mock()).map((command) => command.id)).not.toContain('copy-for-agent');
    const command = paletteCommands(mock(), { copyForAgent: copy }).find(
      (entry) => entry.id === 'copy-for-agent',
    );
    expect(command?.label).toBe('Copy for agent');
    expect(command?.shortcut).toBe('mod+shift+a');
    command?.run();
    expect(copy).toHaveBeenCalledTimes(1);
  });

  test('offers the import page', () => {
    const navigate = mock();
    paletteCommands(navigate)
      .find((command) => command.id === 'import')
      ?.run();
    expect(navigate).toHaveBeenCalledWith('/import');
  });

  test('leaves the import page out for a role that cannot run imports', () => {
    const ids = paletteCommands(mock(), { canImport: false }).map((command) => command.id);
    expect(ids).not.toContain('import');
  });
});
