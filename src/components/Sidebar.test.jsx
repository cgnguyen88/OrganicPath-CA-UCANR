// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageContext } from '../i18n/LanguageContext.jsx';
import Sidebar from './Sidebar.jsx';
import { DEFAULT_SAVED_VIEWS } from '../domain/records/savedViews.js';

const views = DEFAULT_SAVED_VIEWS.map((v, i) => ({ id: `view-${i}`, slug: v.slug, name: v.name.en, pinned: true, position: i + 1, filter: v.filter }));
const USER = { name: 'Cuong Nguyen', email: 'cuong@example.com' };
const FARM = { id: 'f1', name: 'Palo Verde', farm_code: 'F-ABC234' };

const setup = (props = {}, lang = 'en') => {
  const handlers = { onNavigate: vi.fn(), onLogout: vi.fn(), onSetStatus: vi.fn(), onChangeStatus: vi.fn(), toggleLang: vi.fn() };
  const user = userEvent.setup();
  render(
    <LanguageContext.Provider value={{ lang, toggleLang: handlers.toggleLang }}>
      <Sidebar activePage="dashboard" user={USER} farm={FARM} certificationStatus="pursuing" savedViews={views} onNavigate={handlers.onNavigate} onLogout={handlers.onLogout} onSetStatus={handlers.onSetStatus} onChangeStatus={handlers.onChangeStatus} {...props} />
    </LanguageContext.Provider>,
  );
  return { user, ...handlers };
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Sidebar: glass surface', () => {
  it('floats the menu as a glass panel over a decorative backdrop that assistive technology skips', () => {
    const { container } = (() => { setup(); return { container: document.body }; })();
    const backdrop = container.querySelector('.menu-backdrop');
    expect(backdrop).toBeTruthy();
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.querySelectorAll('.menu-orb').length).toBeGreaterThanOrEqual(2);
    const panel = container.querySelector('.menu-panel');
    expect(panel).toBeTruthy();
    expect(panel.contains(screen.getByRole('navigation', { name: /main/i }))).toBe(true);
    expect(panel.contains(screen.getByRole('button', { name: 'Log Out' }))).toBe(true);
    expect(backdrop.contains(screen.getByRole('navigation', { name: /main/i }))).toBe(false); // the backdrop holds no content
  });
});

describe('Sidebar: structure', () => {
  it('is a labelled navigation landmark with the app name', () => {
    setup();
    expect(screen.getByRole('navigation', { name: /main/i })).toBeTruthy();
    expect(screen.getByText('OrganicPath CA')).toBeTruthy();
  });

  it('lists the main pages, and Certification Maintenance only for certified operations', () => {
    setup();
    for (const name of ['Dashboard', 'OSP Generator', 'Compliance Tracker']) expect(screen.getByRole('button', { name }), name).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Certification Maintenance' })).toBeNull();
    cleanup();
    setup({ certificationStatus: 'certified' });
    expect(screen.getByRole('button', { name: 'Certification Maintenance' })).toBeTruthy();
  });

  it('lists every tool under a Compliance Tools heading', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Compliance Tools' })).toBeTruthy();
    for (const name of ['Eligibility Check', 'Draft Documents', 'Certifier Directory', 'Soil Lab Directory', 'OMRI Materials Guide', 'Food Safety Guide', 'Federal Organic Code', 'State Registration', 'OCCSP Reimbursement']) {
      expect(screen.getByRole('button', { name }), name).toBeTruthy();
    }
  });

  it('no longer has the Receipt Manager or Record Generators, whose work now lives in Purchases and Draft Documents', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Receipt Manager' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record Generators' })).toBeNull();
  });

  it('calls the documents page “Borradores de Documentos” in Spanish', () => {
    setup({}, 'es');
    expect(screen.getByRole('button', { name: 'Borradores de Documentos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gestor de Recibos' })).toBeNull();
  });

  it('shows the Farm Records section only for someone who has a farm', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Farm Records' })).toBeTruthy();
    cleanup();
    setup({ farm: null });
    expect(screen.queryByRole('button', { name: 'Farm Records' })).toBeNull();
  });

  it('carries the review count through to the Needs Review row', () => {
    setup({ needsReviewCount: 4 });
    expect(within(screen.getByRole('button', { name: /^Needs Review/ })).getByText('4')).toBeTruthy();
  });
});

describe('Sidebar: navigating', () => {
  it('goes to the page that was pressed and marks the current one', async () => {
    const { user, onNavigate } = setup({ activePage: 'osp' });
    expect(screen.getByRole('button', { name: 'OSP Generator' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Draft Documents' }));
    await user.click(screen.getByRole('button', { name: 'Compliance Tracker' }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['recordGenerators', 'tracker']);
  });

  it('collapses the tools, remembers it, and reopens them when you are on one of their pages', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Compliance Tools' }));
    expect(screen.queryByRole('button', { name: 'Draft Documents' })).toBeNull();
    cleanup();
    setup();
    expect(screen.queryByRole('button', { name: 'Draft Documents' })).toBeNull();
    cleanup();
    setup({ activePage: 'recordGenerators' });
    expect(screen.getByRole('button', { name: 'Draft Documents' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('Sidebar: certification path', () => {
  it('shows which path is current and switches it', async () => {
    const { user, onSetStatus } = setup();
    const group = screen.getByRole('group', { name: /certification path/i });
    expect(within(group).getByRole('button', { name: 'Pursuing' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Certified' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(within(group).getByRole('button', { name: 'Certified' }));
    expect(onSetStatus).toHaveBeenCalledWith('certified');
  });

  it('falls back to the older change handler when there is no setter', async () => {
    const { user, onChangeStatus } = setup({ onSetStatus: undefined });
    await user.click(within(screen.getByRole('group', { name: /certification path/i })).getByRole('button', { name: 'Certified' }));
    expect(onChangeStatus).toHaveBeenCalled();
  });

  it('is hidden until a path has been chosen', () => {
    setup({ certificationStatus: undefined });
    expect(screen.queryByRole('group', { name: /certification path/i })).toBeNull();
  });
});

describe('Sidebar: language and account', () => {
  it('shows the current language and switches when the other one is pressed', async () => {
    const { user, toggleLang } = setup();
    const group = screen.getByRole('group', { name: /language/i });
    expect(within(group).getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'ES' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(within(group).getByRole('button', { name: 'EN' }));
    expect(toggleLang).not.toHaveBeenCalled(); // already English
    await user.click(within(group).getByRole('button', { name: 'ES' }));
    expect(toggleLang).toHaveBeenCalledTimes(1);
  });

  it('shows who is signed in and which farm, and signs out', async () => {
    const { user, onLogout } = setup();
    expect(screen.getByText('Cuong Nguyen')).toBeTruthy();
    expect(screen.getByText('CN')).toBeTruthy();
    expect(screen.getByText('Palo Verde').getAttribute('title')).toMatch(/F-ABC234/);
    await user.click(screen.getByRole('button', { name: 'Log Out' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('falls back to the email when there is no farm, and shows no account row when signed out', () => {
    setup({ farm: null });
    expect(screen.getByText('cuong@example.com')).toBeTruthy();
    cleanup();
    setup({ user: null });
    expect(screen.queryByRole('button', { name: 'Log Out' })).toBeNull();
  });

  it('is available in Spanish', () => {
    setup({}, 'es');
    expect(screen.getByRole('button', { name: 'Panel Principal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Herramientas de Cumplimiento' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar Sesión' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: /idioma/i })).getByRole('button', { name: 'ES' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'En Proceso' })).toBeTruthy();
  });
});
