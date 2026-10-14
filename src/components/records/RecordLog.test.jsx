// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/records.js', () => ({
  listRecords: vi.fn(), setRecordStatus: vi.fn(), listRevisions: vi.fn(), updateRecord: vi.fn(), createRecord: vi.fn(),
}));
vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('./CapturePanel.jsx', () => ({
  default: ({ onChanged, onNavigate }) => (
    <div data-testid="capture-panel">
      <button type="button" onClick={() => onChanged?.()}>stub filed a record</button>
      <button type="button" onClick={() => onNavigate?.('needsReview')}>stub open review</button>
    </div>
  ),
}));
vi.mock('../../lib/reportCsv.js', () => ({ downloadCsv: vi.fn() }));
vi.mock('../../lib/reportDocx.js', () => ({ downloadReportDocx: vi.fn() }));
const records = await import('../../lib/records.js');
const reportData = await import('../../lib/reportData.js');
const { default: RecordLog } = await import('./RecordLog.jsx');

const FARM = { id: 'farm-1' };
const purchase = { id: 'p1', kind: 'purchase', status: 'approved', record_date: '2026-10-01', source: 'manual', payload: { product: 'Compost', supplier: 'Acme' }, created_by: 'u1', missing_fields: [] };
const harvest = { id: 'h1', kind: 'harvest', status: 'approved', record_date: '2026-09-01', source: 'manual', payload: { crop: 'Kale', quantity: 5, unit: 'lb' }, created_by: 'u1', missing_fields: [] };

const OPERATION = { operationName: 'Palo Verde Organics' };
const ui = (kind, extra = {}) => <RecordLog kind={kind} farm={FARM} role="owner" userId="u1" operation={OPERATION} needsReviewCount={2} onChanged={() => {}} onNavigate={() => {}} {...extra} />;

beforeEach(() => {
  Object.values(records).forEach((fn) => fn.mockReset());
  records.listRevisions.mockResolvedValue({ data: [], error: null });
  reportData.listRecordsForReport.mockReset();
});
afterEach(cleanup);

describe('RecordLog', () => {
  it('does not offer Add until the list has loaded (a new record would otherwise hide the existing ones)', async () => {
    let finish;
    records.listRecords.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithLang(ui('purchase'));
    expect(screen.getByRole('button', { name: 'Add purchase' }).disabled).toBe(true);
    await act(async () => { finish({ data: [purchase], error: null }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add purchase' }).disabled).toBe(false));
  });

  it('does not offer Add after a failed load', async () => {
    records.listRecords.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    renderWithLang(ui('purchase'));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Add purchase' }).disabled).toBe(true);
  });

  it('shows a clean slate (not the previous log’s rows) while a different log loads', async () => {
    records.listRecords.mockResolvedValueOnce({ data: [purchase], error: null });
    const { rerender } = renderWithLang(ui('purchase'));
    await screen.findByText('Compost · Acme');

    records.listRecords.mockReturnValueOnce(new Promise(() => {}));
    rerender(<RecordLog kind="harvest" farm={FARM} role="owner" userId="u1" onChanged={() => {}} />);
    expect(screen.queryByText('Compost · Acme')).toBeNull();
  });

  it('removes a record from the log once it is voided', async () => {
    records.listRecords.mockResolvedValue({ data: [purchase], error: null });
    records.setRecordStatus.mockResolvedValue({ data: { ...purchase, status: 'voided' }, error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithLang(ui('purchase'));
    await user.click(await screen.findByText('Compost · Acme'));
    await user.click(await screen.findByRole('button', { name: 'Void' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Compost · Acme')).toBeNull());
  });

  it('ignores a slow response for a log the user has already left', async () => {
    let finishOld;
    records.listRecords.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
    const { rerender } = renderWithLang(ui('purchase'));
    records.listRecords.mockResolvedValueOnce({ data: [harvest], error: null });
    rerender(<RecordLog kind="harvest" farm={FARM} role="owner" userId="u1" onChanged={() => {}} />);
    await screen.findByText('Kale · 5 lb');
    await act(async () => { finishOld({ data: [purchase], error: null }); });
    expect(screen.queryByText('Compost · Acme')).toBeNull();
    expect(screen.getByText('Kale · 5 lb')).toBeTruthy();
  });

  describe('downloading the log', () => {
    const other = { ...purchase, id: 'p2', record_date: '2026-09-15', payload: { product: 'Kelp', supplier: 'Bobco' } };

    it('offers a Download button, and gathers every record of that kind when it is used (not only what is on screen)', async () => {
      records.listRecords.mockResolvedValue({ data: [purchase], error: null });
      reportData.listRecordsForReport.mockResolvedValue({ data: { records: [purchase, other], truncated: false }, error: null });
      const user = userEvent.setup();
      renderWithLang(ui('purchase'));
      await screen.findByText('Compost · Acme');
      expect(reportData.listRecordsForReport).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Download' }));
      expect(await screen.findByRole('dialog', { name: 'Download: Purchases' })).toBeTruthy();
      expect(await screen.findByText('2 records in this report')).toBeTruthy();
      expect(reportData.listRecordsForReport).toHaveBeenCalledWith({ farmId: 'farm-1', kinds: ['purchase'], includeUnapproved: false });
    });

    it('puts the operation’s name on the report, and lets the person include records not yet approved', async () => {
      reportData.listRecordsForReport.mockResolvedValue({ data: { records: [purchase], truncated: false }, error: null });
      records.listRecords.mockResolvedValue({ data: [purchase], error: null });
      const user = userEvent.setup();
      renderWithLang(ui('purchase'));
      await screen.findByText('Compost · Acme');
      await user.click(screen.getByRole('button', { name: 'Download' }));
      await screen.findByText('1 record in this report');
      expect(document.querySelector('.report-doc').textContent).toContain('Palo Verde Organics');

      await user.click(screen.getByLabelText(/Also include records not yet approved/));
      await waitFor(() => expect(reportData.listRecordsForReport).toHaveBeenLastCalledWith({ farmId: 'farm-1', kinds: ['purchase'], includeUnapproved: true }));
    });

    it('mentions the records still waiting for review, which are not in the report', async () => {
      reportData.listRecordsForReport.mockResolvedValue({ data: { records: [purchase], truncated: false }, error: null });
      records.listRecords.mockResolvedValue({ data: [purchase], error: null });
      const user = userEvent.setup();
      renderWithLang(ui('purchase'));
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      expect(await screen.findByText('Your farm has 2 records waiting for review. Records waiting for review are not included in this report.')).toBeTruthy();
    });

    it('is there even while the list is still loading or has failed to load', async () => {
      records.listRecords.mockResolvedValue({ data: null, error: { code: 'unknown' } });
      renderWithLang(ui('purchase'));
      await screen.findByRole('alert');
      expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    });
  });
});





