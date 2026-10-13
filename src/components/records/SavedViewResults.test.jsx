// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/records.js', () => ({
  listSavedViewRecords: vi.fn(), setRecordStatus: vi.fn(), listRevisions: vi.fn(), updateRecord: vi.fn(), createRecord: vi.fn(),
}));
const records = await import('../../lib/records.js');
const { default: SavedViewResults } = await import('./SavedViewResults.jsx');

const farm = { id: 'farm-1', season_start_month: 4, season_start_day: 1 };
const view = { id: 'v1', slug: null, name: 'Mine', filter: { kinds: ['purchase'], status: ['approved'], season: 'all', where: [] } };
const rec = { id: 'p1', kind: 'purchase', status: 'approved', record_date: '2026-10-01', source: 'manual', payload: { product: 'Compost', supplier: 'Acme' }, created_by: 'u1', missing_fields: [] };

beforeEach(() => {
  Object.values(records).forEach((fn) => fn.mockReset());
  records.listSavedViewRecords.mockResolvedValue({ data: [rec], error: null });
  records.listRevisions.mockResolvedValue({ data: [], error: null });
});
afterEach(cleanup);

describe('SavedViewResults', () => {
  it('does not refetch when the parent re-renders with equal-but-new objects (e.g. after a token refresh)', async () => {
    const { rerender } = renderWithLang(<SavedViewResults view={view} farm={farm} role="owner" userId="u1" />);
    await screen.findByText('Compost · Acme');
    rerender(<SavedViewResults view={{ ...view, filter: { ...view.filter } }} farm={{ ...farm }} role="owner" userId="u1" />);
    rerender(<SavedViewResults view={{ ...view }} farm={{ ...farm }} role="owner" userId="u1" />);
    expect(records.listSavedViewRecords).toHaveBeenCalledTimes(1);
  });

  it('refetches when the view’s filter really changes', async () => {
    const { rerender } = renderWithLang(<SavedViewResults view={view} farm={farm} role="owner" userId="u1" />);
    await screen.findByText('Compost · Acme');
    rerender(<SavedViewResults view={{ ...view, filter: { ...view.filter, season: 'current' } }} farm={farm} role="owner" userId="u1" />);
    await waitFor(() => expect(records.listSavedViewRecords).toHaveBeenCalledTimes(2));
  });

  it('passes the farm’s season settings to the view', async () => {
    renderWithLang(<SavedViewResults view={view} farm={farm} role="owner" userId="u1" />);
    await screen.findByText('Compost · Acme');
    expect(records.listSavedViewRecords.mock.calls[0][1].farm).toMatchObject({ id: 'farm-1', season_start_month: 4, season_start_day: 1 });
  });

  it('removes a record from the view once it is voided', async () => {
    records.setRecordStatus.mockResolvedValue({ data: { ...rec, status: 'voided' }, error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithLang(<SavedViewResults view={view} farm={farm} role="owner" userId="u1" />);
    await user.click(await screen.findByText('Compost · Acme'));
    await user.click(await screen.findByRole('button', { name: 'Void' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Compost · Acme')).toBeNull());
  });
});
