// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, act, within } from '@testing-library/react';
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

const costly = (id, product, supplier, cost, extra = {}) => ({ id, kind: 'purchase', status: 'approved', record_date: '2026-09-01', source: 'manual', payload: { product, supplier, ...(cost === undefined ? {} : { total_cost: cost }) }, created_by: 'u1', missing_fields: [], ...extra });

describe('RecordLog: searching', () => {
  const rows = [costly('a', 'Kelp meal', 'Sea Co', 80), costly('b', 'Compost', 'Green Valley', 120.5), costly('c', 'Neem oil', 'Sea Co', undefined)];
  const open = async () => {
    records.listRecords.mockResolvedValue({ data: rows, error: null });
    const user = userEvent.setup();
    renderWithLang(ui('purchase'));
    await screen.findByText('Kelp meal · Sea Co');
    return user;
  };

  it('narrows the list as the person types, using what is already loaded', async () => {
    const user = await open();
    await user.type(screen.getByRole('searchbox', { name: 'Search this log' }), 'sea');
    expect(screen.getByText('Kelp meal · Sea Co')).toBeTruthy();
    expect(screen.getByText('Neem oil · Sea Co')).toBeTruthy();
    expect(screen.queryByText('Compost · Green Valley')).toBeNull();
    expect(records.listRecords).toHaveBeenCalledTimes(1);
  });

  it('works together with the status filter', async () => {
    records.listRecords.mockResolvedValue({ data: [...rows, costly('d', 'Kelp liquid', 'Sea Co', 10, { status: 'pending_review' })], error: null });
    const user = userEvent.setup();
    renderWithLang(ui('purchase'));
    await screen.findByText('Kelp liquid · Sea Co');
    await user.selectOptions(screen.getByLabelText('Show'), 'approved');
    await user.type(screen.getByRole('searchbox', { name: 'Search this log' }), 'kelp');
    expect(screen.getByText('Kelp meal · Sea Co')).toBeTruthy();
    expect(screen.queryByText('Kelp liquid · Sea Co')).toBeNull();
  });

  it('says when nothing matches, and can be cleared', async () => {
    const user = await open();
    await user.type(screen.getByRole('searchbox', { name: 'Search this log' }), 'tractor');
    expect(screen.getByText('No records match.')).toBeTruthy();
    expect(screen.queryByText('Kelp meal · Sea Co')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Kelp meal · Sea Co')).toBeTruthy();
    expect(screen.queryByText('No records match.')).toBeNull();
  });

  it('shows the plain empty message, not “no match”, for a log with no records at all', async () => {
    records.listRecords.mockResolvedValue({ data: [], error: null });
    renderWithLang(ui('purchase'));
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
    expect(screen.queryByText('No records match.')).toBeNull();
  });

  it('finds records by the Spanish name of a choice in a Spanish app', async () => {
    records.listRecords.mockResolvedValue({ data: [costly('a', 'Kelp meal', 'Sea Co', 80, { payload: { product: 'Kelp meal', supplier: 'Sea Co', category: 'fertilizer' } }), costly('b', 'Compost', 'Green Valley', 10, { payload: { product: 'Compost', supplier: 'Green Valley', category: 'amendment' } })], error: null });
    const user = userEvent.setup();
    renderWithLang(ui('purchase'), 'es');
    await screen.findByText('Kelp meal · Sea Co');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar en este registro' }), 'fertilizante');
    expect(screen.getByText('Kelp meal · Sea Co')).toBeTruthy();
    expect(screen.queryByText('Compost · Green Valley')).toBeNull();
  });

  it('has no search box, and no clear button, until there is something to search or clear', async () => {
    records.listRecords.mockResolvedValue({ data: [], error: null });
    renderWithLang(ui('purchase'));
    await screen.findByText('Nothing here yet.');
    expect(screen.queryByRole('searchbox')).toBeNull();
    cleanup();

    records.listRecords.mockResolvedValue({ data: [costly('a', 'Kelp meal', 'Sea Co', 80)], error: null });
    const user = userEvent.setup();
    renderWithLang(ui('purchase'));
    await screen.findByText('Kelp meal · Sea Co');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search this log' }), 'k');
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
  });

  it('is there for every kind of log, and works in Spanish', async () => {
    records.listRecords.mockResolvedValue({ data: [harvest], error: null });
    const user = userEvent.setup();
    renderWithLang(ui('harvest'), 'es');
    await screen.findByText('Kale · 5 lb');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar en este registro' }), 'zzz');
    expect(screen.getByText('Ningún registro coincide.')).toBeTruthy();
  });
});

describe('RecordLog: the cost of purchases', () => {
  const rows = [costly('a', 'Kelp meal', 'Sea Co', 80), costly('b', 'Compost', 'Green Valley', 120.5), costly('c', 'Neem oil', 'Sea Co', undefined)];
  const open = async (data = rows, kind = 'purchase', lang = 'en') => {
    records.listRecords.mockResolvedValue({ data, error: null });
    const user = userEvent.setup();
    renderWithLang(ui(kind), lang);
    await screen.findAllByRole('row');
    return user;
  };

  it('adds up the cost of the purchases shown, and says how many have no cost', async () => {
    await open();
    expect(screen.getByText('Total cost of the 3 records shown: $200.50')).toBeTruthy();
    expect(screen.getByText('1 has no cost recorded')).toBeTruthy();
  });

  it('follows the search and the filter, adding up only what is shown', async () => {
    const user = await open();
    await user.type(screen.getByRole('searchbox', { name: 'Search this log' }), 'sea');
    expect(screen.getByText('Total cost of the 2 records shown: $80.00')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox', { name: 'Search this log' }));
    await user.selectOptions(screen.getByLabelText('Show'), 'pending_review');
    expect(screen.queryByText(/Total cost/)).toBeNull();
  });

  it('says one record in the singular', async () => {
    await open([costly('a', 'Kelp meal', 'Sea Co', 80)]);
    expect(screen.getByText('Total cost of the 1 record shown: $80.00')).toBeTruthy();
    expect(screen.queryByText(/no cost recorded/)).toBeNull();
  });

  it('says nothing about cost when no purchase shown has one', async () => {
    await open([costly('a', 'Kelp meal', 'Sea Co', undefined)]);
    expect(screen.queryByText(/Total cost/)).toBeNull();
  });

  it('is not shown for a log of anything else, even if a record there happens to hold a cost', async () => {
    await open([{ ...harvest, payload: { ...harvest.payload, total_cost: 5 } }], 'harvest');
    expect(screen.queryByText(/Total cost/)).toBeNull();
  });

  it('is written in Spanish in a Spanish app', async () => {
    await open(rows, 'purchase', 'es');
    expect(screen.getByText('Costo total de los 3 registros mostrados: $200.50')).toBeTruthy();
    expect(screen.getByText('1 no tiene costo registrado')).toBeTruthy();
  });
});

describe('RecordLog: adding from a photo', () => {
  it('opens the capture panel in a dialog, and closes it again', async () => {
    records.listRecords.mockResolvedValue({ data: [purchase], error: null });
    const user = userEvent.setup();
    renderWithLang(ui('purchase'));
    await screen.findByText('Compost · Acme');
    expect(screen.queryByTestId('capture-panel')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add from photo' }));
    const dialog = screen.getByRole('dialog', { name: 'Add from a photo or message' });
    expect(within(dialog).getByTestId('capture-panel')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is there even before the list has loaded, or when it failed to load: capturing does not need it', async () => {
    records.listRecords.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    renderWithLang(ui('purchase'));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Add from photo' }).disabled).toBe(false);
  });

  it('tells the rest of the app when a record was filed, so the review count stays right', async () => {
    records.listRecords.mockResolvedValue({ data: [purchase], error: null });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    renderWithLang(ui('purchase', { onChanged }));
    await screen.findByText('Compost · Acme');
    await user.click(screen.getByRole('button', { name: 'Add from photo' }));
    await user.click(screen.getByRole('button', { name: 'stub filed a record' }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('takes the person to the review queue, and closes the dialog, when the panel asks to', async () => {
    records.listRecords.mockResolvedValue({ data: [purchase], error: null });
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderWithLang(ui('purchase', { onNavigate }));
    await screen.findByText('Compost · Acme');
    await user.click(screen.getByRole('button', { name: 'Add from photo' }));
    await user.click(screen.getByRole('button', { name: 'stub open review' }));
    expect(onNavigate).toHaveBeenCalledWith('needsReview');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so in Spanish', async () => {
    records.listRecords.mockResolvedValue({ data: [purchase], error: null });
    renderWithLang(ui('purchase'), 'es');
    await screen.findByText('Compost · Acme');
    expect(screen.getByRole('button', { name: 'Agregar desde una foto' })).toBeTruthy();
  });
});

