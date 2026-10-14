import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable stand-in for a supabase-js query: records every call, resolves to `result` when awaited.
function chain(result) {
  const calls = [];
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      if (prop === 'calls') return calls;
      return (...args) => { calls.push([prop, ...args]); return proxy; };
    },
  });
  return proxy;
}
const from = vi.fn();
vi.mock('./supabase.js', () => ({ supabase: { from: (...a) => from(...a) } }));

const { listFields, createField, updateField, setFieldActive, deleteField, addFieldsByName, describeFieldError, MAX_FIELDS_AT_ONCE } = await import('./fields.js');

const args = (q, name) => q.calls.filter((c) => c[0] === name).map((c) => c.slice(1));

beforeEach(() => {
  from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('describeFieldError', () => {
  it.each([
    [{ code: '42501' }, 'forbidden'],
    [{ code: 'PGRST116' }, 'forbidden'],
    [{ code: '23505' }, 'duplicate'],
    [{ code: '23514', message: 'The field "B2" is used by records and cannot be renamed.' }, 'in_use'],
    [{ code: '23514', message: 'The field "B2" is used by records and cannot be deleted. Archive it instead.' }, 'in_use'],
    [{ code: '23514', message: 'new row violates check constraint "fields_name_check"' }, 'invalid'],
    [{ code: '23514', message: 'A farm can have at most 500 fields.' }, 'too_many'],
    [{ code: 'PGRST205', message: "Could not find the table 'public.fields' in the schema cache" }, 'not_set_up'],
    [{ code: '42P01', message: 'relation "public.fields" does not exist' }, 'not_set_up'],
    [{ code: '08006', message: 'x' }, 'unknown'],
    [null, 'unknown'],
  ])('turns %j into %s', (dbError, code) => {
    expect(describeFieldError(dbError).code).toBe(code);
  });
});

describe('listFields', () => {
  it('lists this farm’s fields, those in use first, then by name', async () => {
    const q = chain({ data: [{ id: 'f1', name: 'B2' }], error: null });
    from.mockReturnValue(q);
    expect(await listFields('farm-1')).toEqual({ data: [{ id: 'f1', name: 'B2' }], error: null });
    expect(from).toHaveBeenCalledWith('fields');
    expect(args(q, 'eq')).toEqual([['farm_id', 'farm-1']]);
    expect(args(q, 'order')).toEqual([['is_active', { ascending: false }], ['name', { ascending: true }]]);
  });

  it('gives an empty list for a farm with none', async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    expect(await listFields('farm-1')).toEqual({ data: [], error: null });
  });

  it('says why it could not', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: '08006', message: 'down' } }));
    expect(await listFields('farm-1')).toEqual({ data: null, error: { code: 'unknown', message: 'down' } });
  });

  it('logs an unexpected failure for the developers, and says nothing about the ones people can fix', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: '08006', message: 'down' } }));
    await listFields('farm-1');
    expect(console.error).toHaveBeenCalledTimes(1);
    console.error.mockClear();
    from.mockReturnValue(chain({ data: null, error: { code: '42501' } }));
    await listFields('farm-1');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('refuses to look without a farm', async () => {
    expect((await listFields('')).error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('createField', () => {
  it('tidies what was typed and inserts only what a client may write', async () => {
    const q = chain({ data: { id: 'f1' }, error: null });
    from.mockReturnValue(q);
    const result = await createField({ farmId: 'farm-1', name: '  North   40 ', area: '2,5', area_unit: 'acre', notes: ' Near the barn ' });
    expect(result).toEqual({ data: { id: 'f1' }, error: null });
    const [row] = args(q, 'insert')[0];
    expect(row).toEqual({ farm_id: 'farm-1', name: 'North 40', area: 2.5, area_unit: 'acre', notes: 'Near the barn' });
    for (const forbidden of ['id', 'created_by', 'is_active', 'created_at']) expect(row).not.toHaveProperty(forbidden);
  });

  it('refuses a field that is not valid, naming what is wrong, without calling the database', async () => {
    const result = await createField({ farmId: 'farm-1', name: '', area: 'x', area_unit: 'acre' });
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: 'invalid', fields: { name: 'required', area: 'invalid' } });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses without a farm', async () => {
    expect((await createField({ name: 'B2' })).error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });

  it('says when a field of that name already exists, and when the person may not add fields', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: '23505' } }));
    expect((await createField({ farmId: 'farm-1', name: 'B2' })).error.code).toBe('duplicate');
    from.mockReturnValue(chain({ data: null, error: { code: '42501' } }));
    expect((await createField({ farmId: 'farm-1', name: 'B2' })).error.code).toBe('forbidden');
  });
});

describe('updateField', () => {
  it('writes the name, area, unit and notes, for that field only', async () => {
    const q = chain({ data: { id: 'f1' }, error: null });
    from.mockReturnValue(q);
    await updateField('f1', { name: ' B2 ', area: 3, area_unit: 'hectare', notes: '' });
    expect(args(q, 'update')[0][0]).toEqual({ name: 'B2', area: 3, area_unit: 'hectare', notes: null });
    expect(args(q, 'eq')).toEqual([['id', 'f1']]);
  });

  it('never sends the farm or the author', async () => {
    const q = chain({ data: {}, error: null });
    from.mockReturnValue(q);
    await updateField('f1', { name: 'B2', farm_id: 'other-farm', created_by: 'someone', is_active: false });
    const [patch] = args(q, 'update')[0];
    expect(Object.keys(patch).sort()).toEqual(['area', 'area_unit', 'name', 'notes']);
  });

  it('refuses an invalid field without calling the database', async () => {
    expect((await updateField('f1', { name: '' })).error).toEqual({ code: 'invalid', fields: { name: 'required' } });
    expect(from).not.toHaveBeenCalled();
  });

  it('says when the name is used by records, so it cannot change', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: '23514', message: 'The field "B2" is used by records and cannot be renamed.' } }));
    expect((await updateField('f1', { name: 'B3' })).error.code).toBe('in_use');
  });

  it('says when nothing was changed because the person may not (row-level security matched nothing)', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: 'PGRST116' } }));
    expect((await updateField('f1', { name: 'B2' })).error.code).toBe('forbidden');
  });
});

describe('setFieldActive', () => {
  it('archives or restores a field', async () => {
    const q = chain({ data: { id: 'f1', is_active: false }, error: null });
    from.mockReturnValue(q);
    await setFieldActive('f1', false);
    expect(args(q, 'update')).toEqual([[{ is_active: false }]]);
    expect(args(q, 'eq')).toEqual([['id', 'f1']]);
    await setFieldActive('f1', true);
    expect(args(q, 'update')[1]).toEqual([{ is_active: true }]);
  });

  it('only accepts true or false', async () => {
    expect((await setFieldActive('f1', 'yes')).error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('deleteField', () => {
  it('deletes, and reports success', async () => {
    const q = chain({ data: [{ id: 'f1' }], error: null });
    from.mockReturnValue(q);
    expect(await deleteField('f1')).toEqual({ data: null, error: null });
    expect(args(q, 'eq')).toEqual([['id', 'f1']]);
  });

  it('says it was forbidden when row-level security deleted nothing', async () => {
    from.mockReturnValue(chain({ data: [], error: null }));
    expect((await deleteField('f1')).error.code).toBe('forbidden');
  });

  it('stops adding, and says why, when the farm has reached its limit', async () => {
    from.mockReset();
    from.mockImplementation(() => chain({ data: null, error: { code: '23514', message: 'A farm can have at most 500 fields.' } }));
    const result = await addFieldsByName('farm-1', ['A', 'B']);
    expect(result.error).toMatchObject({ code: 'too_many', added: 0 });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('says when records use the field, so it can only be archived', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: '23514', message: 'The field "B2" is used by records and cannot be deleted. Archive it instead.' } }));
    expect((await deleteField('f1')).error.code).toBe('in_use');
  });
});

describe('addFieldsByName', () => {
  const inserts = [];
  beforeEach(() => {
    inserts.length = 0;
    from.mockImplementation(() => {
      const q = chain({ data: { id: 'x' }, error: null });
      inserts.push(q);
      return q;
    });
  });
  const rowsInserted = () => inserts.map((q) => args(q, 'insert')[0][0]);

  it('adds each name as a field of this farm, and says how many were added', async () => {
    const result = await addFieldsByName('farm-1', ['A1', ' North   40 ']);
    expect(result).toEqual({ data: { added: 2, skipped: 0, remaining: 0 }, error: null });
    expect(rowsInserted()).toEqual([{ farm_id: 'farm-1', name: 'A1', area: null, area_unit: null, notes: null }, { farm_id: 'farm-1', name: 'North 40', area: null, area_unit: null, notes: null }]);
  });

  it('skips a name that is not a valid field name, or already exists, and carries on with the rest', async () => {
    from.mockReset();
    let call = 0;
    from.mockImplementation(() => chain(++call === 1 ? { data: null, error: { code: '23505' } } : { data: { id: 'x' }, error: null }));
    const result = await addFieldsByName('farm-1', ['Exists', 'x'.repeat(61), 'New']);
    expect(result).toEqual({ data: { added: 1, skipped: 2, remaining: 0 }, error: null });
    expect(from).toHaveBeenCalledTimes(2); // the too-long name never reached the database
  });

  it('skips a name the database itself refuses as not valid, and carries on', async () => {
    from.mockReset();
    let call = 0;
    from.mockImplementation(() => chain(++call === 1 ? { data: null, error: { code: '23514', message: 'violates check constraint "fields_name_check"' } } : { data: { id: 'x' }, error: null }));
    expect((await addFieldsByName('farm-1', ['Odd', 'Fine'])).data).toEqual({ added: 1, skipped: 1, remaining: 0 });
  });

  it('stops and says so when the person may not add fields', async () => {
    from.mockReset();
    from.mockReturnValue(chain({ data: null, error: { code: '42501' } }));
    const result = await addFieldsByName('farm-1', ['A1', 'A2']);
    expect(result.error.code).toBe('forbidden');
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('stops on an unexpected failure, reporting how far it got', async () => {
    from.mockReset();
    let call = 0;
    from.mockImplementation(() => chain(++call === 1 ? { data: { id: 'x' }, error: null } : { data: null, error: { code: '08006', message: 'down' } }));
    const result = await addFieldsByName('farm-1', ['A1', 'A2', 'A3']);
    expect(result.error).toMatchObject({ code: 'unknown', added: 1 });
    expect(from).toHaveBeenCalledTimes(2);
  });

  it(`adds at most ${50} at once`, async () => {
    expect(MAX_FIELDS_AT_ONCE).toBe(50);
    const result = await addFieldsByName('farm-1', Array.from({ length: 80 }, (_, i) => `F${i}`));
    expect(inserts).toHaveLength(50);
    expect(result.data).toEqual({ added: 50, skipped: 0, remaining: 30 }); // so the screen can offer to add the rest
  });

  it('does nothing, and asks nothing, for no names or no farm', async () => {
    expect(await addFieldsByName('farm-1', [])).toEqual({ data: { added: 0, skipped: 0, remaining: 0 }, error: null });
    expect((await addFieldsByName('', ['A1'])).error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });

  it('adds a name once, however many times or ways it is given', async () => {
    const result = await addFieldsByName('farm-1', ['B2', 'b2', ' B2 ']);
    expect(result.data).toEqual({ added: 1, skipped: 2, remaining: 0 });
    expect(inserts).toHaveLength(1);
  });
});
