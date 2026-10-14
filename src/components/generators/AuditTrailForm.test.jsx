// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from '../records/testUtils.jsx';

vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('./streamClaude.js', () => ({ default: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { default: streamClaude } = await import('./streamClaude.js');
const { saveAs } = await import('file-saver');
const { default: AuditTrailForm } = await import('./AuditTrailForm.jsx');

let n = 0;
const rec = (kind, record_date, payload = {}) => ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, created_at: '2026-01-01T00:00:00Z' });
const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });

const farm = { id: 'farm-1', name: 'Palo Verde Farm' };
const profile = { operationName: 'Palo Verde Organics', certifierName: 'CCOF', operationType: 'crop' };
const renderForm = (props = {}, lang = 'en') => renderWithLang(<AuditTrailForm farm={farm} profile={profile} onNavigate={() => {}} {...props} />, lang);
const generate = () => screen.findByRole('button', { name: /Generate Audit Trail System with Jimmy|Generar Sistema de Registro de Auditoría con Jimmy/ });
const promptSent = () => streamClaude.mock.calls[0][0];
const table = () => screen.findByRole('table', { name: 'Your records, year by year' });
const rowOf = (tableEl, name) => within(tableEl).getByText(name).closest('tr');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T12:00:00') });
  listRecordsForReport.mockReset();
  streamClaude.mockReset();
  saveAs.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  listRecordsForReport.mockResolvedValue(ok([
    rec('activity', '2025-05-01'), rec('activity', '2026-06-01'), rec('activity', '2026-07-01'),
    rec('harvest', '2024-08-01'), rec('seed', '2026-03-01'),
  ]));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AuditTrailForm: the coverage of the records', () => {
  it('reads all of this farm’s approved records of the last five calendar years', async () => {
    renderForm();
    await table();
    expect(listRecordsForReport).toHaveBeenCalledWith({ farmId: 'farm-1', kinds: undefined, from: '2022-01-01', includeUnapproved: false });
  });

  it('shows how many records each log has in each of the five years', async () => {
    renderForm();
    const t = await table();
    const headings = within(t).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headings).toEqual(['Log', '2022', '2023', '2024', '2025', '2026', 'Total', 'First', 'Latest']);
    const activity = within(rowOf(t, 'Activities')).getAllByRole('cell').map((c) => c.textContent);
    expect(activity).toEqual(['Activities', '0', '0', '0', '1', '2', '3', '2025-05-01', '2026-07-01']);
    const harvest = within(rowOf(t, 'Harvest Log')).getAllByRole('cell').map((c) => c.textContent);
    expect(harvest).toEqual(['Harvest Log', '0', '0', '1', '0', '0', '1', '2024-08-01', '2024-08-01']);
  });

  it('lists every log, even one with no records, because a gap is what an inspector asks about', async () => {
    renderForm();
    const t = await table();
    const inventory = within(rowOf(t, 'Inventory')).getAllByRole('cell').map((c) => c.textContent);
    expect(inventory.slice(1, 7)).toEqual(['0', '0', '0', '0', '0', '0']);
    expect(inventory.slice(7)).toEqual(['—', '—']);
    expect(within(t).getAllByRole('row')).toHaveLength(10); // the heading row and nine logs
  });

  it('says so when there are no approved records at all', async () => {
    listRecordsForReport.mockResolvedValue(ok([]));
    renderForm();
    expect(await screen.findByText('No approved records in these five years yet.')).toBeTruthy();
  });

  it('shows that it is reading, and will not write the document meanwhile', async () => {
    listRecordsForReport.mockReturnValue(new Promise(() => {}));
    renderForm();
    expect(screen.getByText('Reading your records…')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull(); // a table of zeros would look like missing records
    expect((await generate()).disabled).toBe(true);
  });

  it('says so, offers to try again, and will not write from nothing, when the records cannot be read', async () => {
    listRecordsForReport.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    renderForm();
    expect(await screen.findByText('Could not read your Farm Records.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect((await generate()).disabled).toBe(true);
    listRecordsForReport.mockResolvedValue(ok([rec('activity', '2026-06-01')]));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await table();
    expect((await generate()).disabled).toBe(false);
  });

  it('warns that the oldest records may be missing when there are a great many', async () => {
    listRecordsForReport.mockResolvedValue(ok([rec('activity', '2026-06-01')], true));
    renderForm();
    expect((await screen.findByRole('alert')).textContent).toMatch(/great many records/);
  });

  it('offers to build the five-year report, which holds the records themselves', async () => {
    const onNavigate = vi.fn();
    renderForm({ onNavigate });
    await table();
    expect(screen.getByText(/choose “All dates”/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Build a 5-year report' }));
    expect(onNavigate).toHaveBeenCalledWith('recordReports');
  });
});

describe('AuditTrailForm: the form', () => {
  it('fills in what the profile knows, and this year', async () => {
    renderForm();
    await table();
    expect(screen.getByLabelText('Operation Name').value).toBe('Palo Verde Organics');
    expect(screen.getByLabelText('Certifying Agent Name').value).toBe('CCOF');
    expect(screen.getByLabelText('Operation Type (crop/livestock/handler)').value).toBe('crop');
    expect(screen.getByLabelText('Certification Year').value).toBe('2026');
  });

  it('uses the farm’s name when the profile has no operation name', async () => {
    renderForm({ profile: {} });
    await table();
    expect(screen.getByLabelText('Operation Name').value).toBe('Palo Verde Farm');
  });

  it('describes the record system from the facts: how many records, which dates, what is guaranteed', async () => {
    renderForm();
    await table();
    expect(screen.getByLabelText('Recordkeeping System Description').value).toBe(
      'Digital farm records kept in OrganicPath CA: 5 approved records across 3 record types, from 2024-08-01 to 2026-07-01. Every change is logged, records are approved by an owner or manager, and nothing is deleted (withdrawn records are voided).',
    );
  });

  it('leaves the description empty when there are no records to describe', async () => {
    listRecordsForReport.mockResolvedValue(ok([]));
    renderForm();
    await screen.findByText('No approved records in these five years yet.');
    expect(screen.getByLabelText('Recordkeeping System Description').value).toBe('');
  });

  it('keeps what the person typed in the description, instead of replacing it when the records arrive', async () => {
    let deliver;
    listRecordsForReport.mockReturnValue(new Promise((resolve) => { deliver = resolve; }));
    renderForm();
    await userEvent.type(screen.getByLabelText('Recordkeeping System Description'), 'My own words');
    deliver(ok([rec('activity', '2026-06-01')]));
    await table();
    expect(screen.getByLabelText('Recordkeeping System Description').value).toBe('My own words');
  });

  it('keeps a description that was cleared, rather than filling it in again', async () => {
    renderForm();
    await table();
    await userEvent.clear(screen.getByLabelText('Recordkeeping System Description'));
    expect(screen.getByLabelText('Recordkeeping System Description').value).toBe('');
  });
});

describe('AuditTrailForm: writing the document', () => {
  it('gives the AI what the records hold, the gaps, and what was typed, and shows the draft as it arrives', async () => {
    streamClaude.mockImplementation(async (_prompt, onChunk) => { onChunk('TRAIL '); onChunk('DRAFT'); });
    renderForm();
    await table();
    await userEvent.type(screen.getByLabelText('Certificate Number'), '12345');
    await userEvent.type(screen.getByLabelText('Certified Products/Crops'), 'Tomatoes');
    await userEvent.click(await generate());

    expect(await screen.findByText('TRAIL DRAFT')).toBeTruthy();
    const prompt = promptSent();
    expect(prompt).toContain('Operation Name: Palo Verde Organics');
    expect(prompt).toContain('Certifying Agent: CCOF');
    expect(prompt).toContain('Certificate Number: 12345');
    expect(prompt).toContain('Products Certified: Tomatoes');
    expect(prompt).toContain('- Activities: 3 records (2025: 1, 2026: 2); first 2025-05-01; last 2026-07-01');
    expect(prompt).toContain('No records in: ');
    expect(prompt).toContain('Digital farm records kept in OrganicPath CA');
    expect(prompt).toMatch(/do not invent/i);
  });

  it('shows that it is working, and cannot be started twice', async () => {
    let finish;
    streamClaude.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderForm();
    await table();
    await userEvent.click(await generate());
    expect(screen.getByRole('button', { name: 'Generating...' }).disabled).toBe(true);
    finish();
    await screen.findByRole('button', { name: 'Generate Audit Trail System with Jimmy' });
    expect(streamClaude).toHaveBeenCalledTimes(1);
  });

  it('shows a problem instead of a draft when the AI cannot answer', async () => {
    streamClaude.mockImplementation(async (_p, _c, onError) => onError('API 500'));
    renderForm();
    await table();
    await userEvent.click(await generate());
    expect(await screen.findByText('[Error: API 500]')).toBeTruthy();
  });

  it('saves the draft as a text file named for the certification year', async () => {
    streamClaude.mockImplementation(async (_p, onChunk) => onChunk('Saved text'));
    renderForm();
    await table();
    await userEvent.click(await generate());
    await screen.findByText('Saved text');
    await userEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(saveAs.mock.calls[0][1]).toBe('audit-trail-system-2026.txt');
  });

  it('works in Spanish', async () => {
    streamClaude.mockImplementation(async (_p, onChunk) => onChunk('Borrador'));
    renderForm({}, 'es');
    expect(await screen.findByRole('table', { name: 'Tus registros, año por año' })).toBeTruthy();
    expect(screen.getByText('Actividades')).toBeTruthy();
    expect(screen.getByLabelText('Año de Certificación')).toBeTruthy();
    await userEvent.click(await generate());
    await screen.findByText('Borrador');
    expect(promptSent()).toMatch(/Respond entirely in Spanish/);
  });
});
