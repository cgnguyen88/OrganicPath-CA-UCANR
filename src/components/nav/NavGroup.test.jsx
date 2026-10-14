// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NavGroup from './NavGroup.jsx';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const setup = (props = {}) => {
  const user = userEvent.setup();
  const view = render(<NavGroup id="tools" label="Tools" {...props}><button type="button">Item one</button></NavGroup>);
  return { user, ...view };
};

describe('NavGroup', () => {
  it('is open by default and shows its items under a labelled, expandable heading', () => {
    setup();
    const header = screen.getByRole('button', { name: 'Tools' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Item one' })).toBeTruthy();
  });

  it('can start closed', () => {
    setup({ defaultOpen: false });
    expect(screen.getByRole('button', { name: 'Tools' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Item one' })).toBeNull();
  });

  it('opens and closes when the heading is pressed', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Tools' }));
    expect(screen.queryByRole('button', { name: 'Item one' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tools' }));
    expect(screen.getByRole('button', { name: 'Item one' })).toBeTruthy();
  });

  it('remembers the choice across visits', async () => {
    const first = setup();
    await first.user.click(screen.getByRole('button', { name: 'Tools' }));
    first.unmount();
    setup();
    expect(screen.getByRole('button', { name: 'Tools' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps each group’s choice separate', async () => {
    const first = setup({ id: 'a' });
    await first.user.click(screen.getByRole('button', { name: 'Tools' }));
    first.unmount();
    setup({ id: 'b' });
    expect(screen.getByRole('button', { name: 'Tools' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('stays open while the page you are on is inside it, without forgetting the saved choice', async () => {
    const closed = setup({ defaultOpen: false });
    closed.unmount();
    const forced = setup({ defaultOpen: false, forceOpen: true });
    expect(screen.getByRole('button', { name: 'Item one' })).toBeTruthy();
    forced.unmount();
    setup({ defaultOpen: false });
    expect(screen.queryByRole('button', { name: 'Item one' })).toBeNull();
  });

  it('still works when the browser will not let it save anything', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
    try {
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Tools' }));
      expect(screen.queryByRole('button', { name: 'Item one' })).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('ignores a stored value that is not a yes/no', () => {
    localStorage.setItem('orgpath_nav_group_tools', JSON.stringify({ evil: true }));
    setup();
    expect(screen.getByRole('button', { name: 'Tools' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('can be a plain, always-visible list with no heading', () => {
    render(<NavGroup id="core"><button type="button">Dashboard</button></NavGroup>);
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /core/i })).toBeNull();
  });
});
