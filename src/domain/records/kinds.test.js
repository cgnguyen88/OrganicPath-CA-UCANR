import { describe, it, expect } from 'vitest';
import {
  RECORD_KINDS, RECORD_STATUSES, RECORD_SOURCES, OMRI_STATUSES, KIND_FIELDS, KIND_META,
  requiredFieldKeys, optionLabel,
} from './kinds.js';

describe('record vocabulary', () => {
  it('defines the nine kinds the product needs', () => {
    expect([...RECORD_KINDS].sort()).toEqual(
      ['activity', 'amendment', 'harvest', 'input', 'inventory', 'note', 'planting', 'purchase', 'seed'].sort(),
    );
  });

  it('defines the review workflow statuses', () => {
    expect(RECORD_STATUSES).toEqual(['draft', 'needs_info', 'pending_review', 'approved', 'rejected', 'voided']);
  });

  it('has bilingual metadata and a field list for every kind', () => {
    for (const kind of RECORD_KINDS) {
      expect(KIND_META[kind].label.en, kind).toBeTruthy();
      expect(KIND_META[kind].label.es, kind).toBeTruthy();
      expect(KIND_META[kind].plural.en, kind).toBeTruthy();
      expect(KIND_META[kind].plural.es, kind).toBeTruthy();
      expect(KIND_FIELDS[kind].length, kind).toBeGreaterThan(0);
    }
  });

  it('gives every field a unique key and an English and Spanish label', () => {
    for (const kind of RECORD_KINDS) {
      const keys = KIND_FIELDS[kind].map((f) => f.key);
      expect(new Set(keys).size, `${kind} keys`).toBe(keys.length);
      for (const field of KIND_FIELDS[kind]) {
        expect(field.label.en, `${kind}.${field.key}`).toBeTruthy();
        expect(field.label.es, `${kind}.${field.key}`).toBeTruthy();
      }
    }
  });

  it('gives every select field options that each have both languages', () => {
    for (const kind of RECORD_KINDS) {
      for (const field of KIND_FIELDS[kind].filter((f) => f.type === 'select')) {
        expect(field.options.length, `${kind}.${field.key}`).toBeGreaterThan(0);
        for (const option of field.options) {
          expect(option.value).toMatch(/^[a-z_]+$/);
          expect(option.en && option.es, `${kind}.${field.key}.${option.value}`).toBeTruthy();
        }
      }
    }
  });

  it('keeps OMRI status values aligned across kinds', () => {
    expect(OMRI_STATUSES).toEqual(['listed', 'not_listed', 'unknown', 'not_applicable']);
    for (const kind of ['purchase', 'input', 'amendment', 'activity', 'inventory']) {
      const field = KIND_FIELDS[kind].find((f) => f.key === 'omri_status');
      expect(field.options.map((o) => o.value), kind).toEqual(OMRI_STATUSES);
    }
  });

  it('lets a stock count say when to reorder, and whether the item is OMRI listed', () => {
    const fields = Object.fromEntries(KIND_FIELDS.inventory.map((f) => [f.key, f]));
    expect(fields.reorder_level).toMatchObject({ type: 'number', label: { en: 'Reorder level', es: 'Nivel de reposición' } });
    expect(fields.omri_status.type).toBe('select');
    expect(requiredFieldKeys('inventory', {})).toEqual(['item', 'quantity', 'unit']); // a count needs no reorder level or OMRI status
  });

  it('lists the sources the channels will use', () => {
    expect(RECORD_SOURCES).toEqual(['manual', 'web_upload', 'telegram', 'whatsapp', 'email', 'import']);
  });
});

describe('requiredFieldKeys', () => {
  it('returns the unconditionally required fields', () => {
    expect(requiredFieldKeys('harvest', {})).toEqual(['crop', 'field', 'quantity', 'unit']);
    expect(requiredFieldKeys('purchase', {})).toEqual(['supplier', 'product']);
  });

  it('requires product, mix rate and target pest only for a spray (the follow-up questions the agent asks)', () => {
    expect(requiredFieldKeys('activity', { activity_type: 'irrigation' })).toEqual(['activity_type', 'field']);
    expect(requiredFieldKeys('activity', { activity_type: 'spray' })).toEqual(['activity_type', 'field', 'product', 'rate', 'target']);
  });

  it('still asks for the activity type when it is not known yet', () => {
    expect(requiredFieldKeys('activity', {})).toEqual(['activity_type', 'field']);
  });
});

describe('optionLabel', () => {
  it('returns the localized label of an option', () => {
    expect(optionLabel('activity', 'activity_type', 'spray', 'en')).toBe('Spray');
    expect(optionLabel('activity', 'activity_type', 'spray', 'es')).toMatch(/aplicaci/i);
  });

  it('falls back to the raw value for unknown options or fields', () => {
    expect(optionLabel('activity', 'activity_type', 'zzz', 'en')).toBe('zzz');
    expect(optionLabel('activity', 'nope', 'x', 'en')).toBe('x');
  });
});
