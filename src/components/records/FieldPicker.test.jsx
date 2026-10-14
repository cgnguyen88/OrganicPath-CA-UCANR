// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';
import FieldPicker from './FieldPicker.jsx';

const f = (name, is_active = true) => ({ id: `id-${name}`, name, is_active });
const B2 = f('B2');
const NORTH = f('North 40');
const OLD = f('Old Orchard', false);

/** A parent that owns the value, as the record form does. */
function Harness({ initial = '', onValue, ...props }) {
  const [value, setValue] = useState(initial);
  return <FieldPicker id="rec-field" label="Field / block *" value={value} onChange={(next) => { setValue(next); onValue?.(next); }} {...props} />;
}
const setup = (props = {}, lang = 'en') => {
  const onValue = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<Harness fields={[B2, NORTH, OLD]} onValue={onValue} {...props} />, lang);
  return { user, onValue };
};
const select = () => screen.getByLabelText(/^Field \/ block/);
const optionTexts = () => [...select().options].map((o) => o.textContent);
afterEach(cleanup);

describe('FieldPicker: choosing', () => {
  it('offers the active fields, a first choice that says what to do, and "Other"', () => {
    setup();
    expect(optionTexts()).toEqual(['Choose a field', 'B2', 'North 40', 'Other (type a name)…']);
    expect(select().value).toBe('');
  });

  it('does not offer an archived field to someone starting from nothing', () => {
    setup();
    expect(optionTexts()).not.toContain('Old Orchard');
  });

  it('gives the field’s name when one is chosen, and nothing when the first choice is chosen again', async () => {
    const { user, onValue } = setup();
    await user.selectOptions(select(), 'North 40');
    expect(onValue).toHaveBeenLastCalledWith('North 40');
    expect(select().value).toBe('North 40');
    await user.selectOptions(select(), '');
    expect(onValue).toHaveBeenLastCalledWith('');
  });

  it('shows the field a record already has, whatever its capital letters or spacing', () => {
    setup({ initial: ' b2 ' });
    expect(select().value).toBe('B2');
    expect(screen.queryByLabelText('Field name')).toBeNull();
  });

  it('keeps an archived field a record already has as a choice, marked as archived', () => {
    setup({ initial: 'Old Orchard' });
    expect(optionTexts()).toEqual(['Choose a field', 'B2', 'North 40', 'Old Orchard (archived)', 'Other (type a name)…']);
    expect(select().value).toBe('Old Orchard');
    expect(screen.queryByLabelText('Field name')).toBeNull();
  });

  it('gives a registered field’s own spelling once it is chosen', async () => {
    const { user, onValue } = setup({ initial: 'b2' });
    await user.selectOptions(select(), 'North 40');
    await user.selectOptions(select(), 'B2');
    expect(onValue).toHaveBeenLastCalledWith('B2');
  });
});

describe('FieldPicker: a name that is not in the list', () => {
  it('asks for the name when "Other" is chosen, emptying the field until it is typed', async () => {
    const { user, onValue } = setup({ initial: 'B2' });
    await user.selectOptions(select(), 'Other (type a name)…');
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(screen.getByLabelText('Field name').value).toBe('');
    expect(select().value).toBe('__other__');
  });

  it('takes what is typed, and says it is not in the list yet', async () => {
    const { user, onValue } = setup();
    await user.selectOptions(select(), 'Other (type a name)…');
    await user.type(screen.getByLabelText('Field name'), 'Back Yard');
    expect(onValue).toHaveBeenLastCalledWith('Back Yard');
    expect(screen.getByText('This name is not in your field list yet.')).toBeTruthy();
  });

  it('does not say so for a name that is in the list, typed with other capital letters', async () => {
    const { user } = setup();
    await user.selectOptions(select(), 'Other (type a name)…');
    await user.type(screen.getByLabelText('Field name'), 'north 40');
    expect(screen.queryByText('This name is not in your field list yet.')).toBeNull();
  });

  it('opens a record whose field is not in the list with that name typed in, and the same hint', () => {
    setup({ initial: 'Back Yard' });
    expect(select().value).toBe('__other__');
    expect(screen.getByLabelText('Field name').value).toBe('Back Yard');
    expect(screen.getByText('This name is not in your field list yet.')).toBeTruthy();
  });

  it('goes back to the list when a field is chosen again, hiding the typed name', async () => {
    const { user, onValue } = setup({ initial: 'Back Yard' });
    await user.selectOptions(select(), 'B2');
    expect(onValue).toHaveBeenLastCalledWith('B2');
    expect(screen.queryByLabelText('Field name')).toBeNull();
  });

  it('keeps "Other" showing while its name is cleared, rather than snapping back to the list', async () => {
    const { user } = setup({ initial: 'Back Yard' });
    await user.clear(screen.getByLabelText('Field name'));
    expect(select().value).toBe('__other__');
    expect(screen.queryByText('This name is not in your field list yet.')).toBeNull();
  });
});

describe('FieldPicker: required and invalid', () => {
  it('marks the box as required, and as invalid with the reason', () => {
    setup({ required: true, invalid: true, invalidText: 'Check this.' });
    expect(select().getAttribute('aria-required')).toBe('true');
    expect(select().getAttribute('aria-invalid')).toBe('true');
    expect(select().getAttribute('aria-describedby')).toBe('rec-field-error');
    expect(screen.getByText('Check this.').id).toBe('rec-field-error');
  });

  it('marks nothing when it is neither', () => {
    setup();
    expect(select().getAttribute('aria-required')).toBeNull();
    expect(select().getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Check this.')).toBeNull();
  });

  it('puts the invalid mark on the typed name when that is what is showing', () => {
    setup({ initial: 'Back Yard', required: true, invalid: true, invalidText: 'Check this.' });
    expect(screen.getByLabelText('Field name').getAttribute('aria-invalid')).toBe('true');
    expect(select().getAttribute('aria-invalid')).toBeNull();
  });
});

describe('FieldPicker: Spanish', () => {
  it('speaks Spanish', async () => {
    const { user } = setup({ label: 'Campo / bloque *', initial: 'Back Yard' }, 'es');
    expect([...screen.getByLabelText(/^Campo \/ bloque/).options].map((o) => o.textContent)).toEqual(['Elige un campo', 'B2', 'North 40', 'Otro (escribe un nombre)…']);
    expect(screen.getByLabelText('Nombre del campo')).toBeTruthy();
    expect(screen.getByText('Este nombre aún no está en tu lista de campos.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(/^Campo \/ bloque/), 'B2');
  });

  it('marks an archived field as archived in Spanish', () => {
    setup({ label: 'Campo / bloque *', initial: 'Old Orchard' }, 'es');
    expect([...screen.getByLabelText(/^Campo \/ bloque/).options].map((o) => o.textContent)).toContain('Old Orchard (archivado)');
  });
});
