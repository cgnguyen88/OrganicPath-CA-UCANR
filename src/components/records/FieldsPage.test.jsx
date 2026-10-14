// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/fields.js', () => ({
  listFields: vi.fn(), createField: vi.fn(), updateField: vi.fn(), setFieldActive: vi.fn(), deleteField: vi.fn(), addFieldsByName: vi.fn(),
}));
vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
const fieldsLib = await import('../../lib/fields.js');
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { default: FarmFieldsProvider } = await import('./FarmFieldsProvider.jsx');
const { default: FieldsPage } = await import('./FieldsPage.jsx');

const FARM = { id: 'farm-1', name: 'Sunny' };
const B2 = { id: 'f-b2', farm_id: 'farm-1', name: 'B2', area: 2.5, area_unit: 'acre', notes: null, is_active: true };
const NORTH = { id: 'f-n', farm_id: 'farm-1', name: 'North 40', area: null, area_unit: null, notes: 'Hay', is_active: true };
const OLD = { id: 'f-old', farm_id: 'farm-1', name: 'Old Orchard', area: null, area_unit: null, notes: null, is_active: false };

const rec = (id, kind, date, payload, status = 'approved') => ({ id, kind, status, record_date: date, source: 'import', payload });
const RECORDS = [
  rec('r1', 'planting', '2026-04-02', { crop: 'Lettuce', field: 'B2' }),
  rec('r2', 'activity', '2026-06-01', { activity_type: 'spray', field: 'B2', product: 'Neem oil' }),
  rec('r3', 'harvest', '2026-06-20', { crop: 'Lettuce', field: 'b2', quantity: 40, unit: 'lb' }),
  rec('r4', 'harvest', '2026-07-01', { crop: 'Kale', field: 'C9', quantity: 5, unit: 'lb' }),
  rec('r5', 'planting', '2026-05-01', { crop: 'Kale', field: 'c9' }),
  rec('r6', 'planting', '2026-05-02', { crop: 'Beans', field: 'Back Yard' }),
  rec('r7', 'planting', '2026-05-03', { crop: 'Kale', field: 'C9' }),
];

const ok = (data) => ({ data, error: null });
const setup = (props = {}, lang = 'en') => {
  const user = userEvent.setup();
  renderWithLang(<FarmFieldsProvider farmId={FARM.id}><FieldsPage farm={FARM} role="owner" {...props} /></FarmFieldsProvider>, lang);
  return { user };
};
const rowOf = (name) => screen.getByRole('row', { name: new RegExp(`^${name}\\b`) });
const cellsOf = (name) => within(rowOf(name)).getAllByRole('cell').map((cell) => cell.textContent);

beforeEach(() => {
  Object.values(fieldsLib).forEach((fn) => fn.mockReset());
  listRecordsForReport.mockReset();
  fieldsLib.listFields.mockResolvedValue(ok([B2, NORTH, OLD]));
  listRecordsForReport.mockResolvedValue(ok({ records: RECORDS, truncated: false }));
  fieldsLib.createField.mockResolvedValue(ok({ ...B2, id: 'new' }));
  fieldsLib.updateField.mockResolvedValue(ok(B2));
  fieldsLib.setFieldActive.mockResolvedValue(ok(B2));
  fieldsLib.deleteField.mockResolvedValue(ok(null));
  fieldsLib.addFieldsByName.mockResolvedValue(ok({ added: 2, skipped: 0, remaining: 0 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(cleanup);

describe('FieldsPage: the list', () => {
  it('has a title and says what fields are for', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Fields' })).toBeTruthy();
    expect(screen.getByText(/every harvest can be traced back/)).toBeTruthy();
  });

  it('shows loading while the fields are read', () => {
    setup();
    expect(screen.getByText('Loading your fields…')).toBeTruthy();
  });

  it('shows each field with its area, crops, record count, last application and harvest, and status', async () => {
    setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(cellsOf('B2').slice(0, 7)).toEqual(['B2', '2.5 acres', 'Lettuce', '3', '2026-06-01', '2026-06-20', 'Active']);
  });

  it('shows a dash for a field with no area and nothing recorded, and keeps its notes under its name', async () => {
    setup();
    await screen.findByRole('row', { name: /^North 40\b/ });
    expect(cellsOf('North 40').slice(0, 7)).toEqual(['North 40Hay', '—', '—', '0', '—', '—', 'Active']);
  });

  it('marks an archived field as archived', async () => {
    setup();
    await screen.findByRole('row', { name: /^Old Orchard\b/ });
    expect(cellsOf('Old Orchard')[6]).toBe('Archived');
  });

  it('matches records to a field whatever the capital letters', async () => {
    setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(cellsOf('B2')[3]).toBe('3'); // "B2", "B2" and "b2"
  });

  it('says there are no fields yet, and offers to add the first, when the farm has none', async () => {
    fieldsLib.listFields.mockResolvedValue(ok([]));
    listRecordsForReport.mockResolvedValue(ok({ records: [], truncated: false }));
    setup();
    expect(await screen.findByText(/No fields yet/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add field' })).toBeTruthy();
  });

  it('says the list could not be read, and reads it again on request', async () => {
    fieldsLib.listFields.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    const { user } = setup();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load your fields.');
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('row', { name: /^B2\b/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the fields are not set up on the server when the database has no fields table, instead of a vague failure', async () => {
    fieldsLib.listFields.mockResolvedValue({ data: null, error: { code: 'not_set_up' } });
    setup();
    expect((await screen.findByRole('alert')).textContent).toContain('Fields are not set up on the server yet');
    expect(screen.queryByText('Could not load your fields.')).toBeNull();
  });

  it('still lists the fields, and says what went wrong, when only the records could not be read', async () => {
    listRecordsForReport.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(await screen.findByText('Could not read your records, so the activity columns are empty.')).toBeTruthy();
    expect(cellsOf('B2').slice(2, 6)).toEqual(['—', '—', '—', '—']);
  });

  it('keeps Details and Edit off until the records are read, since it cannot yet say whether a name is in use', async () => {
    let finish;
    listRecordsForReport.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(screen.getByRole('button', { name: 'Details B2' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Edit B2' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Archive B2' }).disabled).toBe(false); // archiving never depends on the records
    await act(async () => { finish(ok({ records: RECORDS, truncated: false })); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit B2' }).disabled).toBe(false));
    expect(screen.getByRole('button', { name: 'Details B2' }).disabled).toBe(false);
  });

  it('offers to read the records again when they could not be read, and fills the columns in when they can', async () => {
    listRecordsForReport.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    const { user } = setup();
    await screen.findByText('Could not read your records, so the activity columns are empty.');
    expect(screen.getByRole('button', { name: 'Edit B2' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(cellsOf('B2')[3]).toBe('3'));
    expect(screen.queryByText('Could not read your records, so the activity columns are empty.')).toBeNull();
    expect(listRecordsForReport).toHaveBeenCalledTimes(2);
  });

  it('shows records as dashes, not as zero, until they are read', async () => {
    listRecordsForReport.mockReturnValue(new Promise(() => {}));
    setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(cellsOf('B2').slice(2, 6)).toEqual(['—', '—', '—', '—']);
  });

  it('is in Spanish for a Spanish speaker', async () => {
    setup({}, 'es');
    expect(await screen.findByRole('heading', { name: 'Campos' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Última cosecha' })).toBeTruthy();
    expect(cellsOf('B2')[1]).toBe('2.5 acres');
    expect(cellsOf('Old Orchard')[6]).toBe('Archivado');
  });
});

describe('FieldsPage: who can change fields', () => {
  it.each(['owner', 'manager'])('gives a %s every button', async (role) => {
    setup({ role });
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(screen.getByRole('button', { name: 'Add field' })).toBeTruthy();
    for (const name of ['Details B2', 'Edit B2', 'Archive B2']) expect(screen.getByRole('button', { name }), name).toBeTruthy();
    expect(screen.queryByText('Only an owner or manager can change the field list.')).toBeNull();
  });

  it('gives crew the list and the details, and says only an owner or manager can change it', async () => {
    setup({ role: 'crew' });
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(screen.getByRole('button', { name: 'Details B2' })).toBeTruthy();
    for (const name of ['Add field', 'Edit B2', 'Archive B2', 'Delete North 40']) expect(screen.queryByRole('button', { name }), name).toBeNull();
    expect(screen.getByText('Only an owner or manager can change the field list.')).toBeTruthy();
  });

  it('does not offer crew the empty list’s "add your first field" button', async () => {
    fieldsLib.listFields.mockResolvedValue(ok([]));
    setup({ role: 'crew' });
    await screen.findByText(/No fields yet/);
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
  });
});

describe('FieldsPage: details', () => {
  it('opens a field’s details, with its history', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Details B2' }));
    const dialog = screen.getByRole('dialog', { name: 'B2' });
    expect(within(dialog).getByText('3 approved records')).toBeTruthy();
    expect(within(dialog).getByText('Spray · B2 · Neem oil')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('warns in the details when there were too many records to read them all', async () => {
    listRecordsForReport.mockResolvedValue(ok({ records: RECORDS, truncated: true }));
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Details B2' }));
    expect(screen.getByText(/great many records/)).toBeTruthy();
  });
});

describe('FieldsPage: adding and editing', () => {
  it('adds a field, closes the form, and reads the list again', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    fieldsLib.listFields.mockResolvedValue(ok([B2, NORTH, OLD, { ...B2, id: 'new', name: 'South' }]));
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByLabelText(/^Name/), 'South');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('row', { name: /^South\b/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fieldsLib.createField).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1', name: 'South' }));
  });

  it('edits a field', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^North 40\b/ });
    await user.click(screen.getByRole('button', { name: 'Edit North 40' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit field' });
    expect(within(dialog).getByLabelText(/^Name/).value).toBe('North 40');
    await user.type(within(dialog).getByLabelText(/^Area/), '40');
    await user.selectOptions(within(dialog).getByLabelText(/^Unit/), 'acre');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fieldsLib.updateField).toHaveBeenCalledWith('f-n', expect.objectContaining({ name: 'North 40', area: '40', area_unit: 'acre' }));
    expect(fieldsLib.listFields).toHaveBeenCalledTimes(2);
  });

  it('keeps the name of a field that records use fixed, but not one that nothing uses', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Edit B2' }));
    expect(screen.getByLabelText(/^Name/).readOnly).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit North 40' }));
    expect(screen.getByLabelText(/^Name/).readOnly).toBe(false);
  });

  it('closes the form without saving or reading again when cancelled', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fieldsLib.createField).not.toHaveBeenCalled();
    expect(fieldsLib.listFields).toHaveBeenCalledTimes(1);
  });
});

describe('FieldsPage: archiving and deleting', () => {
  it('archives a field and reads the list again', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Archive B2' }));
    await waitFor(() => expect(fieldsLib.listFields).toHaveBeenCalledTimes(2));
    expect(fieldsLib.setFieldActive).toHaveBeenCalledWith('f-b2', false);
  });

  it('restores an archived field', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^Old Orchard\b/ });
    expect(screen.queryByRole('button', { name: 'Archive Old Orchard' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Restore Old Orchard' }));
    await waitFor(() => expect(fieldsLib.setFieldActive).toHaveBeenCalledWith('f-old', true));
  });

  it('says so, and changes nothing on screen, when archiving fails', async () => {
    fieldsLib.setFieldActive.mockResolvedValue({ data: null, error: { code: 'forbidden' } });
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Archive B2' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only an owner or manager can change fields.');
    expect(fieldsLib.listFields).toHaveBeenCalledTimes(1);
  });

  it('offers to delete only a field no record uses, after asking', async () => {
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(screen.queryByRole('button', { name: 'Delete B2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Delete North 40' }));
    expect(window.confirm).toHaveBeenCalledWith('Delete the field “North 40”? This cannot be undone.');
    await waitFor(() => expect(fieldsLib.deleteField).toHaveBeenCalledWith('f-n'));
    await waitFor(() => expect(fieldsLib.listFields).toHaveBeenCalledTimes(2));
  });

  it('deletes nothing when the person does not confirm', async () => {
    window.confirm.mockReturnValue(false);
    const { user } = setup();
    await screen.findByRole('row', { name: /^North 40\b/ });
    await user.click(screen.getByRole('button', { name: 'Delete North 40' }));
    expect(fieldsLib.deleteField).not.toHaveBeenCalled();
  });

  it('explains that a field a draft or older record still uses cannot be deleted', async () => {
    fieldsLib.deleteField.mockResolvedValue({ data: null, error: { code: 'in_use' } });
    const { user } = setup();
    await screen.findByRole('row', { name: /^North 40\b/ });
    await user.click(screen.getByRole('button', { name: 'Delete North 40' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Records use this field, so it cannot be deleted. Archive it instead.');
  });

  it('offers no Delete while the records are still being read, since it cannot yet tell whether a field is used', async () => {
    listRecordsForReport.mockReturnValue(new Promise(() => {}));
    setup();
    await screen.findByRole('row', { name: /^North 40\b/ });
    expect(screen.queryByRole('button', { name: 'Delete North 40' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit North 40' })).toBeTruthy();
  });

  it('turns that row’s buttons off while an action on it is under way', async () => {
    let finish;
    fieldsLib.setFieldActive.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Archive B2' }));
    expect(screen.getByRole('button', { name: 'Edit B2' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Archive B2' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Edit North 40' }).disabled).toBe(false);
    finish(ok(B2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit B2' }).disabled).toBe(false));
  });

  it('clears the last failure when the next action works', async () => {
    fieldsLib.setFieldActive.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    const { user } = setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await user.click(screen.getByRole('button', { name: 'Archive B2' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Archive B2' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('FieldsPage: names found in records', () => {
  it('lists the field names records use that are not in the list, most used first, and offers to add them', async () => {
    setup();
    const banner = await screen.findByText('2 field names in your records are not in this list');
    const box = banner.parentElement;
    expect(box.textContent).toContain('C9 (3), Back Yard (1)');
    expect(within(box).getByRole('button', { name: 'Add them to the list' })).toBeTruthy();
  });

  it('says "1 field name" for one', async () => {
    listRecordsForReport.mockResolvedValue(ok({ records: RECORDS.filter((r) => r.id !== 'r6'), truncated: false }));
    setup();
    expect(await screen.findByText('1 field name in your records is not in this list')).toBeTruthy();
  });

  it('adds them all in one go, says how many, and then the notice goes away', async () => {
    const { user } = setup();
    await screen.findByText('2 field names in your records are not in this list');
    fieldsLib.listFields.mockResolvedValue(ok([B2, NORTH, OLD, { ...B2, id: 'c', name: 'C9' }, { ...B2, id: 'b', name: 'Back Yard' }]));
    await user.click(screen.getByRole('button', { name: 'Add them to the list' }));
    expect(fieldsLib.addFieldsByName).toHaveBeenCalledWith('farm-1', ['C9', 'Back Yard']);
    expect((await screen.findByRole('status')).textContent).toBe('2 fields added.');
    expect(await screen.findByRole('row', { name: /^C9\b/ })).toBeTruthy();
    expect(screen.queryByText(/field names in your records are not in this list/)).toBeNull();
  });

  it('hides the notice as soon as the names are added, even before the list has been read again, so they cannot be added twice', async () => {
    const { user } = setup();
    await screen.findByText('2 field names in your records are not in this list');
    fieldsLib.listFields.mockReturnValue(new Promise(() => {})); // the second read of the list is slow
    await user.click(screen.getByRole('button', { name: 'Add them to the list' }));
    expect((await screen.findByRole('status')).textContent).toBe('2 fields added.');
    expect(screen.queryByText(/field names in your records are not in this list/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add them to the list' })).toBeNull();
    expect(fieldsLib.addFieldsByName).toHaveBeenCalledTimes(1);
  });

  it('shows the notice again when some names were left over to add', async () => {
    fieldsLib.addFieldsByName.mockResolvedValue(ok({ added: 1, skipped: 0, remaining: 1 }));
    const { user } = setup();
    await screen.findByText('2 field names in your records are not in this list');
    fieldsLib.listFields.mockResolvedValue(ok([B2, NORTH, OLD, { ...B2, id: 'c', name: 'C9' }]));
    await user.click(screen.getByRole('button', { name: 'Add them to the list' }));
    expect(await screen.findByText('1 field name in your records is not in this list')).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toBe('1 field added. 1 more was not added yet. Press the button again to add it.');
  });

  it('says "1 field added" for one', async () => {
    fieldsLib.addFieldsByName.mockResolvedValue(ok({ added: 1, skipped: 1, remaining: 0 }));
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add them to the list' }));
    expect((await screen.findByRole('status')).textContent).toBe('1 field added.');
  });

  it('says how many are left when there were too many to add at once', async () => {
    fieldsLib.addFieldsByName.mockResolvedValue(ok({ added: 50, skipped: 0, remaining: 7 }));
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add them to the list' }));
    expect((await screen.findByRole('status')).textContent).toBe('50 fields added. 7 more were not added yet. Press the button again to add them.');
  });

  it('says so, and still reads the list again, when adding stopped part way', async () => {
    fieldsLib.addFieldsByName.mockResolvedValue({ data: null, error: { code: 'unknown', added: 1 } });
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add them to the list' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Please try again.');
    await waitFor(() => expect(fieldsLib.listFields).toHaveBeenCalledTimes(2));
  });

  it('shows the button as busy, and cannot be pressed twice, while adding', async () => {
    let finish;
    fieldsLib.addFieldsByName.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add them to the list' }));
    const busy = screen.getByRole('button', { name: 'Adding…' });
    expect(busy.disabled).toBe(true);
    finish(ok({ added: 2, skipped: 0, remaining: 0 }));
    await screen.findByRole('status');
    expect(fieldsLib.addFieldsByName).toHaveBeenCalledTimes(1);
  });

  it('is not shown to crew, who cannot add fields', async () => {
    setup({ role: 'crew' });
    await screen.findByRole('row', { name: /^B2\b/ });
    await screen.findByText('3');
    expect(screen.queryByText(/field names in your records are not in this list/)).toBeNull();
  });

  it('is not shown when every name is already in the list, or while the records are still being read', async () => {
    listRecordsForReport.mockResolvedValue(ok({ records: RECORDS.slice(0, 3), truncated: false }));
    setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    await screen.findByText('3');
    expect(screen.queryByText(/field names in your records are not in this list/)).toBeNull();
    cleanup();
    listRecordsForReport.mockReturnValue(new Promise(() => {}));
    setup();
    await screen.findByRole('row', { name: /^B2\b/ });
    expect(screen.queryByText(/field names in your records are not in this list/)).toBeNull();
  });

  it('is not shown while the fields are still loading, or could not be read (it would offer to add every name)', async () => {
    fieldsLib.listFields.mockReturnValue(new Promise(() => {}));
    setup();
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(/field names in your records are not in this list/)).toBeNull();
    cleanup();
    fieldsLib.listFields.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    setup();
    await screen.findByRole('alert');
    await act(async () => {});
    expect(screen.queryByText(/field names in your records are not in this list/)).toBeNull();
  });

  it('lists at most ten names, then dots', async () => {
    const many = Array.from({ length: 12 }, (_, i) => rec(`n${i}`, 'planting', '2026-05-01', { crop: 'X', field: `Block ${String(i).padStart(2, '0')}` }));
    listRecordsForReport.mockResolvedValue(ok({ records: many, truncated: false }));
    setup();
    const box = (await screen.findByText('12 field names in your records are not in this list')).parentElement;
    expect(box.textContent).toContain('Block 09 (1)…');
    expect(box.textContent).not.toContain('Block 10');
  });
});
