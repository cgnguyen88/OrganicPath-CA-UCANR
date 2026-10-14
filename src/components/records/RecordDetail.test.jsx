// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/records.js', () => ({ listRevisions: vi.fn(), setRecordStatus: vi.fn(), updateRecord: vi.fn(), createRecord: vi.fn() }));
vi.mock('../../lib/db.js', () => ({ getAttachmentUrl: vi.fn() }));
vi.mock('../../lib/fields.js', () => ({ addFieldsByName: vi.fn() }));
const db = await import('../../lib/db.js');
const records = await import('../../lib/records.js');
const { default: RecordDetail } = await import('./RecordDetail.jsx');
const { FarmFieldsContext } = await import('./farmFields.js');

const base = { id: 'r1', kind: 'activity', status: 'pending_review', record_date: '2026-10-01', source: 'telegram', confidence: 0.82, created_at: '2026-10-01T12:00:00Z', reviewed_at: null, created_by: 'crew-1', missing_fields: [], payload: { activity_type: 'spray', field: 'B4', product: 'Bt', rate: '1 oz/gal', target: 'caterpillars' } };

const setup = (record = base, props = {}, lang = 'en') => {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<RecordDetail record={record} role="owner" userId="owner-1" farm={{ id: 'farm-1' }} onClose={onClose} onChanged={onChanged} {...props} />, lang);
  return { user, onClose, onChanged };
};

beforeEach(() => {
  Object.values(records).forEach((fn) => fn.mockReset());
  records.listRevisions.mockResolvedValue({ data: [
    { id: 1, version: 1, change_type: 'created', changed_at: '2026-10-01T12:00:00Z', changed_by: 'crew-1' },
    { id: 2, version: 2, change_type: 'status:approved', changed_at: '2026-10-02T09:00:00Z', changed_by: 'owner-1' },
  ], error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RecordDetail: content', () => {
  it('shows the record’s fields with localized labels and option values', async () => {
    setup();
    expect(screen.getByRole('dialog')).toBeTruthy();
    for (const [label, value] of [['Activity type', 'Spray'], ['Field / block', 'B4'], ['Product', 'Bt'], ['Mix rate', '1 oz/gal'], ['Target pest / disease', 'caterpillars']]) {
      const row = screen.getByText(label).closest('[data-testid="detail-row"]');
      expect(within(row).getByText(value), label).toBeTruthy();
    }
    await screen.findByText('Approved');
  });

  it('shows the status, source and reading confidence', async () => {
    setup();
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(screen.getByText('Telegram')).toBeTruthy();
    expect(screen.getByText('82%')).toBeTruthy();
    await screen.findByText('Approved');
  });

  it('shows what is missing on an incomplete record', async () => {
    setup({ ...base, status: 'needs_info', missing_fields: ['product', 'rate'], payload: { activity_type: 'spray', field: 'B4' } });
    expect(screen.getByText(/Missing:/).textContent).toMatch(/Product, Mix rate/);
    await screen.findByText('Created');
  });

  it('loads and shows the change history', async () => {
    setup();
    expect(await screen.findByText('Created')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(records.listRevisions).toHaveBeenCalledWith({ farmId: 'farm-1', recordId: 'r1' });
  });

  it('shows Spanish labels', async () => {
    setup(base, {}, 'es');
    expect(screen.getByText('Tipo de actividad')).toBeTruthy();
    expect(screen.getByText('Aplicación (spray)')).toBeTruthy();
    await screen.findByText('Creado');
  });

  it('closes from the Close button and from Escape', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    await screen.findByText('Created');
  });
});

describe('RecordDetail: actions follow the role', () => {
  const buttons = () => screen.queryAllByRole('button').map((b) => b.textContent);

  it('gives an owner approve, reject, ask-for-details, void and edit on a pending record', async () => {
    setup();
    expect(buttons()).toEqual(expect.arrayContaining(['Approve', 'Reject', 'Ask for details', 'Void', 'Edit']));
    await screen.findByText('Created');
  });

  it('gives an owner only Void and Edit on an approved record', async () => {
    setup({ ...base, status: 'approved' });
    expect(buttons()).toEqual(expect.arrayContaining(['Void', 'Edit']));
    for (const name of ['Approve', 'Reject', 'Ask for details']) expect(buttons()).not.toContain(name);
    await screen.findByText('Created');
  });

  it('gives crew an Edit button only on their own unreviewed record, and nothing else', async () => {
    setup(base, { role: 'crew', userId: 'crew-1' });
    expect(buttons()).toContain('Edit');
    for (const name of ['Approve', 'Reject', 'Void', 'Ask for details']) expect(buttons()).not.toContain(name);
    await screen.findByText('Created');
  });

  it('gives crew nothing on someone else’s record or an approved one', async () => {
    setup(base, { role: 'crew', userId: 'crew-2' });
    expect(buttons()).not.toContain('Edit');
    cleanup();
    setup({ ...base, status: 'approved' }, { role: 'crew', userId: 'crew-1' });
    expect(buttons()).not.toContain('Edit');
    await screen.findByText('Created');
  });

  it('lets crew send their own draft for review, and only their own', async () => {
    records.setRecordStatus.mockResolvedValue({ data: { ...base, status: 'pending_review' }, error: null });
    const { user, onChanged } = setup({ ...base, status: 'draft' }, { role: 'crew', userId: 'crew-1' });
    expect(buttons()).toContain('Submit for review');
    for (const name of ['Approve', 'Reject', 'Void']) expect(buttons()).not.toContain(name);
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(records.setRecordStatus).toHaveBeenCalledWith('r1', 'pending_review'));
    expect(onChanged).toHaveBeenCalled();
    cleanup();
    setup({ ...base, status: 'needs_info' }, { role: 'crew', userId: 'crew-9' });
    expect(buttons()).not.toContain('Submit for review');
    await screen.findByText('Created');
  });

  it('offers nothing on a voided record', async () => {
    setup({ ...base, status: 'voided' });
    for (const name of ['Approve', 'Reject', 'Void', 'Edit', 'Ask for details']) expect(buttons()).not.toContain(name);
    await screen.findByText('Created');
  });
});

describe('RecordDetail: acting', () => {
  it('approves and tells the parent, showing the new status', async () => {
    records.setRecordStatus.mockResolvedValue({ data: { ...base, status: 'approved' }, error: null });
    const { user, onChanged } = setup();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(records.setRecordStatus).toHaveBeenCalledWith('r1', 'approved'));
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
    await screen.findByText('Created');
  });

  it('asks for confirmation before voiding and does nothing if declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user } = setup({ ...base, status: 'approved' });
    await user.click(screen.getByRole('button', { name: 'Void' }));
    expect(confirm).toHaveBeenCalled();
    expect(records.setRecordStatus).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    records.setRecordStatus.mockResolvedValue({ data: { ...base, status: 'voided' }, error: null });
    await user.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() => expect(records.setRecordStatus).toHaveBeenCalledWith('r1', 'voided'));
    confirm.mockRestore();
  });

  it('explains a refused action', async () => {
    records.setRecordStatus.mockResolvedValue({ data: null, error: { code: 'invalid_transition' } });
    const { user, onChanged } = setup();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not allowed/i);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('opens the edit form and reports a saved edit', async () => {
    records.updateRecord.mockResolvedValue({ data: { ...base, payload: { ...base.payload, product: 'Spinosad' } }, error: null });
    const { user, onChanged } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit activity' })).toBeTruthy();
    await user.clear(screen.getByLabelText(/^Product/));
    await user.type(screen.getByLabelText(/^Product/), 'Spinosad');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' })));
  });
});

describe('RecordDetail: source files', () => {
  const withFiles = { ...base, attachments: [{ path: 'farm-1/h/0.jpg', media_type: 'image/jpeg', bytes: 10 }, { path: 'farm-1/h/1.pdf', media_type: 'application/pdf', bytes: 20 }] };

  it('shows nothing for a record with no stored files', () => {
    setup(base);
    expect(screen.queryByText('Source file')).toBeNull();
  });

  it('opens a stored file through a freshly signed link', async () => {
    db.getAttachmentUrl.mockResolvedValue('https://signed/1');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = setup(withFiles);
    expect(screen.getByText('Source file')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'View file 2' }));
    expect(db.getAttachmentUrl).toHaveBeenCalledWith(expect.objectContaining({ path: 'farm-1/h/1.pdf' }));
    expect(open).toHaveBeenCalledWith('https://signed/1', '_blank', 'noopener,noreferrer');
  });

  it('says so when the link cannot be made, and opens nothing', async () => {
    db.getAttachmentUrl.mockResolvedValue(null);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = setup(withFiles);
    await user.click(screen.getByRole('button', { name: 'View file 1' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not open the file/);
    expect(open).not.toHaveBeenCalled();
  });

  it('is available in Spanish', () => {
    setup(withFiles, {}, 'es');
    expect(screen.getByText('Archivo de origen')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver archivo 1' })).toBeTruthy();
  });
});

describe('RecordDetail: the farm’s field list', () => {
  const withList = (fields, props = {}) => {
    const user = userEvent.setup();
    renderWithLang(
      <FarmFieldsContext.Provider value={{ status: 'ready', fields, reload: () => {} }}>
        <RecordDetail record={base} role="owner" userId="owner-1" farm={{ id: 'farm-1' }} onClose={() => {}} onChanged={() => {}} {...props} />
      </FarmFieldsContext.Provider>,
    );
    return { user };
  };
  const list = (...names) => names.map((name) => ({ id: `id-${name}`, name, is_active: true }));

  it('says the record’s field is not in the list, right under the field, when it is not', async () => {
    withList(list('A1', 'C2'));
    const row = screen.getByText('Field / block').closest('[data-testid="detail-row"]');
    expect(within(row).getByText('“B4” is not in your field list.')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Add to field list' })).toBeTruthy();
    await screen.findByText('Approved');
  });

  it('says nothing when the field is in the list, whatever its capital letters', async () => {
    withList(list('b4'));
    expect(screen.queryByText(/is not in your field list/)).toBeNull();
    await screen.findByText('Approved');
  });

  it('says nothing for a farm that has no field list yet', async () => {
    withList([]);
    expect(screen.queryByText(/is not in your field list/)).toBeNull();
    await screen.findByText('Approved');
  });

  it('does not offer crew the button', async () => {
    withList(list('A1'), { role: 'crew' });
    expect(screen.getByText('“B4” is not in your field list.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to field list' })).toBeNull();
    await screen.findByText('Approved');
  });

  it('puts no hint on other fields, or on a record with no field', async () => {
    withList(list('A1'), { record: { ...base, kind: 'purchase', payload: { product: 'Compost', supplier: 'Acme' } } });
    expect(screen.queryByText(/is not in your field list/)).toBeNull();
    await screen.findByText('Approved');
  });
});
