// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from '../records/testUtils.jsx';

vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('./streamClaude.js', () => ({ default: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { default: streamClaude } = await import('./streamClaude.js');
const { saveAs } = await import('file-saver');
const { default: SubstanceAuditForm } = await import('./SubstanceAuditForm.jsx');

let n = 0;
const rec = (kind, record_date, payload) => ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, created_at: '2026-01-01T00:00:00Z' });
const purchase = (date, payload = {}) => rec('purchase', date, { supplier: 'Sea Co', product: 'Kelp meal', category: 'fertilizer', omri_status: 'listed', ...payload });
const spray = (date, payload = {}) => rec('activity', date, { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', ...payload });
const amendment = (date) => rec('amendment', date, { material: 'Compost', field: 'B2' });
const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });
const serve = (dated = [], inputs = [], truncated = false) => listRecordsForReport.mockImplementation(async ({ kinds }) => ok(kinds.includes('input') ? inputs : dated, truncated));

const farm = { id: 'farm-1', name: 'Palo Verde Farm' };
const renderForm = (props = {}, lang = 'en') => renderWithLang(<SubstanceAuditForm farm={farm} profile={{ operationName: 'Palo Verde Organics' }} onNavigate={() => {}} {...props} />, lang);
const generate = () => screen.findByRole('button', { name: /Generate Audit with Jimmy|Generar Auditoría con Jimmy/ });
const promptSent = () => streamClaude.mock.calls[0][0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T12:00:00') });
  listRecordsForReport.mockReset();
  streamClaude.mockReset();
  saveAs.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  serve([purchase('2026-03-01'), spray('2026-05-01', { product: 'Neem oil' }), spray('2026-06-01', { product: 'Neem oil' }), amendment('2026-04-02')]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SubstanceAuditForm: what it reads from the farm records', () => {
  it('shows the materials, with their OMRI status, and the ones that need verifying', async () => {
    renderForm();
    const panel = await screen.findByRole('region', { name: 'From your Farm Records' });
    expect(within(panel).getByText(/Kelp meal/)).toBeTruthy();
    expect(within(panel).getByText(/Neem oil/)).toBeTruthy();
    expect(within(panel).getByText(/Compost/)).toBeTruthy(); // applied as an amendment, never bought
    expect(within(panel).getByText('listed')).toBeTruthy();
    expect(within(panel).getAllByText('unknown')).toHaveLength(2);
    expect(within(panel).getByText('3 materials')).toBeTruthy();
    expect(within(panel).getByText('2 need OMRI verification')).toBeTruthy();
  });

  it('points out a material whose records disagree about its status', async () => {
    serve([purchase('2026-03-01', { omri_status: 'not_listed' }), purchase('2026-08-01', { omri_status: 'listed' })]);
    renderForm();
    const panel = await screen.findByRole('region', { name: 'From your Farm Records' });
    expect(within(panel).getByText('records disagree')).toBeTruthy();
    expect(within(panel).getByText('1 needs OMRI verification')).toBeTruthy();
  });

  it('says there are no suppliers recorded when no record names one', async () => {
    serve([spray('2026-05-01')]);
    renderForm();
    const panel = await screen.findByRole('region', { name: 'From your Farm Records' });
    expect(within(panel).getByText('Suppliers: none recorded')).toBeTruthy();
  });

  it('shows the suppliers, and how many applications there are and when', async () => {
    renderForm();
    const panel = await screen.findByRole('region', { name: 'From your Farm Records' });
    expect(within(panel).getByText(/Suppliers: Sea Co/)).toBeTruthy();
    expect(within(panel).getByText('2 spray records and 1 amendment record, 2026-04-02 to 2026-06-01')).toBeTruthy();
  });

  it('reads this farm’s records for the audit period: a year back at first', async () => {
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    const calls = listRecordsForReport.mock.calls.map(([args]) => args);
    expect(calls).toContainEqual(expect.objectContaining({ farmId: 'farm-1', kinds: ['purchase', 'amendment', 'activity'], from: '2025-10-14' }));
  });

  it('reads a different stretch when the audit period is changed', async () => {
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    const months = screen.getByLabelText('Audit Period (months)');
    await userEvent.clear(months);
    await userEvent.type(months, '6');
    await waitFor(() => expect(listRecordsForReport.mock.calls.map(([args]) => args.from)).toContain('2026-04-14'));
  });

  it('uses 12 months for a period that makes no sense', async () => {
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    const months = screen.getByLabelText('Audit Period (months)');
    await userEvent.clear(months);
    await userEvent.type(months, '0');
    await userEvent.click(await generate());
    expect(promptSent()).toContain('last 12 months (2025-10-14 to 2026-10-14)');
  });

  it.each([['500', 12], ['121', 12], ['2.5', 12], ['-3', 12], ['120', 120], ['1', 1], ['24', 24]])('uses %s months as %s', async (typedMonths, expected) => {
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    const months = screen.getByLabelText('Audit Period (months)');
    await userEvent.clear(months);
    await userEvent.type(months, typedMonths);
    await userEvent.click(await generate());
    expect(promptSent()).toContain(`last ${expected} months (`);
  });

  it('counts the period back from the audit date, and falls back to today when the date is cleared', async () => {
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    const date = screen.getByLabelText('Audit Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-06-30');
    await userEvent.click(await generate());
    expect(promptSent()).toContain('Audit Date: 2026-06-30');
    expect(promptSent()).toContain('last 12 months (2025-06-30 to 2026-06-30)');
    expect(listRecordsForReport.mock.calls.map(([args]) => args.from)).toContain('2025-06-30');

    streamClaude.mockClear();
    await userEvent.clear(date);
    await userEvent.click(await generate());
    expect(promptSent()).toContain('Audit Date: 2026-10-14');
  });

  it('says so when there are no materials, and points to where to record them', async () => {
    serve();
    const onNavigate = vi.fn();
    renderForm({ onNavigate });
    expect(await screen.findByText('No materials are recorded for this period yet.')).toBeTruthy();
    expect(screen.getByText('No spray or amendment records in this period.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open Input List' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open Purchases' }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['log:input', 'log:purchase']);
  });

  it('lists the first materials and says how many more there are', async () => {
    serve(Array.from({ length: 15 }, (_, i) => purchase('2026-03-01', { product: `Material ${String(i).padStart(2, '0')}` })));
    renderForm();
    const panel = await screen.findByRole('region', { name: 'From your Farm Records' });
    expect(within(panel).getByText('15 materials')).toBeTruthy();
    expect(within(panel).getByText('+3 more')).toBeTruthy();
    expect(within(panel).queryByText(/Material 14/)).toBeNull();
  });

  it('warns that the oldest records may be missing when there are a great many', async () => {
    serve([purchase('2026-03-01')], [], true);
    renderForm();
    expect((await screen.findByRole('alert')).textContent).toMatch(/great many records/);
  });

  it('says so when the records cannot be read, offers to try again, and will not write an audit from nothing', async () => {
    listRecordsForReport.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    renderForm();
    expect(await screen.findByText('Could not read your Farm Records.')).toBeTruthy();
    expect((await generate()).disabled).toBe(true);
    serve([purchase('2026-03-01')]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 material')).toBeTruthy();
    expect((await generate()).disabled).toBe(false);
  });

  it('will not write the audit until the records have been read', async () => {
    listRecordsForReport.mockReturnValue(new Promise(() => {}));
    renderForm();
    expect(screen.getByText('Reading your records…')).toBeTruthy();
    expect((await generate()).disabled).toBe(true);
  });
});

describe('SubstanceAuditForm: writing the audit', () => {
  it('asks for the audit from the records, and what was typed, and shows the draft as it arrives', async () => {
    streamClaude.mockImplementation(async (_prompt, onChunk) => { onChunk('AUDIT '); onChunk('DRAFT'); });
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    await userEvent.type(screen.getByLabelText('Other inputs used (not in your records)'), 'Copper sulfate');
    await userEvent.type(screen.getByLabelText('Storage Locations'), 'Barn A');
    await userEvent.type(screen.getByLabelText('Known Non-Compliance Incidents'), 'Drift from a neighbour in May');
    await userEvent.click(await generate());

    expect(await screen.findByText('AUDIT DRAFT')).toBeTruthy();
    const prompt = promptSent();
    expect(prompt).toContain('Operation: Palo Verde Organics');
    expect(prompt).toContain('Audit Date: 2026-10-14');
    expect(prompt).toContain('- Kelp meal | category: fertilizer | suppliers: Sea Co | OMRI status: listed');
    expect(prompt).toContain('spray records: 2, amendment records: 1, dated 2026-04-02 to 2026-06-01');
    expect(prompt).toContain('Additional inputs typed in by the farm: Copper sulfate');
    expect(prompt).toContain('Storage locations: Barn A');
    expect(prompt).toContain('Known non-compliance incidents: Drift from a neighbour in May');
    expect(prompt).toMatch(/do not invent/i);
  });

  it('uses the farm’s name when the profile has no operation name', async () => {
    renderForm({ profile: {} });
    await screen.findByRole('region', { name: 'From your Farm Records' });
    expect(screen.getByLabelText('Operation Name').value).toBe('Palo Verde Farm');
  });

  it('shows that it is working, and cannot be started twice', async () => {
    let finish;
    streamClaude.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    await userEvent.click(await generate());
    expect(screen.getByRole('button', { name: 'Generating...' }).disabled).toBe(true);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Audit with Jimmy' }).disabled).toBe(false));
    expect(streamClaude).toHaveBeenCalledTimes(1);
  });

  it('shows a problem instead of the draft when the AI cannot answer', async () => {
    streamClaude.mockImplementation(async (_prompt, _onChunk, onError) => onError('API 429'));
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    await userEvent.click(await generate());
    expect(await screen.findByText('[Error: API 429]')).toBeTruthy();
  });

  it('starts a fresh draft each time', async () => {
    streamClaude.mockImplementationOnce(async (_p, onChunk) => onChunk('FIRST')).mockImplementationOnce(async (_p, onChunk) => onChunk('SECOND'));
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    await userEvent.click(await generate());
    await screen.findByText('FIRST');
    await userEvent.click(await generate());
    await screen.findByText('SECOND');
    expect(screen.queryByText('FIRST')).toBeNull();
  });

  it('saves the draft as a text file named for the date', async () => {
    streamClaude.mockImplementation(async (_p, onChunk) => onChunk('Saved text'));
    renderForm();
    await screen.findByRole('region', { name: 'From your Farm Records' });
    await userEvent.click(await generate());
    await screen.findByText('Saved text');
    await userEvent.click(screen.getByRole('button', { name: /Download/ }));
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toBe('substance-audit-2026-10-14.txt');
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    expect(text).toBe('Saved text');
    expect(blob.type).toBe('text/plain;charset=utf-8');
  });

  it('asks for the draft in Spanish in a Spanish app, and shows Spanish labels', async () => {
    streamClaude.mockImplementation(async (_p, onChunk) => onChunk('Borrador'));
    renderForm({}, 'es');
    await screen.findByRole('region', { name: 'De los Registros de tu Finca' });
    expect(screen.getByLabelText('Período de Auditoría (meses)')).toBeTruthy();
    await userEvent.click(await generate());
    await screen.findByText('Borrador');
    expect(promptSent()).toMatch(/Respond entirely in Spanish/);
  });
});
