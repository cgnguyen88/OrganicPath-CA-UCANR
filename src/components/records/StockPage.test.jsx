// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('../../lib/records.js', () => ({ createRecord: vi.fn(), updateRecord: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { createRecord } = await import('../../lib/records.js');
const { default: StockPage } = await import('./StockPage.jsx');

const FARM = { id: 'farm-1', name: 'Sunny' };
let n = 0;
const count = (item, unit, quantity, extra = {}) => ({ id: `c${++n}`, kind: 'inventory', status: 'approved', record_date: '2026-05-01', created_at: '2026-05-01T10:00:00Z', source: 'manual', payload: { item, unit, quantity, ...extra } });
const RECORDS = [
  count('Compost', 'bags', 4, { reorder_level: 5 }),
  count('Neem oil', 'qt', 0, { reorder_level: 2, omri_status: 'not_listed' }),
  count('Kelp', 'lb', 20, { reorder_level: 5, omri_status: 'listed', location: 'Barn' }),
  count('Twine', 'rolls', 3),
  { id: 'p1', kind: 'purchase', status: 'approved', record_date: '2026-03-01', payload: { product: 'Compost', supplier: 'Acme', omri_status: 'listed' } },
];
const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });

const setup = (props = {}, lang = 'en') => {
  const onNavigate = vi.fn();
  const onChanged = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<StockPage farm={FARM} role="owner" onNavigate={onNavigate} onChanged={onChanged} {...props} />, lang);
  return { user, onNavigate, onChanged };
};
const rowOf = (item) => screen.getByRole('row', { name: new RegExp(`^${item}\\b`) });
const cellsOf = (item) => within(rowOf(item)).getAllByRole('cell').map((cell) => cell.textContent);
const loaded = () => screen.findByRole('row', { name: /^Compost\b/ });

beforeEach(() => {
  listRecordsForReport.mockReset();
  createRecord.mockReset();
  listRecordsForReport.mockResolvedValue(ok(RECORDS));
  createRecord.mockResolvedValue({ data: { id: 'new', status: 'approved' }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('StockPage: what is on hand', () => {
  it('reads this farm’s approved stock counts and the records that say whether a material is OMRI listed', async () => {
    setup();
    await loaded();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1', kinds: expect.arrayContaining(['inventory', 'purchase', 'input', 'amendment', 'activity']), includeUnapproved: false }));
  });

  it('has a title and says what the page is for, and shows loading first', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Stock on hand' })).toBeTruthy();
    expect(screen.getByText('Loading your stock…')).toBeTruthy();
    await loaded();
  });

  it('shows each item with how much is on hand, its reorder level, status, OMRI status, place and last count', async () => {
    setup();
    await loaded();
    expect(cellsOf('Kelp').slice(0, 7)).toEqual(['Kelp', '20 lb', '5', 'OK', 'OMRI listed', 'Barn', '2026-05-01']);
    expect(cellsOf('Compost').slice(0, 4)).toEqual(['Compost', '4 bags', '5', 'Low']);
    expect(cellsOf('Neem oil').slice(0, 5)).toEqual(['Neem oil', '0 qt', '2', 'Out', 'Not listed']);
  });

  it('shows dashes for what is not known, and says no level was set', async () => {
    setup();
    await loaded();
    expect(cellsOf('Twine').slice(0, 7)).toEqual(['Twine', '3 rolls', '—', 'No level set', 'Unknown', '—', '2026-05-01']);
  });

  it('says where an OMRI status comes from when it comes from the purchase records', async () => {
    setup();
    await loaded();
    expect(cellsOf('Compost')[4]).toBe('OMRI listedfrom your records');
    expect(cellsOf('Kelp')[4]).toBe('OMRI listed');
  });

  it('lists what is out first, then what is low, then the rest', async () => {
    setup();
    await loaded();
    const items = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(items).toEqual(['Neem oil', 'Compost', 'Kelp', 'Twine']);
  });

  it('says how many items need reordering, and which', async () => {
    setup();
    const notice = await screen.findByText('2 items need reordering');
    expect(notice.parentElement.textContent).toContain('Neem oil, Compost');
  });

  it('says "1 item", and lists up to five names then how many more', async () => {
    listRecordsForReport.mockResolvedValue(ok([count('Compost', 'bags', 1, { reorder_level: 5 })]));
    setup();
    expect(await screen.findByText('1 item needs reordering')).toBeTruthy();
    cleanup();
    listRecordsForReport.mockResolvedValue(ok(Array.from({ length: 7 }, (_, i) => count(`Item ${i}`, 'ea', 0))));
    setup();
    const notice = await screen.findByText('7 items need reordering');
    expect(notice.parentElement.textContent).toContain('Item 0, Item 1, Item 2, Item 3, Item 4 and 2 more');
  });

  it('shows no reorder notice when nothing is low', async () => {
    listRecordsForReport.mockResolvedValue(ok([count('Kelp', 'lb', 20, { reorder_level: 5 })]));
    setup();
    await screen.findByRole('row', { name: /^Kelp\b/ });
    expect(screen.queryByText(/need reordering|needs reordering/)).toBeNull();
  });

  it('notes that counts waiting for review are not included', async () => {
    setup();
    await loaded();
    expect(screen.getByText('Counts that are waiting for review are not included until they are approved.')).toBeTruthy();
  });

  it('says there are no counts yet, and offers to add the first', async () => {
    listRecordsForReport.mockResolvedValue(ok([]));
    setup();
    expect(await screen.findByText(/No stock counts yet/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeTruthy();
  });

  it('says the stock could not be read, and reads it again on request', async () => {
    listRecordsForReport.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    const { user } = setup();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load your stock.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await loaded()).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns that some counts may be missing when there were too many records to read', async () => {
    listRecordsForReport.mockResolvedValue(ok(RECORDS, true));
    setup();
    await loaded();
    expect(screen.getByText('You have a great many records, so some counts may be missing here.')).toBeTruthy();
  });

  it('goes to the log of every count', async () => {
    const { user, onNavigate } = setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'See all counts' }));
    expect(onNavigate).toHaveBeenCalledWith('log:inventory');
  });

  it('is in Spanish for a Spanish speaker', async () => {
    setup({}, 'es');
    expect(screen.getByRole('heading', { name: 'Existencias disponibles' })).toBeTruthy();
    await screen.findByRole('row', { name: /^Compost\b/ });
    expect(cellsOf('Neem oil')[3]).toBe('Agotado');
    expect(cellsOf('Kelp')[4]).toBe('Listado en OMRI');
    expect(screen.getByText('2 artículos necesitan reposición')).toBeTruthy();
  });
});

describe('StockPage: filters', () => {
  const shown = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);

  it('shows only what is low or out', async () => {
    const { user } = setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Low or out' }));
    expect(shown()).toEqual(['Neem oil', 'Compost']);
    expect(screen.getByRole('button', { name: 'Low or out' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows only what needs an OMRI check: not listed, or not known', async () => {
    const { user } = setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'OMRI check' }));
    expect(shown()).toEqual(['Neem oil', 'Twine']);
  });

  it('goes back to everything', async () => {
    const { user } = setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Low or out' }));
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(shown()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says so when nothing matches', async () => {
    listRecordsForReport.mockResolvedValue(ok([count('Kelp', 'lb', 20, { reorder_level: 5, omri_status: 'listed' })]));
    const { user } = setup();
    await screen.findByRole('row', { name: /^Kelp\b/ });
    await user.click(screen.getByRole('button', { name: 'Low or out' }));
    expect(screen.getByText('No items match this filter.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('StockPage: counting', () => {
  it('starts a new count of an item from what is known about it, leaving the quantity to be entered', async () => {
    const { user } = setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Update count of Kelp (lb)' }));
    const dialog = screen.getByRole('dialog', { name: 'Add inventory item' });
    expect(within(dialog).getByLabelText(/^Item/).value).toBe('Kelp');
    expect(within(dialog).getByLabelText(/^Unit/).value).toBe('lb');
    expect(within(dialog).getByLabelText(/^Reorder level/).value).toBe('5');
    expect(within(dialog).getByLabelText(/^Location/).value).toBe('Barn');
    expect(within(dialog).getByLabelText(/^Quantity on hand/).value).toBe('');
  });

  it('saves the count for the owner as approved, and reads the stock again so the row shows it', async () => {
    const { user, onChanged } = setup({ role: 'owner' });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Update count of Kelp (lb)' }));
    await user.type(screen.getByLabelText(/^Quantity on hand/), '12');
    await user.click(screen.getByRole('button', { name: 'Save & approve' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({ kind: 'inventory', status: 'approved', payload: expect.objectContaining({ item: 'Kelp', quantity: '12' }) }));
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText('Saved. It will appear here once it is approved.')).toBeNull();
  });

  it('says a crew member’s count will appear once approved, and does not read again for nothing', async () => {
    createRecord.mockResolvedValue({ data: { id: 'new', status: 'pending_review' }, error: null });
    const { user, onChanged } = setup({ role: 'crew' });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Update count of Kelp (lb)' }));
    await user.type(screen.getByLabelText(/^Quantity on hand/), '12');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved. It will appear here once it is approved.');
    expect(listRecordsForReport).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalled();
  });

  it('says a count saved as a draft will appear once it is submitted and approved, not just approved', async () => {
    createRecord.mockResolvedValue({ data: { id: 'new', status: 'draft' }, error: null });
    const { user } = setup({ role: 'crew' });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Update count of Kelp (lb)' }));
    await user.type(screen.getByLabelText(/^Quantity on hand/), '12');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved as a draft. It will appear here once it is submitted and approved.');
    expect(listRecordsForReport).toHaveBeenCalledTimes(1);
  });

  it('keeps the table, and the filters, on screen while it reads the stock again after a count is approved', async () => {
    let answer;
    const { user } = setup({ role: 'owner' });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Low or out' }));
    listRecordsForReport.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Update count of Compost (bags)' }));
    await user.type(screen.getByLabelText(/^Quantity on hand/), '12');
    await user.click(screen.getByRole('button', { name: 'Save & approve' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('table')).toBeTruthy(); // not replaced by "Loading your stock…" meanwhile
    expect(screen.getByRole('button', { name: 'Low or out' }).getAttribute('aria-pressed')).toBe('true');
    answer(ok([count('Compost', 'bags', 12, { reorder_level: 5 })]));
    await waitFor(() => expect(screen.queryByText('Neem oil')).toBeNull());
  });

  it('tells two rows of the same item in different units apart', async () => {
    listRecordsForReport.mockResolvedValue(ok([count('Compost', 'bags', 4), count('Compost', 'yd', 2)]));
    setup();
    await screen.findAllByRole('row', { name: /^Compost\b/ });
    expect(screen.getByRole('button', { name: 'Update count of Compost (bags)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update count of Compost (yd)' })).toBeTruthy();
  });

  it('stops saying a count was saved once another is started', async () => {
    createRecord.mockResolvedValue({ data: { id: 'new', status: 'pending_review' }, error: null });
    const { user } = setup({ role: 'crew' });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Update count of Kelp (lb)' }));
    await user.type(screen.getByLabelText(/^Quantity on hand/), '12');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('adds a brand new item from an empty form', async () => {
    const { user } = setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add inventory item' });
    expect(within(dialog).getByLabelText(/^Item/).value).toBe('');
  });

  it('closes the form without saving', async () => {
    const { user } = setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createRecord).not.toHaveBeenCalled();
  });
});
