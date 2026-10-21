// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wrench } from 'lucide-react';
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

describe('NavGroup as a section card', () => {
  const card = (props = {}) => render(
    <NavGroup id="tools" label="Compliance Tools" icon={Wrench} accent="#5bbcf0" count={10} {...props}>
      <button type="button">Item one</button>
    </NavGroup>,
  );

  it('is its own labelled card, with the heading still a real expand/collapse button', () => {
    const { container } = card();
    expect(container.querySelector('.nav-section')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Compliance Tools/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a decorative icon in the section’s own accent colour', () => {
    const { container } = card();
    const chip = container.querySelector('.nav-section-icon');
    expect(chip.getAttribute('aria-hidden')).toBe('true');
    expect(chip.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('.nav-section').style.getPropertyValue('--section-accent')).toBe('#5bbcf0');
  });

  it('shows how many items are inside only while it is collapsed', async () => {
    const user = userEvent.setup();
    card();
    expect(screen.queryByText('10')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Compliance Tools/ }));
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('keeps the count out of the heading’s accessible name when open, and in it when closed', async () => {
    const user = userEvent.setup();
    card();
    expect(screen.getByRole('button', { name: 'Compliance Tools' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Compliance Tools' }));
    expect(screen.getByRole('button', { name: /Compliance Tools.*10/ })).toBeTruthy();
  });

  it('still opens by itself for the page you are on, and remembers the choice', async () => {
    const user = userEvent.setup();
    const first = card({ defaultOpen: false });
    expect(screen.queryByRole('button', { name: 'Item one' })).toBeNull();
    first.unmount();
    card({ defaultOpen: false, forceOpen: true });
    expect(screen.getByRole('button', { name: 'Item one' })).toBeTruthy();
    cleanup();
    card();
    await user.click(screen.getByRole('button', { name: /^Compliance Tools/ }));
    cleanup();
    card();
    expect(screen.getByRole('button', { name: /^Compliance Tools/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('is a plain heading when no icon or accent is given', () => {
    const { container } = render(<NavGroup id="plain" label="Plain"><button type="button">x</button></NavGroup>);
    expect(container.querySelector('.nav-section')).toBeNull();
  });
});

describe('NavGroup while the page you are on is inside it', () => {
  const VARIANTS = [
    ['a section card', { icon: Wrench, accent: '#5bbcf0' }, /^Compliance Tools/],
    ['a plain heading', {}, /^Compliance Tools/],
  ];
  const group = (props) => (
    <NavGroup id="tools" label="Compliance Tools" {...props}><button type="button">Item one</button></NavGroup>
  );
  const heading = (name) => screen.getByRole('button', { name });

  describe.each(VARIANTS)('as %s', (_name, look, name) => {
    it('can still be closed from its heading, and opened again', async () => {
      const user = userEvent.setup();
      render(group({ ...look, forceOpen: true }));
      expect(heading(name).getAttribute('aria-expanded')).toBe('true');
      await user.click(heading(name));
      expect(heading(name).getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('button', { name: 'Item one' })).toBeNull();
      await user.click(heading(name));
      expect(heading(name).getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('button', { name: 'Item one' })).toBeTruthy();
    });

    it('stays closed when the page changes to another one inside it', async () => {
      const user = userEvent.setup();
      const view = render(group({ ...look, forceOpen: true }));
      await user.click(heading(name));
      view.rerender(group({ ...look, forceOpen: true }));
      expect(heading(name).getAttribute('aria-expanded')).toBe('false');
    });

    it('opens when the page moves into it from outside, even after it was closed', async () => {
      const user = userEvent.setup();
      const view = render(group({ ...look, forceOpen: true }));
      await user.click(heading(name));
      view.rerender(group({ ...look, forceOpen: false }));
      expect(heading(name).getAttribute('aria-expanded')).toBe('false');
      view.rerender(group({ ...look, forceOpen: true }));
      expect(heading(name).getAttribute('aria-expanded')).toBe('true');
    });

    it('remembers that it was closed, for the next visit', async () => {
      const user = userEvent.setup();
      const first = render(group({ ...look, forceOpen: true }));
      await user.click(heading(name));
      first.unmount();
      render(group(look));
      expect(heading(name).getAttribute('aria-expanded')).toBe('false');
    });
  });
});
