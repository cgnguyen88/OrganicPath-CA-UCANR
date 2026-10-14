// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/records.js', () => ({ createRecord: vi.fn(), updateRecord: vi.fn() }));
const { createRecord, updateRecord } = await import('../../lib/records.js');
const { default: RecordForm } = await import('./RecordForm.jsx');
const { FarmFieldsContext } = await import('./farmFields.js');

const FARM = 'farm-1';
const setup = (props = {}, lang = 'en') => {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<RecordForm kind="harvest" role="crew" farmId={FARM} today="2026-10-12" onSaved={onSaved} onCancel={onCancel} {...props} />, lang);
  return { user, onSaved, onCancel };
};

const fillHarvest = async (user) => {
  await user.type(screen.getByLabelText(/^Crop/), 'Lettuce');
  await user.type(screen.getByLabelText(/^Field/), 'B4');
  await user.type(screen.getByLabelText(/^Quantity/), '12.5');
  await user.type(screen.getByLabelText(/^Unit/), 'lb');
};

beforeEach(() => {
  createRecord.mockReset();
  updateRecord.mockReset();
});
afterEach(cleanup);

describe('RecordForm: fields', () => {
  it('shows a labelled input for every field of the kind, and the date', () => {
    setup();
    for (const label of ['Date', 'Crop', 'Field / block', 'Quantity', 'Unit', 'Lot number', 'Destination / buyer', 'Notes']) {
      expect(screen.getByLabelText(new RegExp(`^${label}`)), label).toBeTruthy();
    }
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('defaults the date to today', () => {
    setup();
    expect(screen.getByLabelText(/^Date/).value).toBe('2026-10-12');
  });

  it('marks required fields as required', () => {
    setup();
    expect(screen.getByLabelText(/^Crop/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText(/^Lot number/).getAttribute('aria-required')).not.toBe('true');
  });

  it('shows Spanish labels and buttons in Spanish', () => {
    setup({}, 'es');
    expect(screen.getByLabelText(/^Cultivo/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar a revisión' })).toBeTruthy();
  });

  it('renders select fields with their localized options', async () => {
    const { user } = setup({ kind: 'activity' });
    const select = screen.getByLabelText(/^Activity type/);
    expect([...select.options].map((o) => o.textContent)).toEqual(expect.arrayContaining(['Spray', 'Irrigation']));
    await user.selectOptions(select, 'spray');
    expect(select.value).toBe('spray');
  });
});

describe('RecordForm: live validation', () => {
  it('lists what is still needed and keeps Submit disabled until the record is complete', async () => {
    const { user } = setup();
    expect(screen.getByText(/Still needed:/).textContent).toMatch(/Crop.*Field \/ block.*Quantity.*Unit/);
    expect(screen.getByRole('button', { name: 'Submit for review' }).disabled).toBe(true);

    await fillHarvest(user);
    expect(screen.queryByText(/Still needed:/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Submit for review' }).disabled).toBe(false);
  });

  it('makes product, mix rate and target required only when the activity is a spray', async () => {
    const { user } = setup({ kind: 'activity' });
    await user.type(screen.getByLabelText(/^Field/), 'B4');
    await user.selectOptions(screen.getByLabelText(/^Activity type/), 'irrigation');
    expect(screen.queryByText(/Still needed:/)).toBeNull();
    expect(screen.getByLabelText(/^Product/).getAttribute('aria-required')).not.toBe('true');

    await user.selectOptions(screen.getByLabelText(/^Activity type/), 'spray');
    expect(screen.getByText(/Still needed:/).textContent).toMatch(/Product.*Mix rate.*Target pest/);
    expect(screen.getByLabelText(/^Product/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText(/^Mix rate/).getAttribute('aria-required')).toBe('true');
  });

  it('flags an invalid number right away and blocks saving', async () => {
    const { user } = setup();
    await fillHarvest(user);
    await user.clear(screen.getByLabelText(/^Quantity/));
    await user.type(screen.getByLabelText(/^Quantity/), '12abc');
    expect(screen.getByLabelText(/^Quantity/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Submit for review' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save as draft' }).disabled).toBe(true);
  });
});

describe('RecordForm: who can do what', () => {
  it('offers crew "Submit for review", never approval', () => {
    setup({ role: 'crew' });
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save & approve' })).toBeNull();
  });

  it.each(['owner', 'manager'])('offers a %s "Save & approve"', (role) => {
    setup({ role });
    expect(screen.getByRole('button', { name: 'Save & approve' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
  });
});

describe('RecordForm: saving', () => {
  it('submits a normalized record for review and reports it saved', async () => {
    createRecord.mockResolvedValue({ data: { id: 'r1' }, error: null });
    const { user, onSaved } = setup();
    await fillHarvest(user);
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'r1' }));
    expect(createRecord).toHaveBeenCalledWith({
      farmId: FARM, kind: 'harvest', recordDate: '2026-10-12', status: 'pending_review',
      payload: expect.objectContaining({ crop: 'Lettuce', field: 'B4', quantity: '12.5', unit: 'lb' }),
    });
  });

  it('lets an owner save and approve in one step', async () => {
    createRecord.mockResolvedValue({ data: { id: 'r2' }, error: null });
    const { user } = setup({ role: 'owner' });
    await fillHarvest(user);
    await user.click(screen.getByRole('button', { name: 'Save & approve' }));
    await waitFor(() => expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' })));
  });

  it('saves an incomplete record as a draft', async () => {
    createRecord.mockResolvedValue({ data: { id: 'r3' }, error: null });
    const { user, onSaved } = setup();
    await user.type(screen.getByLabelText(/^Crop/), 'Lettuce');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
  });

  it('explains a failure in plain language and does not report success', async () => {
    createRecord.mockResolvedValue({ data: null, error: { code: 'forbidden' } });
    const { user, onSaved } = setup();
    await fillHarvest(user);
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission/i);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Submit for review' }).disabled).toBe(false); // can retry
  });

  it('prevents a double submit while saving', async () => {
    let finish;
    createRecord.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { user } = setup();
    await fillHarvest(user);
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(screen.getByRole('button', { name: 'Saving…' }).disabled).toBe(true);
    finish({ data: { id: 'r' }, error: null });
    await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
  });

  it('cancels without saving', async () => {
    const { user, onCancel } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe('RecordForm: closing and accessibility', () => {
  it('asks before discarding typed data, and keeps the form if the user says no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, onCancel } = setup();
    await user.type(screen.getByLabelText(/^Crop/), 'Lettuce');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('does not ask when nothing was typed', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { user, onCancel } = setup();
    await user.keyboard('{Escape}');
    expect(confirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('cannot be dismissed (Escape or backdrop) while a save is in flight', async () => {
    createRecord.mockReturnValue(new Promise(() => {}));
    const { user, onCancel } = setup();
    await fillHarvest(user);
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('dialog').parentElement);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('links an invalid field to its message for screen readers', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText(/^Quantity/), '12abc');
    const input = screen.getByLabelText(/^Quantity/);
    const message = document.getElementById(input.getAttribute('aria-describedby'));
    expect(message.textContent).toMatch(/not a valid value/i);
  });

  it('says so when the date is outside the supported range (e.g. a year typo; browsers never accept an impossible day like Feb 30)', async () => {
    setup();
    const date = screen.getByLabelText(/^Date/);
    expect(date.getAttribute('aria-invalid')).not.toBe('true');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(date, { target: { value: '2101-01-01' } });
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(date.getAttribute('aria-describedby')).textContent).toMatch(/not a valid value/i);
  });
});

describe('RecordForm: editing', () => {
  it('does not invent a date for a record that has none (it stays missing until someone sets it)', () => {
    setup({ record: { id: 'x', kind: 'harvest', status: 'needs_info', record_date: null, payload: { crop: 'Kale', field: 'A1', quantity: 5, unit: 'lb' } }, role: 'owner' });
    expect(screen.getByLabelText(/^Date/).value).toBe('');
    expect(screen.getByText(/Still needed:/).textContent).toMatch(/Date/);
  });

  const existing = { id: 'rec-9', kind: 'harvest', status: 'pending_review', record_date: '2026-09-30', payload: { crop: 'Kale', field: 'A1', quantity: 5, unit: 'lb' } };

  it('prefills the record and saves changes with updateRecord', async () => {
    updateRecord.mockResolvedValue({ data: { ...existing }, error: null });
    const { user, onSaved } = setup({ record: existing, role: 'owner' });
    expect(screen.getByLabelText(/^Crop/).value).toBe('Kale');
    expect(screen.getByLabelText(/^Quantity/).value).toBe('5');
    expect(screen.getByLabelText(/^Date/).value).toBe('2026-09-30');

    await user.clear(screen.getByLabelText(/^Crop/));
    await user.type(screen.getByLabelText(/^Crop/), 'Chard');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateRecord).toHaveBeenCalledWith('rec-9', { kind: 'harvest', recordDate: '2026-09-30', payload: expect.objectContaining({ crop: 'Chard', quantity: '5' }) });
    expect(createRecord).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save & approve' })).toBeNull();
  });
});

describe('RecordForm: the farm’s field list', () => {
  const f = (name, is_active = true) => ({ id: `id-${name}`, name, is_active });
  const withFields = (fields, props = {}, status = 'ready') => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithLang(
      <FarmFieldsContext.Provider value={{ status, fields, reload: () => {} }}>
        <RecordForm kind="harvest" role="crew" farmId={FARM} today="2026-10-12" onSaved={onSaved} onCancel={() => {}} {...props} />
      </FarmFieldsContext.Provider>,
    );
    return { user, onSaved };
  };

  it('lets the person pick one of the farm’s fields, and saves its name', async () => {
    createRecord.mockResolvedValue({ data: { id: 'r1' }, error: null });
    const { user, onSaved } = withFields([f('B2'), f('North 40')]);
    expect(screen.getByLabelText(/^Field \/ block/).tagName).toBe('SELECT');
    await user.type(screen.getByLabelText(/^Crop/), 'Lettuce');
    await user.selectOptions(screen.getByLabelText(/^Field \/ block/), 'North 40');
    await user.type(screen.getByLabelText(/^Quantity/), '12.5');
    await user.type(screen.getByLabelText(/^Unit/), 'lb');
    expect(screen.queryByText(/Still needed:/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ field: 'North 40' }) }));
  });

  it('still asks for the field until one is chosen', () => {
    withFields([f('B2')]);
    expect(screen.getByText(/Still needed:/).textContent).toMatch(/Field \/ block/);
  });

  it('lets the person type a field that is not in the list, and saves it as typed', async () => {
    createRecord.mockResolvedValue({ data: { id: 'r1' }, error: null });
    const { user, onSaved } = withFields([f('B2')]);
    await user.type(screen.getByLabelText(/^Crop/), 'Lettuce');
    await user.selectOptions(screen.getByLabelText(/^Field \/ block/), 'Other (type a name)…');
    await user.type(screen.getByLabelText('Field name'), 'Back Yard');
    await user.type(screen.getByLabelText(/^Quantity/), '3');
    await user.type(screen.getByLabelText(/^Unit/), 'lb');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ field: 'Back Yard' }) }));
  });

  it('shows a plain box when the farm has no fields, only archived ones, or they are still loading', () => {
    withFields([]);
    expect(screen.getByLabelText(/^Field \/ block/).tagName).toBe('INPUT');
    cleanup();
    withFields([f('Old', false)]);
    expect(screen.getByLabelText(/^Field \/ block/).tagName).toBe('INPUT');
    cleanup();
    withFields([], {}, 'loading');
    expect(screen.getByLabelText(/^Field \/ block/).tagName).toBe('INPUT');
  });

  it('opens a record with the field it already has chosen', () => {
    withFields([f('B2'), f('A1')], { record: { id: 'x', kind: 'harvest', status: 'pending_review', record_date: '2026-09-30', payload: { crop: 'Kale', field: 'a1', quantity: 5, unit: 'lb' } }, role: 'owner' });
    expect(screen.getByLabelText(/^Field \/ block/).value).toBe('A1');
  });

  it('keeps a record’s own field name, even one the list does not have, when other things are changed', async () => {
    updateRecord.mockResolvedValue({ data: { id: 'x' }, error: null });
    const { user, onSaved } = withFields([f('B2')], { record: { id: 'x', kind: 'harvest', status: 'pending_review', record_date: '2026-09-30', payload: { crop: 'Kale', field: 'Back Yard', quantity: 5, unit: 'lb' } }, role: 'owner' });
    expect(screen.getByLabelText('Field name').value).toBe('Back Yard');
    await user.clear(screen.getByLabelText(/^Crop/));
    await user.type(screen.getByLabelText(/^Crop/), 'Chard');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateRecord).toHaveBeenCalledWith('x', expect.objectContaining({ payload: expect.objectContaining({ field: 'Back Yard', crop: 'Chard' }) }));
  });

  it('uses the picker for the field of other kinds of record too, and leaves a kind with no field alone', () => {
    withFields([f('B2')], { kind: 'planting' });
    expect(screen.getByLabelText(/^Field \/ block/).tagName).toBe('SELECT');
    cleanup();
    withFields([f('B2')], { kind: 'purchase' });
    expect(screen.queryByLabelText(/^Field \/ block/)).toBeNull();
  });
});

describe('RecordForm: starting from some values', () => {
  const prefill = { item: 'Compost', unit: 'bags', reorder_level: '5', omri_status: 'listed' };

  it('fills the boxes it is given, and asks only for what is still missing', () => {
    setup({ kind: 'inventory', prefill });
    expect(screen.getByLabelText(/^Item/).value).toBe('Compost');
    expect(screen.getByLabelText(/^Unit/).value).toBe('bags');
    expect(screen.getByLabelText(/^Reorder level/).value).toBe('5');
    expect(screen.getByLabelText(/^OMRI status/).value).toBe('listed');
    expect(screen.getByText(/Still needed:/).textContent).toMatch(/Quantity on hand/);
    expect(screen.getByText(/Still needed:/).textContent).not.toMatch(/Item|Unit/);
  });

  it('makes a NEW record from them (it is not an edit), with today’s date', async () => {
    createRecord.mockResolvedValue({ data: { id: 'new' }, error: null });
    const { user, onSaved } = setup({ kind: 'inventory', prefill });
    expect(screen.getByRole('dialog', { name: 'Add inventory item' })).toBeTruthy();
    expect(screen.getByLabelText(/^Date/).value).toBe('2026-10-12');
    await user.type(screen.getByLabelText(/^Quantity on hand/), '3');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'inventory', recordDate: '2026-10-12', status: 'pending_review',
      payload: expect.objectContaining({ item: 'Compost', unit: 'bags', quantity: '3', reorder_level: '5', omri_status: 'listed' }),
    }));
  });

  it('closes without asking "discard?" when nothing was changed from what it started with', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, onCancel } = setup({ kind: 'inventory', prefill });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('ignores a value for a box the kind does not have, and a value that is not text', () => {
    setup({ kind: 'inventory', prefill: { item: 'Kelp', bogus: 'x', quantity: 7, notes: null } });
    expect(screen.getByLabelText(/^Item/).value).toBe('Kelp');
    expect(screen.getByLabelText(/^Quantity on hand/).value).toBe('7');
    expect(screen.getByLabelText(/^Notes/).value).toBe('');
  });

  it('lets a record being edited keep its own values over any it was started with', () => {
    setup({ kind: 'harvest', role: 'owner', prefill: { crop: 'Wrong' }, record: { id: 'x', kind: 'harvest', status: 'pending_review', record_date: '2026-09-30', payload: { crop: 'Kale', field: 'A1', quantity: 5, unit: 'lb' } } });
    expect(screen.getByLabelText(/^Crop/).value).toBe('Kale');
  });
});
