import { RECORD_KINDS } from '../domain/records/kinds.js';

/**
 * Navigation ids for the farm-records pages. The app's sidebar and router use plain
 * string ids (activePage); these helpers keep the dynamic ones consistent.
 */
export const ROUTES = Object.freeze({ overview: 'farmRecords', review: 'needsReview', history: 'changeHistory' });

export const logRoute = (kind) => `log:${kind}`;
export const viewRoute = (viewId) => `view:${viewId}`;

const VIEW_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @param {unknown} page an activePage id
 * @returns {{ type: 'overview' | 'review' | 'history' } | { type: 'log', kind: string } | { type: 'view', viewId: string } | null}
 */
export function parseRecordsRoute(page) {
  if (typeof page !== 'string') return null;
  if (page === ROUTES.overview) return { type: 'overview' };
  if (page === ROUTES.review) return { type: 'review' };
  if (page === ROUTES.history) return { type: 'history' };

  const [prefix, rest, ...extra] = page.split(':');
  if (extra.length > 0 || rest === undefined) return null;
  if (prefix === 'log' && RECORD_KINDS.includes(rest)) return { type: 'log', kind: rest };
  if (prefix === 'view' && VIEW_ID.test(rest)) return { type: 'view', viewId: rest };
  return null;
}

export const isRecordsPage = (page) => parseRecordsRoute(page) !== null;
