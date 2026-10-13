import { describe, it, expect } from 'vitest';
import { allowedTransitions, availableActions, canEditRecord, canReview, STATUS_TONE } from './workflow.js';
import { RECORD_STATUSES } from './kinds.js';

describe('canReview', () => {
  it.each([['owner', true], ['manager', true], ['crew', false], [null, false], [undefined, false], ['superuser', false]])('%s → %s', (role, expected) => {
    expect(canReview(role)).toBe(expected);
  });
});

describe('allowedTransitions', () => {
  it('lets owners and managers move records along the review workflow', () => {
    for (const role of ['owner', 'manager']) {
      expect(allowedTransitions('pending_review', role).sort()).toEqual(['approved', 'needs_info', 'rejected', 'voided']);
      expect(allowedTransitions('approved', role)).toEqual(['voided']);
      expect(allowedTransitions('rejected', role).sort()).toEqual(['pending_review', 'voided']);
      expect(allowedTransitions('draft', role).sort()).toEqual(['needs_info', 'pending_review', 'voided']);
      expect(allowedTransitions('needs_info', role).sort()).toEqual(['draft', 'pending_review', 'voided']);
    }
  });

  it('treats voided as final', () => {
    expect(allowedTransitions('voided', 'owner')).toEqual([]);
  });

  it('lets crew only move their own records toward review, never approve, reject or void', () => {
    expect(allowedTransitions('draft', 'crew').sort()).toEqual(['needs_info', 'pending_review']);
    expect(allowedTransitions('needs_info', 'crew').sort()).toEqual(['draft', 'pending_review']);
    expect(allowedTransitions('pending_review', 'crew')).toEqual(['needs_info']);
    expect(allowedTransitions('approved', 'crew')).toEqual([]);
    expect(allowedTransitions('rejected', 'crew')).toEqual([]);
  });

  it('allows nothing without a role', () => {
    for (const status of RECORD_STATUSES) expect(allowedTransitions(status, null)).toEqual([]);
  });
});

describe('canEditRecord', () => {
  const rec = (status, created_by = 'u1') => ({ status, created_by });

  it('lets owners and managers edit any record that is not voided', () => {
    expect(canEditRecord(rec('approved'), 'manager', 'someone')).toBe(true);
    expect(canEditRecord(rec('voided'), 'owner', 'someone')).toBe(false);
  });

  it('lets crew edit only their own unreviewed records', () => {
    expect(canEditRecord(rec('pending_review'), 'crew', 'u1')).toBe(true);
    expect(canEditRecord(rec('draft'), 'crew', 'u1')).toBe(true);
    expect(canEditRecord(rec('pending_review'), 'crew', 'u2')).toBe(false);
    expect(canEditRecord(rec('approved'), 'crew', 'u1')).toBe(false);
    expect(canEditRecord(rec('rejected'), 'crew', 'u1')).toBe(false);
  });

  it('allows nothing without a role or user', () => {
    expect(canEditRecord(rec('draft'), null, 'u1')).toBe(false);
    expect(canEditRecord(rec('draft'), 'crew', null)).toBe(false);
  });
});

describe('STATUS_TONE', () => {
  it('has a tone for every status', () => {
    for (const status of RECORD_STATUSES) expect(['neutral', 'warning', 'success', 'danger', 'muted']).toContain(STATUS_TONE[status]);
  });
});

describe('availableActions (what the UI offers this person on this record)', () => {
  const rec = (status, created_by = 'u1') => ({ status, created_by });

  it('offers owners and managers every allowed transition', () => {
    expect(availableActions(rec('pending_review'), 'owner', 'someone').sort()).toEqual(['approved', 'needs_info', 'rejected', 'voided']);
    expect(availableActions(rec('approved'), 'manager', 'someone')).toEqual(['voided']);
  });

  it('lets crew send THEIR OWN draft or needs-info record for review, and nothing else', () => {
    expect(availableActions(rec('draft'), 'crew', 'u1')).toEqual(['pending_review']);
    expect(availableActions(rec('needs_info'), 'crew', 'u1')).toEqual(['pending_review']);
    expect(availableActions(rec('pending_review'), 'crew', 'u1')).toEqual([]);
    expect(availableActions(rec('approved'), 'crew', 'u1')).toEqual([]);
  });

  it('offers crew nothing on someone else’s record, and nobody anything without a role or user', () => {
    expect(availableActions(rec('draft'), 'crew', 'u2')).toEqual([]);
    expect(availableActions(rec('draft'), 'crew', null)).toEqual([]);
    expect(availableActions(rec('draft'), null, 'u1')).toEqual([]);
  });

  it('never offers an action the database would refuse', () => {
    for (const status of ['draft', 'needs_info', 'pending_review', 'approved', 'rejected', 'voided']) {
      for (const role of ['owner', 'manager', 'crew']) {
        for (const to of availableActions(rec(status), role, 'u1')) expect(allowedTransitions(status, role), `${role} ${status}->${to}`).toContain(to);
      }
    }
  });
});
