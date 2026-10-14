// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/records.js', () => ({
  listSavedViewRecords: vi.fn(), setRecordStatus: vi.fn(), listRevisions: vi.fn(), updateRecord: vi.fn(), createRecord: vi.fn(),
}));
vi.mock('../../lib/reportData.js', () => ({ listSavedViewRecordsForReport: vi.fn() }));
vi.mock('../../lib/reportCsv.js', () => ({ downloadCsv: vi.fn() }));
vi.mock('../../lib/reportDocx.js', () => ({ downloadReportDocx: vi.fn() }));
const records = await import('../../lib/records.js');
const reportData = await import('../../lib/reportData.js');
const { default: SavedViewResults } = await import('./SavedViewResults.jsx');

const farm = { id: 'farm-1', season_start_month: 4, season_start_day: 1 };
const view = { id: 'v1', slug: null, name: 'Mine', filter: { kinds: ['purchase'], status: ['approved'], season: 'all', where: [] } };
const rec = { id: 'p1', kind: 'purchase', status: 'approved', record_date: '2026-10-01', source: 'manual', payload: { product: 'Compost', supplier: 'Acme' }, created_by: 'u1', missing_fields: [] };

beforeEach(() => {
  Object.values(records).forEach((fn) => fn.mockReset());
  reportData.listSavedViewRecordsForReport.mockReset();
  reportData.listSavedViewRecordsForReport.mockResolvedValue({ data: { records: [rec, { ...rec, id: 'p2', record_date: '2026-10-02' }], truncated: false }, error: null });
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

  describe('downloading the view', () => {
    const operation = { operationName: 'Palo Verde Organics' };

    it('offers a Download button that gathers the whole view, titled with the view’s name', async () => {
      const user = userEvent.setup();
      renderWithLang(<SavedViewResults view={view} farm={farm} operation={operation} role="owner" userId="u1" />);
      await screen.findByText('Compost · Acme');
      expect(reportData.listSavedViewRecordsForReport).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Download' }));
      expect(await screen.findByRole('dialog', { name: 'Download: Mine' })).toBeTruthy();
      expect(await screen.findByText('2 records in this report')).toBeTruthy();
      const [sentView, ctx] = reportData.listSavedViewRecordsForReport.mock.calls[0];
      expect(sentView.filter).toEqual(view.filter);
      expect(ctx.farm).toMatchObject({ id: 'farm-1', season_start_month: 4, season_start_day: 1 });
      expect(ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('does not let the person widen the view to records that are not approved', async () => {
      const user = userEvent.setup();
      renderWithLang(<SavedViewResults view={view} farm={farm} operation={operation} role="owner" userId="u1" />);
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      await screen.findByText('2 records in this report');
      expect(screen.queryByLabelText(/Also include records not yet approved/)).toBeNull();
      expect(document.querySelector('.report-doc').textContent).toContain('Approved records only');
    });

    it('puts the dates of the view’s season on the report', async () => {
      const seasonView = { ...view, filter: { ...view.filter, season: 'current' } };
      const user = userEvent.setup();
      renderWithLang(<SavedViewResults view={seasonView} farm={farm} operation={operation} role="owner" userId="u1" />);
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      await screen.findByText('2 records in this report');
      expect(document.querySelector('.report-doc').textContent).toMatch(/\d{4}-04-01 to \d{4}-03-31/);
    });

    it('says all dates for a view that is not limited to a season', async () => {
      const user = userEvent.setup();
      renderWithLang(<SavedViewResults view={view} farm={farm} operation={operation} role="owner" userId="u1" />);
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      await screen.findByText('2 records in this report');
      expect(document.querySelector('.report-doc').textContent).toContain('All dates');
    });

    it('says so on the report when the view itself includes records that are not approved', async () => {
      const draftRec = { ...rec, id: 'd1', status: 'draft' };
      reportData.listSavedViewRecordsForReport.mockResolvedValue({ data: { records: [rec, draftRec], truncated: false }, error: null });
      const wide = { ...view, filter: { ...view.filter, status: ['approved', 'draft'] } };
      const user = userEvent.setup();
      renderWithLang(<SavedViewResults view={wide} farm={farm} operation={operation} role="owner" userId="u1" />);
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      await screen.findByText('2 records in this report');
      expect(document.querySelector('.report-doc').textContent).toContain('Includes records not yet approved');
    });

    it('does not break the page for a view whose stored filter is malformed, and offers no download for it', async () => {
      const broken = { ...view, filter: { kinds: ['purchase'], status: 'approved', season: 'all', where: [] } };
      records.listSavedViewRecords.mockResolvedValue({ data: null, error: { code: 'invalid' } });
      renderWithLang(<SavedViewResults view={broken} farm={farm} operation={operation} role="owner" userId="u1" />);
      expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load/);
      expect(screen.getByRole('heading', { level: 1, name: 'Mine' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    });

    it('does not offer a download for a filter that is not an object at all', async () => {
      records.listSavedViewRecords.mockResolvedValue({ data: null, error: { code: 'invalid' } });
      renderWithLang(<SavedViewResults view={{ ...view, filter: 'nonsense' }} farm={farm} operation={operation} role="owner" userId="u1" />);
      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    });

    it('writes the report’s title in the language chosen for the report, which can differ from the app’s', async () => {
      const defaultView = { id: 'v9', slug: 'this-seasons-sprays', name: 'x', filter: { kinds: ['activity'], status: ['approved'], season: 'current', where: [] } };
      const user = userEvent.setup();
      renderWithLang(<SavedViewResults view={defaultView} farm={farm} operation={operation} role="owner" userId="u1" />);
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      await screen.findByText('2 records in this report');
      expect(document.querySelector('.report-doc h1').textContent).toBe('This season’s sprays');
      await user.selectOptions(screen.getByLabelText('Report language'), 'es');
      expect(document.querySelector('.report-doc h1').textContent).toBe('Aplicaciones de esta temporada');
    });

    it('names a default view in the app language', async () => {
      const defaultView = { id: 'v9', slug: 'this-seasons-sprays', name: 'x', filter: { kinds: ['activity'], status: ['approved'], season: 'current', where: [] } };
      const user = userEvent.setup();
      renderWithLang(<SavedViewResults view={defaultView} farm={farm} operation={operation} role="owner" userId="u1" />, 'es');
      await user.click(await screen.findByRole('button', { name: 'Descargar' }));
      expect(await screen.findByRole('dialog', { name: 'Descargar: Aplicaciones de esta temporada' })).toBeTruthy();
    });
  });
});
