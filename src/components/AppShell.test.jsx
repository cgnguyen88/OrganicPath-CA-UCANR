// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';
import AppShell from './AppShell.jsx';

const USER = { name: 'Ana Reyes', email: 'ana@example.org' };
const SIDEBAR = { user: USER, farm: null, certificationStatus: 'pursuing', onLogout: () => {}, onSetStatus: () => {} };

function screenIsPhone(isPhone) {
  vi.stubGlobal('matchMedia', (query) => ({ media: query, matches: isPhone, addEventListener: () => {}, removeEventListener: () => {} }));
}

function renderShell({ activePage = 'dashboard', onNavigate = vi.fn(), lang = 'en' } = {}) {
  const view = renderWithLang(
    <AppShell activePage={activePage} onNavigate={onNavigate} sidebar={SIDEBAR}>
      <p>Page content</p>
    </AppShell>,
    lang,
  );
  return { ...view, onNavigate };
}

const mainMenu = () => screen.queryByRole('navigation', { name: 'Main' });

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppShell on a computer', () => {
  it('shows the side menu beside the page and no menu button', () => {
    screenIsPhone(false);
    renderShell();
    expect(mainMenu()).toBeTruthy();
    expect(screen.getByText('Page content')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
  });
});

describe('AppShell on a phone', () => {
  beforeEach(() => screenIsPhone(true));

  it('shows a top bar with a menu button and the name of the page, and keeps the menu closed', () => {
    renderShell({ activePage: 'osp' });
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('banner').textContent).toContain('OSP Generator');
    expect(mainMenu()).toBeNull();
    expect(document.getElementById('app-menu').hasAttribute('inert')).toBe(true);
  });

  it('opens the menu as a drawer over the page, with a way to close it', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(mainMenu()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('app-menu').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }));
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(mainMenu()).toBeNull();
  });

  it('goes to the page chosen in the menu and closes the menu', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('button', { name: 'Compliance Tracker' }));
    expect(onNavigate).toHaveBeenCalledWith('tracker');
    expect(mainMenu()).toBeNull();
  });

  it('closes the menu with Escape and puts the focus back on the menu button', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.keyboard('{Escape}');
    expect(mainMenu()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }));
  });

  it('closes the menu when the dimmed page behind it is tapped', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(document.querySelector('.menu-scrim'));
    expect(mainMenu()).toBeNull();
  });

  it('speaks Spanish in a Spanish app', () => {
    renderShell({ lang: 'es' });
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toBeTruthy();
    expect(screen.getByRole('banner').textContent).toContain('Panel Principal');
  });

  it('names the app in the top bar on a page that has no name of its own', () => {
    renderShell({ activePage: 'log:spray' });
    expect(screen.getByRole('banner').textContent).toContain('OrganicPath CA');
  });
});

describe('AppShell: moving between pages', () => {
  it('starts each new page at the top', () => {
    screenIsPhone(false);
    const { rerender } = renderShell({ activePage: 'dashboard' });
    const main = screen.getByRole('main');
    main.scrollTop = 500;
    rerender(<AppShell activePage="osp" onNavigate={() => {}} sidebar={SIDEBAR}><p>Page content</p></AppShell>);
    expect(main.scrollTop).toBe(0);
  });
});
