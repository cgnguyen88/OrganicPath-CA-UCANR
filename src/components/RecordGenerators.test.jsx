// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

vi.mock('../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
const { listRecordsForReport } = await import('../lib/reportData.js');
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
