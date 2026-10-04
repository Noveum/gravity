import { describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClientLogo } from '@/components/client-logo.tsx';

describe('ClientLogo', () => {
  test('shows an https logo without a referrer and falls back to the initial when it fails', () => {
    render(<ClientLogo name="Desk agent" src="https://agent.example.com/logo.png" />);
    const logo = screen.getByTestId('client-logo');
    expect(logo).toHaveAttribute('src', 'https://agent.example.com/logo.png');
    expect(logo).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.error(logo);
    expect(screen.queryByTestId('client-logo')).toBeNull();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  test('never loads an address that is not https, whatever the caller passed', () => {
    for (const src of [
      'http://agent.example.com/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'https://agent.example.com/a.png,https://tracker.example.com/b.png',
    ]) {
      const view = render(<ClientLogo name="Desk agent" src={src} />);
      expect(screen.queryByTestId('client-logo')).toBeNull();
      view.unmount();
    }
  });

  test('uses the initial of a name that starts with an emoji or is blank', () => {
    const view = render(<ClientLogo name="  🚀 Rocket" src={null} />);
    expect(screen.getByText('🚀')).toBeInTheDocument();
    view.unmount();
    render(<ClientLogo name="   " src={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  test('has a small size for dense rows', () => {
    render(<ClientLogo name="Desk agent" src="https://agent.example.com/logo.png" size="sm" />);
    expect(screen.getByTestId('client-logo')).toHaveAttribute('width', '20');
  });
});
