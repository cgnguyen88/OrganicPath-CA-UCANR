import { describe, it, expect } from 'vitest';
import { KIND_FIELDS } from './kinds.js';
import { canManageFields, FIELD_KINDS, FIELD_NAME_MAX, tidyFieldName, validateFieldInput, fieldKey, findField, summarizeFields, unregisteredFieldNames } from './fields.js';

let n = 0;
const rec = (kind, record_date, payload, extra = {}) => ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, ...extra });
const field = (name, extra = {}) => ({ id: `f-${name}`, name, area: null, area_unit: null, notes: null, is_active: true, ...extra });

describe('FIELD_KINDS', () => {
  it('are the kinds of record that have a field', () => {
    expect([...FIELD_KINDS].sort()).toEqual(Object.entries(KIND_FIELDS).filter(([, fields]) => fields.some((f) => f.key === 'field')).map(([kind]) => kind).sort());
    expect([...FIELD_KINDS].sort()).toEqual(['activity', 'amendment', 'harvest', 'planting']);
  });
});

describe('canManageFields', () => {
  it('lets owners and managers change the field list, as the database does', () => {
    expect(canManageFields('owner')).toBe(true);
    expect(canManageFields('manager')).toBe(true);
  });

  it('does not let crew, or anyone not on the farm, change it', () => {
    for (const role of ['crew', 'viewer', 'admin', 'OWNER', '', null, undefined]) expect(canManageFields(role), String(role)).toBe(false);
  });
});

describe('tidyFieldName', () => {
  it('trims, and makes any run of spaces one space', () => {
    expect(tidyFieldName('  North   40  ')).toBe('North 40');
    expect(tidyFieldName('North\t\n40')).toBe('North 40');
  });

  it('removes control characters and the ones that reverse text', () => {
    expect(tidyFieldName('No\u0007rth\u202e 40')).toBe('North 40');
  });

  it('removes zero-width and direction-mark characters, so two names that look alike are one', () => {
    expect(tidyFieldName('Z\u200b9')).toBe('Z9');
    expect(tidyFieldName('Nor\u200eth\u200f 40\u2060')).toBe('North 40');
    expect(fieldKey('Z\u200b9')).toBe(fieldKey('Z9'));
  });

  it('makes every kind of space, even a non-breaking or ideographic one, a plain space', () => {
    expect(tidyFieldName('North\u00a0\u300040\ufeff')).toBe('North 40');
  });

  it('keeps accents and other scripts', () => {
    expect(tidyFieldName('Campo Año Nuevo')).toBe('Campo Año Nuevo');
    expect(tidyFieldName('北の畑')).toBe('北の畑');
  });

  it('copes with nothing, and with what is not text', () => {
    expect(tidyFieldName(undefined)).toBe('');
    expect(tidyFieldName(null)).toBe('');
    expect(tidyFieldName(5)).toBe('5');
  });
});

describe('validateFieldInput', () => {
  it('accepts a name alone', () => {
    expect(validateFieldInput({ name: 'B2' })).toEqual({ ok: true, errors: {}, value: { name: 'B2', area: null, area_unit: null, notes: null } });
  });

  it('tidies the name, and writes the area, unit and notes the way the database wants them', () => {
    const result = validateFieldInput({ name: '  North   40 ', area: '2,5', area_unit: 'hectare', notes: '  Near the barn  ' });
    expect(result).toEqual({ ok: true, errors: {}, value: { name: 'North 40', area: 2.5, area_unit: 'hectare', notes: 'Near the barn' } });
  });

  it('needs a name', () => {
    for (const name of ['', '   ', undefined, null, '\u0007']) expect(validateFieldInput({ name }).errors.name, String(name)).toBe('required');
  });

  it(`allows a name of ${FIELD_NAME_MAX} characters and refuses one longer`, () => {
    expect(validateFieldInput({ name: 'x'.repeat(FIELD_NAME_MAX) }).ok).toBe(true);
    expect(validateFieldInput({ name: 'x'.repeat(FIELD_NAME_MAX + 1) }).errors.name).toBe('too_long');
  });

  it('keeps to the limits the database has: 60 characters for a name, counting an emoji as one', () => {
    expect(FIELD_NAME_MAX).toBe(60);
    expect(validateFieldInput({ name: '😀'.repeat(60) }).ok).toBe(true);
    expect(validateFieldInput({ name: '😀'.repeat(61) }).errors.name).toBe('too_long');
    expect(validateFieldInput({ name: 'x'.repeat(60) }).ok).toBe(true);
    expect(validateFieldInput({ name: 'x'.repeat(61) }).errors.name).toBe('too_long');
  });

  it('measures the name after tidying, not before', () => {
    expect(validateFieldInput({ name: `${' '.repeat(50)}${'x'.repeat(60)}${' '.repeat(50)}` }).ok).toBe(true);
  });

  it.each([['2', 2], ['0', 0], ['12.345', 12.345], ['1,5', 1.5], ['1,000', 1000], ['12,345.5', 12345.5], [3, 3], [0.0004, 0], ['999999.999', 999999.999]])('reads an area of %j as %j', (typed, expected) => {
    expect(validateFieldInput({ name: 'A', area: typed, area_unit: 'acre' }).value.area).toBe(expected);
  });

  it.each([['abc'], ['-1'], ['1e3'], ['0x10'], ['1000001'], [NaN], [Infinity], ['1.2.3']])('refuses an area of %j', (typed) => {
    expect(validateFieldInput({ name: 'A', area: typed, area_unit: 'acre' }).errors.area).toBe('invalid');
  });

  it('refuses an area that is neither text nor a number, without failing', () => {
    for (const odd of [{}, [], [5], true, () => 1]) expect(validateFieldInput({ name: 'A', area: odd, area_unit: 'acre' }).errors.area, String(odd)).toBe('invalid');
  });

  it('refuses a number that is below zero or above the limit, as a number and as text', () => {
    expect(validateFieldInput({ name: 'A', area: -1, area_unit: 'acre' }).errors.area).toBe('invalid');
    expect(validateFieldInput({ name: 'A', area: -0.0001, area_unit: 'acre' }).value?.area ?? 'refused').not.toBe(-0.0001);
    expect(validateFieldInput({ name: 'A', area: 1000000, area_unit: 'acre' }).ok).toBe(true);
    expect(validateFieldInput({ name: 'A', area: 1000000.001, area_unit: 'acre' }).errors.area).toBe('invalid');
  });

  it('keeps notes to the 1000 characters the database allows, counting an emoji as one', () => {
    expect(validateFieldInput({ name: 'A', notes: '😀'.repeat(1000) }).ok).toBe(true);
    expect(validateFieldInput({ name: 'A', notes: '😀'.repeat(1001) }).errors.notes).toBe('too_long');
  });

  it('treats a blank area as no area', () => {
    for (const area of ['', '  ', undefined, null]) expect(validateFieldInput({ name: 'A', area, area_unit: 'acre' }).value).toMatchObject({ area: null, area_unit: null });
  });

  it('needs a unit for an area, and refuses a unit it does not know', () => {
    expect(validateFieldInput({ name: 'A', area: 2 }).errors.area_unit).toBe('required');
    expect(validateFieldInput({ name: 'A', area: 2, area_unit: '' }).errors.area_unit).toBe('required');
    expect(validateFieldInput({ name: 'A', area: 2, area_unit: 'furlong' }).errors.area_unit).toBe('invalid');
  });

  it('knows the three units', () => {
    for (const unit of ['acre', 'hectare', 'sq_ft']) expect(validateFieldInput({ name: 'A', area: 1, area_unit: unit }).ok).toBe(true);
  });

  it('forgets a unit that has no area to go with it', () => {
    expect(validateFieldInput({ name: 'A', area_unit: 'acre' }).value.area_unit).toBeNull();
    expect(validateFieldInput({ name: 'A', area: '', area_unit: 'furlong' }).ok).toBe(true);
  });

  it('keeps notes to 1000 characters, and drops blank ones', () => {
    expect(validateFieldInput({ name: 'A', notes: 'n'.repeat(1000) }).ok).toBe(true);
    expect(validateFieldInput({ name: 'A', notes: 'n'.repeat(1001) }).errors.notes).toBe('too_long');
    expect(validateFieldInput({ name: 'A', notes: '   ' }).value.notes).toBeNull();
  });

  it('keeps line breaks in notes but removes control characters', () => {
    expect(validateFieldInput({ name: 'A', notes: 'one\ntwo\u0007' }).value.notes).toBe('one\ntwo');
  });

  it('reports every problem at once, and gives no value when there is one', () => {
    const result = validateFieldInput({ name: '', area: 'x', area_unit: 'acre', notes: 'n'.repeat(1001) });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ name: 'required', area: 'invalid', notes: 'too_long' });
    expect(result.value).toBeNull();
  });

  it('copes with nothing at all', () => {
    expect(validateFieldInput(undefined).errors.name).toBe('required');
    expect(validateFieldInput({}).ok).toBe(false);
  });
});

describe('fieldKey and findField', () => {
  it('match a name ignoring capital letters, spacing and the edges', () => {
    expect(fieldKey('  North   40 ')).toBe('north 40');
    expect(fieldKey('B2')).toBe(fieldKey('b2'));
  });

  it('keeps names apart when they really differ', () => {
    expect(fieldKey('B2')).not.toBe(fieldKey('B-2'));
    expect(fieldKey('Año')).not.toBe(fieldKey('Ano'));
  });

  it('is empty for nothing', () => {
    expect(fieldKey(undefined)).toBe('');
    expect(fieldKey(null)).toBe('');
  });

  it('finds the field a record’s text names, however it is written', () => {
    const fields = [field('B2'), field('North 40')];
    expect(findField('b2', fields)).toBe(fields[0]);
    expect(findField(' north  40', fields)).toBe(fields[1]);
    expect(findField('C9', fields)).toBeNull();
    expect(findField('', fields)).toBeNull();
    expect(findField(undefined, fields)).toBeNull();
  });
});

describe('summarizeFields', () => {
  const fields = [field('B2'), field('A1'), field('Old', { is_active: false })];
  const records = [
    rec('planting', '2026-03-01', { crop: 'Tomato', field: 'B2' }),
    rec('amendment', '2026-04-02', { material: 'Compost', field: 'b2' }),
    rec('activity', '2026-05-01', { activity_type: 'spray', field: 'B2', product: 'Neem oil' }),
    rec('activity', '2026-05-15', { activity_type: 'irrigation', field: 'B2' }),
    rec('harvest', '2026-08-01', { crop: 'Tomato', field: 'B2', quantity: 40, unit: 'lb' }),
    rec('harvest', '2026-09-01', { crop: 'Pepper', field: 'B2', quantity: 10, unit: 'lb' }),
    rec('planting', '2026-03-05', { crop: 'Kale', field: 'A1' }),
    rec('note', '2026-03-05', { text: 'about B2' }),
  ];

  it('gives one row per field, in the order the fields are given', () => {
    expect(summarizeFields(fields, records).map((row) => row.field.name)).toEqual(['B2', 'A1', 'Old']);
  });

  it('counts what happened in each field: plantings, applications (amendments and sprays) and harvests', () => {
    const [b2, a1, old] = summarizeFields(fields, records);
    expect(b2).toMatchObject({ plantings: 1, applications: 2, harvests: 2, uses: 6 });
    expect(a1).toMatchObject({ plantings: 1, applications: 0, harvests: 0, uses: 1 });
    expect(old).toMatchObject({ plantings: 0, applications: 0, harvests: 0, uses: 0 });
  });

  it('counts other work in a field (irrigation) among its uses, but not as an application', () => {
    const [b2] = summarizeFields(fields, records);
    expect(b2.uses).toBe(6);
    expect(b2.applications).toBe(2);
  });

  it('gives the dates of the last application and the last harvest, and the first and last time it was used', () => {
    const [b2, , old] = summarizeFields(fields, records);
    expect(b2).toMatchObject({ lastApplication: '2026-05-01', lastHarvest: '2026-09-01', firstUsed: '2026-03-01', lastUsed: '2026-09-01' });
    expect(old).toMatchObject({ lastApplication: null, lastHarvest: null, firstUsed: null, lastUsed: null });
  });

  it('lists the crops grown, each once, in the order they were first seen', () => {
    const [b2, a1] = summarizeFields(fields, records);
    expect(b2.crops).toEqual(['Tomato', 'Pepper']);
    expect(a1.crops).toEqual(['Kale']);
  });

  it('gives the records of the field, newest first', () => {
    const [b2] = summarizeFields(fields, records);
    expect(b2.records.map((r) => r.record_date)).toEqual(['2026-09-01', '2026-08-01', '2026-05-15', '2026-05-01', '2026-04-02', '2026-03-01']);
  });

  it('counts only approved records', () => {
    const [b2] = summarizeFields([field('B2')], [rec('harvest', '2026-08-01', { crop: 'Tomato', field: 'B2' }), rec('harvest', '2026-08-02', { crop: 'Tomato', field: 'B2' }, { status: 'draft' }), rec('harvest', '2026-08-03', { crop: 'Tomato', field: 'B2' }, { status: 'voided' })]);
    expect(b2.harvests).toBe(1);
  });

  it('copes with records that have no field, no date, or a field that is not text', () => {
    const [b2] = summarizeFields([field('B2')], [rec('harvest', null, { crop: 'Tomato', field: 'B2' }), rec('harvest', '2026-08-01', { crop: 'Tomato' }), rec('harvest', '2026-08-01', { crop: 'Tomato', field: 5 })]);
    expect(b2).toMatchObject({ harvests: 1, lastHarvest: null, firstUsed: null });
  });

  it('puts a record with no date after the dated ones, and ignores a field on a kind of record that has none', () => {
    const [b2] = summarizeFields([field('B2')], [
      rec('harvest', null, { crop: 'Tomato', field: 'B2' }),
      rec('harvest', '2026-08-01', { crop: 'Tomato', field: 'B2' }),
      rec('note', '2026-08-02', { text: 'x', field: 'B2' }),
      rec('activity', '2026-08-03', { activity_type: 'scouting', field: 'B2', crop: 'Weed' }),
    ]);
    expect(b2.records.map((r) => r.record_date)).toEqual(['2026-08-03', '2026-08-01', null]);
    expect(b2.uses).toBe(3);
    expect(b2.crops).toEqual(['Tomato']);
  });

  it('does not change what it is given', () => {
    const frozenFields = Object.freeze(fields.map((f) => Object.freeze({ ...f })));
    const frozenRecords = Object.freeze(records.map((r) => Object.freeze(r)));
    expect(() => summarizeFields(frozenFields, frozenRecords)).not.toThrow();
  });
});

describe('unregisteredFieldNames', () => {
  const fields = [field('B2')];

  it('lists the field names in records that are not in the field list, most used first, with the most used spelling', () => {
    const records = [
      rec('harvest', '2026-08-01', { field: 'A1' }), rec('harvest', '2026-08-02', { field: 'a1' }), rec('harvest', '2026-08-03', { field: 'A1' }),
      rec('planting', '2026-03-01', { field: 'North 40' }),
      rec('planting', '2026-03-01', { field: 'B2' }),
    ];
    expect(unregisteredFieldNames(records, fields)).toEqual([{ name: 'A1', uses: 3 }, { name: 'North 40', uses: 1 }]);
  });

  it('does not list a name that differs from a field only by capital letters or spacing', () => {
    expect(unregisteredFieldNames([rec('harvest', '2026-08-01', { field: ' b2 ' })], fields)).toEqual([]);
  });

  it('counts only approved records, and skips empty names and names that are not text', () => {
    const records = [rec('harvest', '2026-08-01', { field: 'C3' }, { status: 'draft' }), rec('harvest', '2026-08-01', { field: '' }), rec('harvest', '2026-08-01', { field: 7 }), rec('harvest', '2026-08-01', {})];
    expect(unregisteredFieldNames(records, fields)).toEqual([]);
  });

  it('looks only at the kinds of record that name a field', () => {
    expect(unregisteredFieldNames([rec('purchase', '2026-08-01', { field: 'Elsewhere' }), rec('note', '2026-08-01', { field: 'Elsewhere' })], fields)).toEqual([]);
  });

  it('skips names the database would refuse as a field name', () => {
    expect(unregisteredFieldNames([rec('harvest', '2026-08-01', { field: 'x'.repeat(FIELD_NAME_MAX + 1) })], fields)).toEqual([]);
  });

  it('is empty when there are no records, and lists everything when there are no fields', () => {
    expect(unregisteredFieldNames([], fields)).toEqual([]);
    expect(unregisteredFieldNames([rec('harvest', '2026-08-01', { field: 'A1' })], [])).toEqual([{ name: 'A1', uses: 1 }]);
  });
});
