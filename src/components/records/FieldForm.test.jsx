// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/fields.js', () => ({ createField: vi.fn(), updateField: vi.fn() }));
const { createField, updateField } = await import('../../lib/fields.js');
const { default: FieldForm } = await import('./FieldForm.jsx');

const FARM = 'farm-1';
const B2 = { id: 'f-b2', farm_id: FARM, name: 'B2', area: 2.5, area_unit: 'acre', notes: 'Drip lines', is_active: true };

const setup = (props = {}, lang = 'en') => {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<FieldForm farmId={FARM} onSaved={onSaved} onCancel={onCancel} {...props} />, lang);
  return { user, onSaved, onCancel };
};
const name = () => screen.getByLabelText(/^Name/);
const area = () => screen.getByLabelText(/^Area/);
const unit = () => screen.getByLabelText(/^Unit/);
const notes = () => screen.getByLabelText(/^Notes/);
const save = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  createField.mockReset();
  updateField.mockReset();
  createField.mockResolvedValue({ data: { ...B2, id: 'new' }, error: null });
  updateField.mockResolvedValue({ data: B2, error: null });
});
afterEach(cleanup);

describe('FieldForm: adding', () => {
  it('opens as an add dialog with everything empty, and a hint about what to type', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Add field' })).toBeTruthy();
    expect(name().value).toBe('');
    expect(area().value).toBe('');
    expect(notes().value).toBe('');
    expect(screen.getByText(/for example B2 or North 40/)).toBeTruthy();
  });

  it('offers the three units, and none chosen', () => {
    setup();
    expect(unit().value).toBe('');
    expect([...unit().options].map((o) => o.textContent)).toEqual(['', 'acres', 'hectares', 'sq ft']);
  });

  it('saves a field with a name only', async () => {
    const { user, onSaved } = setup();
    await user.type(name(), '  North   40 ');
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(createField).toHaveBeenCalledWith({ farmId: FARM, name: '  North   40 ', area: '', area_unit: '', notes: '' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }));
  });

  it('saves the area, the unit and the notes too', async () => {
    const { user } = setup();
    await user.type(name(), 'B2');
    await user.type(area(), '2.5');
    await user.selectOptions(unit(), 'hectare');
    await user.type(notes(), 'Drip lines');
    await user.click(save());
    await waitFor(() => expect(createField).toHaveBeenCalled());
    expect(createField).toHaveBeenCalledWith({ farmId: FARM, name: 'B2', area: '2.5', area_unit: 'hectare', notes: 'Drip lines' });
  });

  it('asks for a name, and does not save, when there is none', async () => {
    const { user } = setup();
    await user.click(save());
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(name().getAttribute('aria-invalid')).toBe('true');
    expect(createField).not.toHaveBeenCalled();
  });

  it('asks for a unit when there is an area, and says an area must be a number', async () => {
    const { user } = setup();
    await user.type(name(), 'B2');
    await user.type(area(), '2.5');
    await user.click(save());
    expect(screen.getByText('Choose a unit.')).toBeTruthy();
    expect(unit().getAttribute('aria-invalid')).toBe('true');
    await user.clear(area());
    await user.type(area(), 'big');
    await user.click(save());
    expect(screen.getByText('That is not valid.')).toBeTruthy();
    expect(createField).not.toHaveBeenCalled();
  });

  it('says a name is too long', async () => {
    const { user } = setup();
    await user.click(name());
    await user.paste('x'.repeat(61));
    await user.click(save());
    expect(screen.getByText('That is too long.')).toBeTruthy();
  });

  it('clears the complaint about a box once that box is changed', async () => {
    const { user } = setup();
    await user.click(save());
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    await user.type(name(), 'B');
    expect(screen.queryByText('Enter a name.')).toBeNull();
    expect(name().getAttribute('aria-invalid')).toBeNull();
  });
});

describe('FieldForm: keyboard and focus', () => {
  it('saves when Enter is pressed in a box', async () => {
    const { user, onSaved } = setup();
    await user.type(name(), 'B2{Enter}');
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(createField).toHaveBeenCalledWith(expect.objectContaining({ name: 'B2' }));
  });

  it('does not save on Enter when something is wrong, and says what', async () => {
    const { user } = setup();
    await user.type(name(), '{Enter}');
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(createField).not.toHaveBeenCalled();
  });

  it('moves the cursor to the first box with something wrong, so it can be fixed at once', async () => {
    const { user } = setup();
    await user.type(name(), 'B2');
    await user.type(area(), 'big');
    await user.click(save());
    expect(document.activeElement).toBe(area());
    await user.clear(name());
    await user.click(save());
    expect(document.activeElement).toBe(name());
  });

  it('announces what is wrong with a box', async () => {
    const { user } = setup();
    await user.click(save());
    expect(screen.getByRole('alert').textContent).toBe('Enter a name.');
  });
});

describe('FieldForm: when the save fails', () => {
  const fillName = async (user) => {
    await user.type(name(), 'B2');
    await user.click(save());
  };

  it.each(['duplicate', 'in_use'])('puts a %s complaint at the name box, and moves the cursor there', async (code) => {
    createField.mockResolvedValueOnce({ data: null, error: { code } });
    const { user } = setup();
    await fillName(user);
    await screen.findByRole('alert');
    expect(name().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name());
  });

  it.each([
    ['duplicate', 'You already have a field with that name.'],
    ['in_use', 'Records use this name, so it cannot be changed. You can change the area and notes, or archive this field and add a new one.'],
    ['forbidden', 'Only an owner or manager can change fields.'],
    ['not_set_up', 'Fields are not set up on the server yet. Ask whoever looks after your database to apply the latest database update, then try again.'],
    ['unknown', 'Something went wrong. Please try again.'],
  ])('explains %s, keeps what was typed, and lets the person try again', async (code, message) => {
    createField.mockResolvedValueOnce({ data: null, error: { code } });
    const { user, onSaved } = setup();
    await fillName(user);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(name().value).toBe('B2');
    expect(onSaved).not.toHaveBeenCalled();
    createField.mockResolvedValueOnce({ data: B2, error: null });
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('shows the database’s per-box complaints next to those boxes', async () => {
    createField.mockResolvedValueOnce({ data: null, error: { code: 'invalid', fields: { name: 'too_long', area_unit: 'required' } } });
    const { user } = setup();
    await fillName(user);
    expect(await screen.findByText('That is too long.')).toBeTruthy();
    expect(screen.getByText('Choose a unit.')).toBeTruthy();
  });

  it('says it is not valid when the database says so without saying why', async () => {
    createField.mockResolvedValueOnce({ data: null, error: { code: 'invalid' } });
    const { user } = setup();
    await fillName(user);
    expect((await screen.findByRole('alert')).textContent).toBe('That is not valid.');
  });

  it('cannot be closed, or saved twice, while the save is under way', async () => {
    let finish;
    createField.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { user, onCancel } = setup();
    await fillName(user);
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving.disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    finish({ data: B2, error: null });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull());
    expect(createField).toHaveBeenCalledTimes(1);
  });
});

describe('FieldForm: editing', () => {
  it('opens as an edit dialog with the field’s own values', () => {
    setup({ field: B2 });
    expect(screen.getByRole('dialog', { name: 'Edit field' })).toBeTruthy();
    expect(name().value).toBe('B2');
    expect(area().value).toBe('2.5');
    expect(unit().value).toBe('acre');
    expect(notes().value).toBe('Drip lines');
  });

  it('shows an area the database sent as text without its trailing zeros', () => {
    setup({ field: { ...B2, area: '2.500' } });
    expect(area().value).toBe('2.5');
  });

  it('shows a field with no area or notes as empty boxes', () => {
    setup({ field: { ...B2, area: null, area_unit: null, notes: null } });
    expect(area().value).toBe('');
    expect(unit().value).toBe('');
    expect(notes().value).toBe('');
  });

  it('saves the changes to that field', async () => {
    const { user, onSaved } = setup({ field: B2 });
    await user.clear(area());
    await user.type(area(), '3');
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateField).toHaveBeenCalledWith('f-b2', { name: 'B2', area: '3', area_unit: 'acre', notes: 'Drip lines' });
    expect(createField).not.toHaveBeenCalled();
  });

  it('keeps the name fixed, and says why, when records use it', async () => {
    const { user } = setup({ field: B2, nameLocked: true });
    expect(name().readOnly).toBe(true);
    expect(screen.getByText(/Records use this name, so it cannot be changed/)).toBeTruthy();
    await user.type(name(), 'X');
    expect(name().value).toBe('B2');
  });

  it('lets the name be changed when no record uses it', async () => {
    const { user } = setup({ field: B2 });
    expect(name().readOnly).toBe(false);
    await user.type(name(), '3');
    expect(name().value).toBe('B23');
    expect(screen.queryByText(/Records use this name/)).toBeNull();
  });
});

describe('FieldForm: leaving', () => {
  it('closes with Cancel, saving nothing', async () => {
    const { user, onCancel } = setup();
    await user.type(name(), 'B2');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createField).not.toHaveBeenCalled();
  });

  it('is in Spanish for a Spanish speaker', () => {
    setup({}, 'es');
    expect(screen.getByRole('dialog', { name: 'Agregar campo' })).toBeTruthy();
    expect(screen.getByLabelText(/^Superficie/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
    expect([...screen.getByLabelText(/^Unidad/).options].map((o) => o.textContent)).toEqual(['', 'acres', 'hectáreas', 'pies²']);
  });
});
