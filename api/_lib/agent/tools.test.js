import { describe, it, expect } from 'vitest';
import { RECORD_KINDS, KIND_FIELDS } from '../../../src/domain/records/kinds.js';
import { buildRecordTools, toolNameForKind, kindForToolName, KIND_GUIDANCE } from './tools.js';

const tools = buildRecordTools();
const byKind = Object.fromEntries(tools.map((t) => [kindForToolName(t.name), t]));

describe('the inventory tool', () => {
  it('can carry a reorder level and an OMRI status, and the guidance says to fill them only when stated or visible', () => {
    const properties = byKind.inventory.input_schema.properties.payload.properties;
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(['item', 'quantity', 'unit', 'reorder_level', 'omri_status']));
    expect(KIND_GUIDANCE.inventory).toMatch(/reorder level only if (it is )?stated/i);
    expect(KIND_GUIDANCE.inventory).toMatch(/OMRI.*only.*(seal|listing).*visible|visible.*OMRI/i);
  });
});

describe('buildRecordTools', () => {
  it('has exactly one tool per record kind, and no other tool (the agent can only PROPOSE records)', () => {
    expect(tools).toHaveLength(RECORD_KINDS.length);
    expect(tools.map((t) => kindForToolName(t.name)).sort()).toEqual([...RECORD_KINDS].sort());
  });

  it('names tools record_<kind> and maps names back, rejecting anything else', () => {
    expect(toolNameForKind('harvest')).toBe('record_harvest');
    expect(kindForToolName('record_harvest')).toBe('harvest');
    for (const bad of ['record_bogus', 'harvest', 'record_', 'delete_record', 'approve_record', '', null, undefined, 'record_harvest ']) {
      expect(kindForToolName(bad), String(bad)).toBeNull();
    }
  });

  it.each(RECORD_KINDS)('describes %s with a schema generated from the domain fields (so the form, database and agent cannot drift)', (kind) => {
    const schema = byKind[kind].input_schema;
    const fieldKeys = KIND_FIELDS[kind].map((f) => f.key);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties.payload.properties).sort()).toEqual([...fieldKeys].sort());
    expect(Object.keys(schema.properties).sort()).toEqual(['confidence', 'payload', 'record_date']);
  });

  it('requires every property, and lets optional ones be null so the model must say "not present" instead of guessing', () => {
    for (const kind of RECORD_KINDS) {
      const schema = byKind[kind].input_schema;
      expect(schema.required.sort(), kind).toEqual(['confidence', 'payload', 'record_date']);
      const payload = schema.properties.payload;
      expect(payload.additionalProperties).toBe(false);
      expect(payload.required.sort(), kind).toEqual(KIND_FIELDS[kind].map((f) => f.key).sort());
      for (const field of KIND_FIELDS[kind]) {
        const prop = payload.properties[field.key];
        const nullable = prop.type ? prop.type.includes('null') : prop.anyOf.some((branch) => branch.type === 'null');
        expect(nullable, `${kind}.${field.key}`).toBe(true);
      }
      expect(schema.properties.record_date.type).toEqual(['string', 'null']);
    }
  });

  it('types numbers as numbers and restricts selects to their real options (plus null)', () => {
    const harvest = byKind.harvest.input_schema.properties.payload.properties;
    expect(harvest.quantity.type).toEqual(['number', 'null']);
    expect(harvest.crop.type).toEqual(['string', 'null']);

    const activityType = byKind.activity.input_schema.properties.payload.properties.activity_type;
    // The live API rejects `type: [string, null]` combined with `enum`; a nullable select is anyOf.
    expect(activityType.anyOf).toEqual([{ type: 'string', enum: ['spray', 'irrigation', 'cultivation', 'scouting', 'pruning', 'mowing', 'other'] }, { type: 'null' }]);
    expect(activityType).not.toHaveProperty('enum');

    const omri = byKind.purchase.input_schema.properties.payload.properties.omri_status;
    expect(omri.anyOf[0].enum).toEqual(['listed', 'not_listed', 'unknown', 'not_applicable']);
  });

  it('bounds confidence between 0 and 1 in its description', () => {
    expect(byKind.note.input_schema.properties.confidence.type).toBe('number');
    expect(byKind.note.input_schema.properties.confidence.description).toMatch(/0.*1/);
  });

  it('describes each field in English and Spanish so a Spanish document maps to the right field', () => {
    const product = byKind.activity.input_schema.properties.payload.properties.product;
    expect(product.description).toMatch(/Product/);
    expect(product.description).toMatch(/Producto/);
  });

  it('explains when to use each tool, including that a spray is an activity and a fertilizer application is an amendment', () => {
    expect(byKind.activity.description).toMatch(/spray/i);
    expect(byKind.amendment.description).toMatch(/fertilizer|compost/i);
    expect(byKind.purchase.description).toMatch(/invoice|receipt/i);
    for (const t of tools) expect(t.description.length).toBeGreaterThan(30);
  });

  it('marks tools strict so the API validates the arguments', () => {
    for (const t of tools) expect(t.strict).toBe(true);
  });

  it('can be built without strict mode (a switch for API compatibility)', () => {
    for (const t of buildRecordTools({ strict: false })) expect(t).not.toHaveProperty('strict');
  });

  it('returns fresh objects each time (callers can not mutate shared state)', () => {
    const a = buildRecordTools();
    a[0].name = 'tampered';
    expect(buildRecordTools()[0].name).not.toBe('tampered');
  });
});
