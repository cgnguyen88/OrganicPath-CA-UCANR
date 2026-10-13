// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';
import RecordsNav from './RecordsNav.jsx';
import { DEFAULT_SAVED_VIEWS } from '../../domain/records/savedViews.js';

const views = DEFAULT_SAVED_VIEWS.map((v, i) => ({ id: `view-${i}`, slug: v.slug, name: v.name.en, pinned: true, position: i + 1, filter: v.filter }));

const setup = (props = {}, lang = 'en') => {
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<RecordsNav activePage="dashboard" onNavigate={onNavigate} needsReviewCount={0} savedViews={views} {...props} />, lang);
  return { user, onNavigate };
};
afterEach(cleanup);

describe('RecordsNav', () => {
  it('shows the section, the overview, the review queue and the change history', () => {
    setup();
    expect(screen.getByText('Farm Records')).toBeTruthy();
    for (const name of ['Records', 'Needs Review', 'Change History']) expect(screen.getByRole('button', { name: new RegExp(`^${name}`) }), name).toBeTruthy();
  });

  it('shows the number of records waiting for review, and nothing when there are none', () => {
    setup({ needsReviewCount: 3 });
    expect(within(screen.getByRole('button', { name: /^Needs Review/ })).getByText('3')).toBeTruthy();
    cleanup();
    setup({ needsReviewCount: 0 });
    expect(within(screen.getByRole('button', { name: /^Needs Review/ })).queryByText('0')).toBeNull();
  });

  it('caps a large review count so it never overflows', () => {
    setup({ needsReviewCount: 250 });
    expect(within(screen.getByRole('button', { name: /^Needs Review/ })).getByText('99+')).toBeTruthy();
  });

  it('lists the pinned saved views and hides unpinned ones', () => {
    setup({ savedViews: [...views.slice(0, 3), { ...views[3], pinned: false }] });
    expect(screen.getByRole('button', { name: 'Purchases without OMRI listing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'This season’s sprays' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'This season’s purchases' })).toBeNull();
  });

  it('keeps the log list collapsed until opened, then lists every kind of log', async () => {
    const { user } = setup();
    expect(screen.queryByRole('button', { name: 'Seed Log' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Logs/ }));
    for (const name of ['Activities', 'Purchases', 'Notes', 'Seed Log', 'Planting Log', 'Amendment Log', 'Harvest Log', 'Input List', 'Inventory']) {
      expect(screen.getByRole('button', { name }), name).toBeTruthy();
    }
  });

  it('opens the logs automatically when a log page is active', () => {
    setup({ activePage: 'log:harvest' });
    expect(screen.getByRole('button', { name: 'Harvest Log' }).getAttribute('aria-current')).toBe('page');
  });

  it('navigates with the right ids', async () => {
    const { user, onNavigate } = setup();
    await user.click(screen.getByRole('button', { name: /^Records/ }));
    await user.click(screen.getByRole('button', { name: /^Needs Review/ }));
    await user.click(screen.getByRole('button', { name: /^Change History/ }));
    await user.click(screen.getByRole('button', { name: 'This season’s harvests' }));
    await user.click(screen.getByRole('button', { name: /^Logs/ }));
    await user.click(screen.getByRole('button', { name: 'Purchases' }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['farmRecords', 'needsReview', 'changeHistory', 'view:view-2', 'log:purchase']);
  });

  it('marks the active page', () => {
    setup({ activePage: 'needsReview' });
    expect(screen.getByRole('button', { name: /^Needs Review/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /^Records/ }).getAttribute('aria-current')).toBeNull();
  });

  it('is available in Spanish, with default views translated by their slug', () => {
    setup({}, 'es');
    expect(screen.getByText('Registros de la Finca')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Por Revisar/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compras sin listado OMRI' })).toBeTruthy();
  });

  it('shows a custom view under its own name', () => {
    setup({ savedViews: [{ id: 'c1', slug: null, name: 'Kelp purchases', pinned: true, position: 9, filter: {} }] });
    expect(screen.getByRole('button', { name: 'Kelp purchases' })).toBeTruthy();
  });
});
