import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button.tsx';

describe('Button', () => {
  test('renders its label and responds to a click', async () => {
    let clicked = 0;
    render(<Button onClick={() => (clicked += 1)}>Approve</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(clicked).toBe(1);
  });
});
