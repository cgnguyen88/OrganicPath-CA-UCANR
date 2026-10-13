// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/records.js', () => ({
  listRecords: vi.fn(), setRecordStatus: vi.fn(), listRevisions: vi.fn(), updateRecord: vi.fn(), createRecord: vi.fn(),
}));
const records = await import('../../lib/records.js');
const { default: NeedsReview } = await import('./NeedsReview.jsx');

const pending = { id: 'p1', kind: 'purchase', status: 'pending_review', record_date: '2026-10-01', payload: { product: 'Compost', supplier: 'Acme' }, source: 'telegram', missing_fields: [], created_by: 'crew-1' };
const needsInfo = { id: 'n1', kind: 'activity', status: 'needs_info', record_date: '2026-10-02', payload: { activity_type: 'spray', field: 'B4' }, source: 'telegram', missing_fields: ['product', 'rate', 'target'], created_by: 'crew-1' };

const setup = (props = {}, lang = 'en') => {
  const onChanged = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<NeedsReview farm={{ id: 'farm-1' }} role="owner" userId="owner-1" onChanged={onChanged} {...props} />, lang);
  return { user, onChanged };
};

beforeEach(() => {
  Object.values(records).forEach((fn) => fn.mockReset());
  records.listRecords.mockResolvedValue({ data: [pending, needsInfo], error: null });
  records.listRevisions.mockResolvedValue({ data: [], error: null });
});
afterEach(cleanup);

describe('NeedsReview: loading', () => {
  it('loads records waiting for review or for details, for this farm', async () => {
    setup();
    await screen.findByText('Compost · Acme');
    expect(records.listRecords).toHaveBeenCalledWith({ farmId: 'farm-1', statuses: ['pending_review', 'needs_info'] });
  });

  it('shows each record’s summary, type and date', async () => {
    setup();
    expect(await screen.findByText('Compost · Acme')).toBeTruthy();
    expect(screen.getByText('Spray · B4')).toBeTruthy();
    expect(screen.getByText('2026-10-01')).toBeTruthy();
  });

  it('shows what a "needs info" record is still missing, with no way to approve it yet', async () => {
    setup();
    const card = (await screen.findByText('Spray · B4')).closest('[data-testid="review-item"]');
    expect(within(card).getByText(/Waiting for details/)).toBeTruthy();
    expect(within(card).getByText(/Product, Mix rate, Target pest \/ disease/)).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows an empty state', async () => {
    records.listRecords.mockResolvedValue({ data: [], error: null });
    setup();
    expect(await screen.findByText('Nothing is waiting for review.')).toBeTruthy();
  });

  it('shows a clear message if loading fails', async () => {
    records.listRecords.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    setup();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load records/);
  });

  it('is available in Spanish', async () => {
    setup({}, 'es');
    expect(await screen.findByRole('heading', { name: 'Por Revisar' })).toBeTruthy();
  });
});

describe('NeedsReview: reviewing (owner / manager)', () => {
  const card = async () => (await screen.findByText('Compost · Acme')).closest('[data-testid="review-item"]');

  it.each(['owner', 'manager'])('lets a %s approve, reject or ask for details', async (role) => {
    setup({ role });
    const c = await card();
    for (const name of ['Approve', 'Reject', 'Ask for details']) expect(within(c).getByRole('button', { name }), name).toBeTruthy();
  });

  it.each([
    ['Approve', 'approved'],
    ['Reject', 'rejected'],
  ])('"%s" sets the status to %s, removes the record from the queue and tells the parent', async (label, status) => {
    records.setRecordStatus.mockResolvedValue({ data: { ...pending, status }, error: null });
    const { user, onChanged } = setup();
    await user.click(within(await card()).getByRole('button', { name: label }));

    await waitFor(() => expect(records.setRecordStatus).toHaveBeenCalledWith('p1', status));
    await waitFor(() => expect(screen.queryByText('Compost · Acme')).toBeNull());
    expect(onChanged).toHaveBeenCalled();
  });

  it('"Ask for details" keeps the record visible but moves it to the waiting-for-details section, with no approve button', async () => {
    records.setRecordStatus.mockResolvedValue({ data: { ...pending, status: 'needs_info', missing_fields: ['supplier'] }, error: null });
    const { user, onChanged } = setup();
    await user.click(within(await card()).getByRole('button', { name: 'Ask for details' }));

    await waitFor(() => expect(records.setRecordStatus).toHaveBeenCalledWith('p1', 'needs_info'));
    const moved = (await screen.findByText('Compost · Acme')).closest('[data-testid="review-item"]');
    await waitFor(() => expect(within(moved).getByText(/Waiting for details/)).toBeTruthy());
    expect(within(moved).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the record and explains when the action is refused', async () => {
    records.setRecordStatus.mockResolvedValue({ data: null, error: { code: 'forbidden' } });
    const { user, onChanged } = setup();
    await user.click(within(await card()).getByRole('button', { name: 'Approve' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/permission/i);
    expect(screen.getByText('Compost · Acme')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('explains an incomplete record that cannot be approved', async () => {
    records.setRecordStatus.mockResolvedValue({ data: null, error: { code: 'incomplete' } });
    const { user } = setup();
    await user.click(within(await card()).getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/missing required details/i);
  });
});

describe('NeedsReview: crew', () => {
  it('shows the queue read-only, with a note that an owner or manager will review', async () => {
    setup({ role: 'crew', userId: 'crew-1' });
    await screen.findByText('Compost · Acme');
    for (const name of ['Approve', 'Reject', 'Ask for details']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByText(/owner or manager will review/i)).toBeTruthy();
  });
});

describe('NeedsReview: details', () => {
  it('opens the record’s details when its row is clicked', async () => {
    const { user } = setup();
    await user.click(await screen.findByText('Compost · Acme'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(records.listRevisions).toHaveBeenCalledWith({ farmId: 'farm-1', recordId: 'p1' });
  });
});
