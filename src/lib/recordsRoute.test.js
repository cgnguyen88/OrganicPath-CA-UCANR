import { describe, it, expect } from 'vitest';
import { parseRecordsRoute, isRecordsPage, logRoute, viewRoute, ROUTES } from './recordsRoute.js';

describe('recordsRoute', () => {
  it('builds and parses every route type', () => {
    expect(parseRecordsRoute(ROUTES.overview)).toEqual({ type: 'overview' });
    expect(parseRecordsRoute(ROUTES.review)).toEqual({ type: 'review' });
    expect(parseRecordsRoute(ROUTES.history)).toEqual({ type: 'history' });
    expect(parseRecordsRoute(ROUTES.reports)).toEqual({ type: 'reports' });
    expect(parseRecordsRoute(ROUTES.fields)).toEqual({ type: 'fields' });
    expect(parseRecordsRoute(ROUTES.stock)).toEqual({ type: 'stock' });
    expect(parseRecordsRoute(logRoute('purchase'))).toEqual({ type: 'log', kind: 'purchase' });
    expect(parseRecordsRoute(viewRoute('3f2a-91bc'))).toEqual({ type: 'view', viewId: '3f2a-91bc' });
  });

  it.each(['dashboard', 'records', 'recordGenerators', 'receipts', 'log:bogus', 'log:', 'view:', 'view:a b', 'view:../x', 'log:purchase:extra', '', null, undefined, 5])(
    'does not treat %j as a records page',
    (page) => {
      expect(parseRecordsRoute(page)).toBeNull();
      expect(isRecordsPage(page)).toBe(false);
    },
  );

  it('recognizes records pages', () => {
    expect(isRecordsPage('log:harvest')).toBe(true);
    expect(isRecordsPage('needsReview')).toBe(true);
    expect(isRecordsPage('recordReports')).toBe(true);
    expect(isRecordsPage('recordFields')).toBe(true);
    expect(isRecordsPage('recordStock')).toBe(true);
  });
});
