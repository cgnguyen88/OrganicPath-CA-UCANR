// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/fields.js', () => ({ addFieldsByName: vi.fn() }));
const { addFieldsByName } = await import('../../lib/fields.js');
const { FarmFieldsContext } = await import('./farmFields.js');
const { default: UnknownFieldHint } = await import('./UnknownFieldHint.jsx');

const B2 = { id: 'f1', name: 'B2', is_active: true };
const OLD = { id: 'f2', name: 'Old Orchard', is_active: false };

const setup = ({ name = 'Back Yard', role = 'owner', fields = [B2], status = 'ready' } = {}, lang = 'en') => {
  const reload = vi.fn();
  const user = userEvent.setup();
  renderWithLang(
    <FarmFieldsContext.Provider value={{ status, fields, reload }}>
      <UnknownFieldHint name={name} farmId="farm-1" role={role} />
    </FarmFieldsContext.Provider>,
    lang,
  );
  return { user, reload };
};
const hint = () => screen.queryByText('“Back Yard” is not in your field list.');

beforeEach(() => {
  addFieldsByName.mockReset();
  addFieldsByName.mockResolvedValue({ data: { added: 1, skipped: 0, remaining: 0 }, error: null });
});
afterEach(cleanup);

describe('UnknownFieldHint: when it shows', () => {
  it('says a field name is not in the farm’s list', () => {
    setup();
    expect(hint()).toBeTruthy();
  });

  it.each([
    ['the list is still loading', { status: 'loading' }],
    ['the list could not be read', { status: 'error', fields: [] }],
    ['the farm has no field list at all (nothing to compare with)', { fields: [] }],
    ['the name is in the list', { name: 'B2' }],
    ['the name is in the list with other capital letters and spacing', { name: ' b2 ' }],
    ['the name is an archived field', { name: 'Old Orchard', fields: [B2, OLD] }],
    ['the name is blank', { name: '   ' }],
    ['the name is not text', { name: 5 }],
  ])('says nothing when %s', (_, props) => {
    setup(props);
    expect(screen.queryByText(/is not in your field list/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('UnknownFieldHint: the name shown', () => {
  it('shows the name without the spaces around it', () => {
    setup({ name: '  Back Yard  ' });
    expect(hint()).toBeTruthy();
  });
});

describe('UnknownFieldHint: adding the name', () => {
  it.each(['owner', 'manager'])('lets a %s add it to the list', async (role) => {
    const { user, reload } = setup({ role });
    await user.click(screen.getByRole('button', { name: 'Add to field list' }));
    expect(addFieldsByName).toHaveBeenCalledWith('farm-1', ['Back Yard']);
    expect((await screen.findByRole('status')).textContent).toBe('Added to your field list.');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not offer crew the button, only the hint', () => {
    setup({ role: 'crew' });
    expect(hint()).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not offer the button for a name that could not be a field name', () => {
    setup({ name: 'x'.repeat(61) });
    expect(screen.getByText(/is not in your field list/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so, and offers it again, when adding fails', async () => {
    addFieldsByName.mockResolvedValueOnce({ data: null, error: { code: 'forbidden' } });
    const { user, reload } = setup();
    await user.click(screen.getByRole('button', { name: 'Add to field list' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only an owner or manager can change fields.');
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add to field list' })).toBeTruthy();
  });

  it('counts a name someone else added a moment ago as added: it is in the list now', async () => {
    // The data layer reports a name that already exists as "skipped"; the button is only offered for valid names.
    addFieldsByName.mockResolvedValueOnce({ data: { added: 0, skipped: 1, remaining: 0 }, error: null });
    const { user, reload } = setup();
    await user.click(screen.getByRole('button', { name: 'Add to field list' }));
    expect((await screen.findByRole('status')).textContent).toBe('Added to your field list.');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed twice while adding', async () => {
    let finish;
    addFieldsByName.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add to field list' }));
    expect(screen.getByRole('button', { name: 'Add to field list' }).disabled).toBe(true);
    finish({ data: { added: 1, skipped: 0, remaining: 0 }, error: null });
    await screen.findByRole('status');
    expect(addFieldsByName).toHaveBeenCalledTimes(1);
  });

  it('speaks Spanish', () => {
    setup({}, 'es');
    expect(screen.getByText('“Back Yard” no está en tu lista de campos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agregar a la lista de campos' })).toBeTruthy();
  });
});
