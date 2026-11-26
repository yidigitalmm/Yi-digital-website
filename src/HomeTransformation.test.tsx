import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HomeTransformation } from './HomeTransformation';

describe('Homepage comparison', () => {
  it('lets visitors compare both states without navigation or scroll control', async () => {
    render(<HomeTransformation locale="en" />);
    const before = screen.getByRole('button', { name: /^before$/i });
    const after = screen.getByRole('button', { name: /^after$/i });
    expect(before).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(after);
    expect(after).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Ready to be chosen.' })).toBeInTheDocument();
    await userEvent.click(before);
    expect(before).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Hard to find.' })).toBeInTheDocument();
  });
});
