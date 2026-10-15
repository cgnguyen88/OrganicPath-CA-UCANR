// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

vi.mock('../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
const { listRecordsForReport } = await import('../lib/reportData.js');
const { authedFetch } = await import('../lib/apiClient.js');
const { saveAs } = await import('file-saver');
const { default: RecordGenerators } = await import('./RecordGenerators.jsx');

const farm = { id: 'farm-1', name: 'Palo Verde Farm' };
const record = { id: 'r1', kind: 'purchase', status: 'approved', record_date: '2026-08-01', payload: { supplier: 'Sea Co', product: 'Kelp meal', category: 'fertilizer', omri_status: 'listed' }, created_at: '2026-08-01T00:00:00Z' };
const ok = (records) => ({ data: { records, truncated: false }, error: null });
const renderPage = (props = {}, lang = 'en') => renderWithLang(<RecordGenerators profile={{}} farm={farm} onNavigate={() => {}} {...props} />, lang);

beforeEach(() => {
  listRecordsForReport.mockReset();
  listRecordsForReport.mockImplementation(async ({ kinds }) => ok(kinds?.includes('input') ? [] : [record]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('Draft Documents', () => {
  it('is called Draft Documents, and says what Jimmy writes from', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Draft Documents' })).toBeTruthy();
    expect(screen.getByText(/drafts compliance documents from the details you give and the facts in your Farm Records/)).toBeTruthy();
  });

  it('says plainly that these are AI drafts to check before using', () => {
    renderPage();
    expect(screen.getByText(/These are AI drafts/)).toBeTruthy();
    expect(screen.getByText(/Not recorded/)).toBeTruthy();
    expect(screen.getByText(/review with your certifier/)).toBeTruthy();
  });

  it('is no longer called Record Generators, since it does not make records', () => {
    renderPage();
    expect(screen.queryByText('Record Generators')).toBeNull();
  });

  it('keeps its three documents as tabs', () => {
    renderPage();
    for (const name of ['Soil Health Assessment', 'Prohibited Substance Audit', '5-Year Audit Trail']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('gives the Prohibited Substance Audit the farm’s own materials', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Prohibited Substance Audit' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'From your Farm Records' }).textContent).toContain('Kelp meal'));
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1' }));
  });

  it('gives the 5-Year Audit Trail the farm’s records, and a way to the Reports page', async () => {
    const onNavigate = vi.fn();
    renderPage({ onNavigate });
    await userEvent.click(screen.getByRole('button', { name: '5-Year Audit Trail' }));
    await screen.findByRole('table', { name: 'Your records, year by year' });
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1', from: expect.stringMatching(/^\d{4}-01-01$/) }));
    expect(screen.getByLabelText('Operation Name').value).toBe('Palo Verde Farm');
    await userEvent.click(screen.getByRole('button', { name: 'Build a 5-year report' }));
    expect(onNavigate).toHaveBeenCalledWith('recordReports');
  });

  it('points the audits at the Input List when there are no materials yet', async () => {
    listRecordsForReport.mockImplementation(async () => ok([]));
    const onNavigate = vi.fn();
    renderPage({ onNavigate });
    await userEvent.click(screen.getByRole('button', { name: 'Prohibited Substance Audit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open Input List' }));
    expect(onNavigate).toHaveBeenCalledWith('log:input');
  });

  it('works in Spanish', async () => {
    renderPage({}, 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Borradores de Documentos' })).toBeTruthy();
    expect(screen.getByText(/Son borradores hechos con IA/)).toBeTruthy();
  });
});

describe('Soil Health Assessment: the written draft', () => {
  const DRAFT = '## 1. Operation Identification\n\n**Field:** North Block\n\n## 3. Soil Health Indicators\n\n- Structure: good\n- Biology: active\n\n| Indicator | Rating |\n|---|---|\n| pH | 6.5 |';
  const streamed = (text) => {
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ delta: { text } })}\n\ndata: [DONE]\n\n`);
    let sent = false;
    const read = async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes }));
    return { ok: true, body: { getReader: () => ({ read }) } };
  };

  beforeEach(() => {
    authedFetch.mockReset().mockResolvedValue(streamed(DRAFT));
    saveAs.mockReset();
  });

  async function generate(lang = 'en') {
    renderPage({}, lang);
    await userEvent.click(screen.getByRole('button', { name: lang === 'es' ? /Generar Evaluación con Jimmy/ : /Generate Assessment with Jimmy/ }));
    await screen.findByRole('heading', { name: '1. Operation Identification' });
  }

  it('shows the draft as a document, not as raw markdown', async () => {
    await generate();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Structure: good', 'Biology: active']);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\*\*|## /);
  });

  it('asks for numbered sections, each under its own heading', async () => {
    await generate();
    const prompt = JSON.parse(authedFetch.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toMatch(/each under its own ## heading/);
    expect(prompt).not.toMatch(/OPERATION IDENTIFICATION HEADER|Format as a professional compliance document/);
  });

  it('downloads a Word document named for the date', async () => {
    await generate();
    await userEvent.click(screen.getByRole('button', { name: /Download Word/ }));
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toMatch(/^soil-assessment-\d{4}-\d{2}-\d{2}\.docx$/);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('copies clean text', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Generate Assessment with Jimmy/ }));
    await screen.findByRole('heading', { name: '1. Operation Identification' });
    await user.click(screen.getByRole('button', { name: /Copy/ }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain('\u2022 Structure: good');
    expect(copied).not.toMatch(/\*\*|##/);
  });

  it('offers the download in Spanish', async () => {
    await generate('es');
    expect(screen.getByRole('button', { name: /Descargar Word/ })).toBeTruthy();
  });
});
