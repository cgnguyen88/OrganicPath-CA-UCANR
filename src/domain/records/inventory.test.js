import { describe, it, expect } from 'vitest';
import { summarizeInventory, isLowStock, lowStockRows } from './inventory.js';
import { needsOmriAttention, summarizeMaterials } from './materials.js';

let n = 0;
const count = (date, payload, extra = {}) => ({
  id: `c${++n}`, kind: 'inventory', status: 'approved', record_date: date, created_at: `2026-01-01T10:00:${String(n % 60).padStart(2, '0')}Z`,
  payload: { item: 'Compost', quantity: 10, unit: 'bags', ...payload }, ...extra,
});
const purchase = (product, omri, extra = {}) => ({ id: `p${++n}`, kind: 'purchase', status: 'approved', record_date: '2026-03-01', payload: { product, supplier: 'Acme', omri_status: omri, ...extra } });
const only = (rows) => { expect(rows).toHaveLength(1); return rows[0]; };

describe('summarizeInventory: what is in stock now', () => {
  it('has one row per item, with the quantity of its latest count', () => {
    const row = only(summarizeInventory([count('2026-03-01', { quantity: 10 }), count('2026-05-01', { quantity: 4 }), count('2026-04-01', { quantity: 7 })]));
    expect(row).toMatchObject({ item: 'Compost', unit: 'bags', quantity: 4, lastCounted: '2026-05-01' });
  });

  it('takes the later-entered count when two are dated the same day', () => {
    const a = count('2026-05-01', { quantity: 9 }, { created_at: '2026-05-01T08:00:00Z' });
    const b = count('2026-05-01', { quantity: 6 }, { created_at: '2026-05-01T17:00:00Z' });
    expect(only(summarizeInventory([b, a])).quantity).toBe(6);
    expect(only(summarizeInventory([a, b])).quantity).toBe(6);
  });

  it('treats a count with no date as the oldest', () => {
    expect(only(summarizeInventory([count(null, { quantity: 99 }), count('2026-02-01', { quantity: 5 })])).quantity).toBe(5);
    expect(only(summarizeInventory([count(null, { quantity: 99 })]))).toMatchObject({ quantity: 99, lastCounted: null });
  });

  it('counts "Compost", "compost " and "COMPOST" as one item, and "bags" and "Bags." as one unit', () => {
    const row = only(summarizeInventory([count('2026-01-01', { item: 'Compost', unit: 'bags' }), count('2026-02-01', { item: ' compost ', unit: 'Bags.', quantity: 3 }), count('2026-03-01', { item: 'COMPOST', quantity: 8 })]));
    expect(row.quantity).toBe(8);
  });

  it('keeps an item counted in two different units as two rows rather than adding bags to yards', () => {
    const rows = summarizeInventory([count('2026-05-01', { unit: 'bags', quantity: 4 }), count('2026-05-01', { unit: 'yd', quantity: 2 })]);
    expect(rows.map((r) => [r.unit, r.quantity]).sort()).toEqual([['bags', 4], ['yd', 2]]);
  });

  it('uses only approved counts: not drafts, pending, rejected or voided ones, and not other kinds of record', () => {
    const rows = summarizeInventory([
      count('2026-01-01', { quantity: 1 }),
      ...['draft', 'needs_info', 'pending_review', 'rejected', 'voided'].map((status) => count('2026-09-01', { quantity: 100 }, { status })),
      { ...count('2026-09-01', { quantity: 100 }), kind: 'purchase' },
    ]);
    expect(only(rows).quantity).toBe(1);
  });

  it('gives nothing for no counts', () => {
    expect(summarizeInventory([])).toEqual([]);
  });

  it('skips a count with no item, or whose quantity is not a number', () => {
    expect(summarizeInventory([count('2026-01-01', { item: '  ' }), count('2026-01-01', { item: undefined }), count('2026-01-01', { quantity: 'lots' }), count('2026-01-01', { quantity: undefined })])).toEqual([]);
  });

  it('does not count a negative or blank quantity as a count, and ignores a negative or blank reorder level', () => {
    expect(summarizeInventory([count('2026-01-01', { quantity: -3 }), count('2026-01-01', { quantity: '   ' })])).toEqual([]);
    expect(only(summarizeInventory([count('2026-01-01', { quantity: 5, reorder_level: -1 })])).reorderLevel).toBeNull();
    expect(only(summarizeInventory([count('2026-01-01', { quantity: 5, reorder_level: '  ' })])).reorderLevel).toBeNull();
  });

  it('reads a quantity the database sent as text', () => {
    expect(only(summarizeInventory([count('2026-01-01', { quantity: '12.5' })])).quantity).toBe(12.5);
  });

  it('keeps the latest count’s place and lot, tidied', () => {
    const row = only(summarizeInventory([count('2026-01-01', { location: 'Barn', lot_number: 'A1' }), count('2026-02-01', { location: '  Shed\n2 ', lot_number: 'B7' })]));
    expect(row).toMatchObject({ location: 'Shed 2', lotNumber: 'B7' });
  });

  it('keeps the place through later counts that do not repeat it, but not the lot, which belongs to one delivery', () => {
    const row = only(summarizeInventory([count('2026-01-01', { location: 'Barn', lot_number: 'A1' }), count('2026-02-01', {})]));
    expect(row).toMatchObject({ location: 'Barn', lotNumber: '' });
  });

  it('keeps the name the latest count spelled the item with', () => {
    expect(only(summarizeInventory([count('2026-01-01', { item: 'compost' }), count('2026-02-01', { item: 'Compost' })])).item).toBe('Compost');
  });
});

describe('summarizeInventory: when to reorder', () => {
  const status = (quantity, reorder_level) => only(summarizeInventory([count('2026-05-01', { quantity, reorder_level })])).status;

  it('is OK above the reorder level, low at it and below it, and out at zero', () => {
    expect(status(11, 10)).toBe('ok');
    expect(status(10, 10)).toBe('low');
    expect(status(3, 10)).toBe('low');
    expect(status(0, 10)).toBe('out');
  });

  it('has no verdict without a reorder level, except that nothing is left', () => {
    expect(status(3, undefined)).toBe('no_level');
    expect(status(0, undefined)).toBe('out');
  });

  it('counts a reorder level of zero as a level (low only at zero, which is out)', () => {
    expect(status(1, 0)).toBe('ok');
    expect(status(0, 0)).toBe('out');
  });

  it('keeps the latest reorder level that was set, through later counts that do not repeat it', () => {
    const row = only(summarizeInventory([count('2026-01-01', { quantity: 20, reorder_level: 8 }), count('2026-03-01', { quantity: 9 }), count('2026-05-01', { quantity: 7 })]));
    expect(row).toMatchObject({ reorderLevel: 8, status: 'low' });
  });

  it('uses a newer reorder level over an older one', () => {
    const row = only(summarizeInventory([count('2026-01-01', { quantity: 20, reorder_level: 8 }), count('2026-05-01', { quantity: 7, reorder_level: 5 })]));
    expect(row).toMatchObject({ reorderLevel: 5, status: 'ok' });
  });

  it('ignores a reorder level that is not a number', () => {
    expect(only(summarizeInventory([count('2026-05-01', { reorder_level: 'soon' })]))).toMatchObject({ reorderLevel: null, status: 'no_level' });
  });

  it('says which rows are low', () => {
    const rows = summarizeInventory([count('2026-05-01', { item: 'A', quantity: 1, reorder_level: 5 }), count('2026-05-01', { item: 'B', quantity: 9, reorder_level: 5 }), count('2026-05-01', { item: 'C', quantity: 0 }), count('2026-05-01', { item: 'D', quantity: 2 })]);
    expect(lowStockRows(rows).map((r) => r.item)).toEqual(['C', 'A']);
    expect(rows.filter(isLowStock).map((r) => r.item).sort()).toEqual(['A', 'C']);
    expect(isLowStock({ status: 'ok' })).toBe(false);
    expect(isLowStock({ status: 'no_level' })).toBe(false);
  });
});

describe('summarizeInventory: OMRI', () => {
  it('uses what the counts say', () => {
    expect(only(summarizeInventory([count('2026-05-01', { omri_status: 'listed' })]))).toMatchObject({ omriStatus: 'listed', omriSource: 'count' });
  });

  it('keeps the latest status that was set through later counts that do not repeat it', () => {
    const row = only(summarizeInventory([count('2026-01-01', { omri_status: 'not_listed' }), count('2026-05-01', {})]));
    expect(row).toMatchObject({ omriStatus: 'not_listed', omriSource: 'count' });
  });

  it('uses the materials the farm bought, by name, when the counts do not say', () => {
    const materials = summarizeMaterials([purchase('compost', 'listed')]);
    expect(only(summarizeInventory([count('2026-05-01', {})], materials))).toMatchObject({ omriStatus: 'listed', omriSource: 'records' });
  });

  it('prefers the counts over the materials', () => {
    const materials = summarizeMaterials([purchase('Compost', 'listed')]);
    expect(only(summarizeInventory([count('2026-05-01', { omri_status: 'not_listed' })], materials))).toMatchObject({ omriStatus: 'not_listed', omriSource: 'count' });
  });

  it('is unknown when nothing says, and an "unknown" in the purchase records does not count as knowing', () => {
    expect(only(summarizeInventory([count('2026-05-01', {})]))).toMatchObject({ omriStatus: 'unknown', omriSource: 'none' });
    const materials = summarizeMaterials([purchase('Compost', 'unknown')]);
    expect(only(summarizeInventory([count('2026-05-01', {})], materials))).toMatchObject({ omriStatus: 'unknown', omriSource: 'none' });
  });

  it('lets the newest count say "unknown", even over an older count that said listed, or the purchase records', () => {
    expect(only(summarizeInventory([count('2026-01-01', { omri_status: 'listed' }), count('2026-05-01', { omri_status: 'unknown' })]))).toMatchObject({ omriStatus: 'unknown', omriSource: 'count' });
    const materials = summarizeMaterials([purchase('Compost', 'listed')]);
    expect(only(summarizeInventory([count('2026-05-01', { omri_status: 'unknown' })], materials))).toMatchObject({ omriStatus: 'unknown', omriSource: 'count' });
  });

  it('says when the purchase records disagree about the item, so it gets an OMRI check', () => {
    const materials = summarizeMaterials([purchase('Compost', 'listed'), { ...purchase('Compost', 'not_listed'), record_date: '2026-04-01' }]);
    const row = only(summarizeInventory([count('2026-05-01', {})], materials));
    expect(row.statusConflict).toBe(true);
    expect(needsOmriAttention(row)).toBe(true);
  });

  it('does not report a disagreement among the purchase records when a count settles the status', () => {
    const materials = summarizeMaterials([purchase('Compost', 'listed'), { ...purchase('Compost', 'not_listed'), record_date: '2026-04-01' }]);
    const row = only(summarizeInventory([count('2026-05-01', { omri_status: 'listed' })], materials));
    expect(row.statusConflict).toBe(false);
    expect(needsOmriAttention(row)).toBe(false);
  });
});

describe('summarizeInventory: order and what an update starts from', () => {
  it('lists what is out first, then what is low, then everything else by name', () => {
    const rows = summarizeInventory([
      count('2026-05-01', { item: 'Zinc', quantity: 9, reorder_level: 2 }),
      count('2026-05-01', { item: 'Alfalfa', quantity: 9, reorder_level: 2 }),
      count('2026-05-01', { item: 'Kelp', quantity: 1, reorder_level: 2 }),
      count('2026-05-01', { item: 'Neem', quantity: 0, reorder_level: 2 }),
      count('2026-05-01', { item: 'Bone meal', quantity: 5 }),
    ]);
    expect(rows.map((r) => r.item)).toEqual(['Neem', 'Kelp', 'Alfalfa', 'Bone meal', 'Zinc']);
  });

  it('gives what a new count of the item starts from: its details, but not the quantity', () => {
    const row = only(summarizeInventory([count('2026-05-01', { quantity: 4, reorder_level: 5, omri_status: 'listed', location: 'Barn', lot_number: 'L1', notes: 'wet' })]));
    expect(row.startingValues).toEqual({ item: 'Compost', unit: 'bags', reorder_level: '5', omri_status: 'listed', location: 'Barn', lot_number: 'L1' });
  });

  it('starts a new count from the OMRI status a count gave, not one worked out from the purchase records', () => {
    const materials = summarizeMaterials([purchase('Compost', 'listed')]);
    const row = only(summarizeInventory([count('2026-05-01', {})], materials));
    expect(row.omriStatus).toBe('listed');
    expect(row.startingValues).not.toHaveProperty('omri_status');
  });

  it('leaves out of a new count what is not known', () => {
    expect(only(summarizeInventory([count('2026-05-01', {})])).startingValues).toEqual({ item: 'Compost', unit: 'bags' });
  });
});
