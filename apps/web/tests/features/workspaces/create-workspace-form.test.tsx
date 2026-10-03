import { describe, expect, mock, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateWorkspaceForm } from '@/features/workspaces/create-workspace-form.tsx';

describe('CreateWorkspaceForm', () => {
  test('derives the slug from the name and submits both', async () => {
    const submit = mock(() => Promise.resolve({ organization: { id: 'o1' } }));
    const onCreated = mock();
    render(<CreateWorkspaceForm submit={submit} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Studio');
    expect(screen.getByLabelText('URL')).toHaveValue('acme-studio');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(submit).toHaveBeenCalledWith({ name: 'Acme Studio', slug: 'acme-studio' });
    expect(onCreated).toHaveBeenCalledWith('o1');
  });
});
