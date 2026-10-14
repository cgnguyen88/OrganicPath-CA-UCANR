// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from '../records/testUtils.jsx';

vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('../../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { authedFetch } = await import('../../lib/apiClient.js');
const { default: NationalListReview } = await import('./NationalListReview.jsx');

let n = 0;
const rec = (kind, record_date, payload) => ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, created_at: '2026-01-01T00:00:00Z' });
const purchase = (date, payload = {}) => rec('purchase', date, { supplier: 'Sea Co', product: 'Kelp meal', category: 'fertilizer', omri_status: 'listed', ...payload });
const ok = (records) => ({ data: { records, truncated: false }, error: null });
const serve = (dated = [], inputs = []) => listRecordsForReport.mockImplementation(async ({ kinds }) => ok(kinds.includes('input') ? inputs : dated));
const reply = (text) => ({ ok: true, json: async () => ({ content: [{ text }] }) });
const renderTool = (props = {}, lang = 'en') => renderWithLang(<NationalListReview farm={{ id: 'farm-1' }} profile={{}} {...props} />, lang);
const scanButton = () => screen.findByRole('button', { name: /Run Full Re-Scan|Ejecutar|Scanning/ });
const promptSent = () => JSON.parse(authedFetch.mock.calls[0][1].body).messages[0].content;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T12:00:00') });
  listRecordsForReport.mockReset();
  authedFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  serve([purchase('2026-08-01'), purchase('2026-08-02', { product: 'Neem oil', omri_status: 'unknown' })]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NationalListReview: where the inputs come from', () => {
  it('says the inputs come from the farm’s records, and how many', async () => {
    renderTool();
    expect(await screen.findByText(/2 materials from your Farm Records/)).toBeTruthy();
  });

  it('says they come from the OSP profile when the records have none', async () => {
    serve();
    renderTool();
    expect(await screen.findByText(/from your OSP profile/)).toBeTruthy();
  });

  it('reads this farm’s records', async () => {
    renderTool();
    await screen.findByText(/2 materials/);
    expect(listRecordsForReport.mock.calls.map(([args]) => args.farmId)).toEqual(['farm-1', 'farm-1']);
  });
});

describe('NationalListReview: the scan', () => {
  it('sends the materials as they are recorded, with a rule not to make anything up, and shows the answer', async () => {
    authedFetch.mockResolvedValue(reply('✓ CLEAR Kelp meal'));
    renderTool();
    await screen.findByText(/2 materials/);
    await userEvent.click(await scanButton());
    expect(await screen.findByText('✓ CLEAR Kelp meal')).toBeTruthy();

    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/claude');
    expect(JSON.parse(init.body)).toMatchObject({ mode: 'national_list_review', stream: false });
    const prompt = promptSent();
    expect(prompt).toContain('- Kelp meal | category: fertilizer | suppliers: Sea Co | OMRI status: listed');
    expect(prompt).toContain('- Neem oil | category: fertilizer | suppliers: Sea Co | OMRI status: unknown');
    expect(prompt).toMatch(/do not invent/i);
    expect(prompt).toContain('Peroxyacetic acid'); // the National List updates it checks against
  });

  it('falls back to the inputs in the OSP profile when the records have none', async () => {
    serve();
    authedFetch.mockResolvedValue(reply('done'));
    renderTool({ profile: { inputs: 'Fish emulsion, kelp' } });
    await screen.findByText(/from your OSP profile/);
    await userEvent.click(await scanButton());
    await screen.findByText('done');
    expect(promptSent()).toContain('Operation-level inputs from OSP: Fish emulsion, kelp');
  });

  it('says so when it has no inputs at all, rather than inventing some', async () => {
    serve();
    authedFetch.mockResolvedValue(reply('done'));
    renderTool();
    await screen.findByText(/from your OSP profile/);
    await userEvent.click(await scanButton());
    await screen.findByText('done');
    expect(promptSent()).toContain('No specific inputs on file');
  });

  it('asks for the answer in Spanish in a Spanish app', async () => {
    authedFetch.mockResolvedValue(reply('listo'));
    renderTool({}, 'es');
    await screen.findByText(/2 materiales de los Registros de tu Finca/);
    await userEvent.click(await scanButton());
    await screen.findByText('listo');
    expect(promptSent()).toMatch(/Respond entirely in Spanish/);
  });

  it('does not ask for Spanish in an English app', async () => {
    authedFetch.mockResolvedValue(reply('done'));
    renderTool();
    await screen.findByText(/2 materials/);
    await userEvent.click(await scanButton());
    await screen.findByText('done');
    expect(promptSent()).not.toMatch(/Spanish/);
  });

  it('shows what went wrong', async () => {
    authedFetch.mockResolvedValue({ ok: false, status: 500 });
    renderTool();
    await screen.findByText(/2 materials/);
    await userEvent.click(await scanButton());
    expect(await screen.findByText(/Error: API 500/)).toBeTruthy();
  });

  it('waits for the records before it will scan, so it never scans a half-loaded list', async () => {
    listRecordsForReport.mockReturnValue(new Promise(() => {}));
    renderTool();
    expect((await scanButton()).disabled).toBe(true);
  });

  it('will not scan, and offers to try again, when the records could not be read', async () => {
    listRecordsForReport.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    renderTool();
    expect(await screen.findByText('Could not load your materials')).toBeTruthy();
    expect((await scanButton()).disabled).toBe(true);
    serve([purchase('2026-08-01')]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/1 material from your Farm Records/)).toBeTruthy();
    expect((await scanButton()).disabled).toBe(false);
  });

  it('cannot be started twice', async () => {
    let finish;
    authedFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderTool();
    await screen.findByText(/2 materials/);
    await userEvent.click(await scanButton());
    expect(screen.getByRole('button', { name: /Scanning your inputs/ }).disabled).toBe(true);
    finish(reply('done'));
    await screen.findByText('done');
    expect(authedFetch).toHaveBeenCalledTimes(1);
  });
});
