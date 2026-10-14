import { describe, it, expect } from 'vitest';
import { operationContext } from './operationContext.js';

describe('operationContext', () => {
  it('keeps only the four operation fields that are non-empty strings', () => {
    expect(operationContext({ operationName: 'Sunny Acres', operationType: 'crop', crops: '', county: 'Yolo', email: 'a@b.c', crops2: 'x', phone: 5 }))
      .toEqual({ operationName: 'Sunny Acres', operationType: 'crop', county: 'Yolo' });
  });

  it('ignores non-string values and missing data', () => {
    expect(operationContext({ operationName: 7, crops: ['a'], county: null })).toEqual({});
    expect(operationContext(null)).toEqual({});
    expect(operationContext(undefined)).toEqual({});
  });
});
