// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/records.js', () => ({
  listRecords: vi.fn(), setRecordStatus: vi.fn(), listRevisions: vi.fn(), updateRecord: vi.fn(), createRecord: vi.fn(),
}));
const records = await import('../../lib/records.js');
const { default: RecordLog } = await import('./RecordLog.jsx');

const FARM = { id: 'farm-1' };
const purchase = { id: 'p1', kind: 'purchase', status: 'approved', record_date: '2026-10-01', source: 'manual', payload: { product: 'Compost', supplier: 'Acme' }, created_by: 'u1', missing_fields: [] };
const harvest = { id: 'h1', kind: 'harvest', status: 'approved', record_date: '2026-09-01', source: 'manual', payload: { crop: 'Kale', quantity: 5, unit: 'lb' }, created_by: 'u1', missing_fields: [] };

const ui = (kind) => <RecordLog kind={kind} farm={FARM} role="owner" userId="u1" onChanged={() => {}} />;

beforeEach(() => {
  Object.values(records).forEach((fn) => fn.mockReset());
  records.listRevisions.mockResolvedValue({ data: [], error: null });
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
});
