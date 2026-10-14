// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from '../records/testUtils.jsx';

vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('../../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { authedFetch } = await import('../../lib/apiClient.js');
const { default: InputVerification } = await import('./InputVerification.jsx');

let n = 0;
const rec = (kind, record_date, payload, extra = {}) => ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, created_at: '2026-01-01T00:00:00Z', ...extra });
const purchase = (date, payload = {}) => rec('purchase', date, { supplier: 'Sea Co', product: 'Kelp meal', category: 'fertilizer', omri_status: 'listed', ...payload });
const spray = (date, payload = {}) => rec('activity', date, { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', ...payload });
const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });

/** What each of the two reads returns: the dated records, and the Input List. */
function serve({ dated = [], inputs = [], truncated = false } = {}) {
  listRecordsForReport.mockImplementation(async ({ kinds }) => (kinds.includes('input') ? ok(inputs) : ok(dated, truncated)));
}
const farm = { id: 'farm-1' };
const renderTool = (extra = {}, lang = 'en') => renderWithLang(<InputVerification farm={farm} onNavigate={extra.onNavigate ?? (() => {})} {...extra} />, lang);
const reply = (text) => ({ ok: true, json: async () => ({ content: [{ text }] }), text: async () => text });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T12:00:00') });
  localStorage.clear();
  listRecordsForReport.mockReset();
  authedFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  serve({ dated: [purchase('2026-08-01'), spray('2026-09-01')] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InputVerification: the materials', () => {
  it('shows that it is loading, then the materials from the farm’s records', async () => {
    renderTool();
    expect(screen.getByText('Loading your materials…')).toBeTruthy();
    expect(await screen.findByText('2 materials from your Farm Records.')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Kelp meal')).toBeTruthy();
    expect(within(table).getByText('Neem oil')).toBeTruthy();
    expect(within(table).getByText('Sea Co')).toBeTruthy();
    expect(within(table).getByText('Fertilizer')).toBeTruthy();
  });

  it('asks for this farm’s records: the dated ones from a year back, and the whole Input List', async () => {
    renderTool();
    await screen.findByRole('table');
    const calls = listRecordsForReport.mock.calls.map(([args]) => args);
    expect(calls).toContainEqual(expect.objectContaining({ farmId: 'farm-1', kinds: ['purchase', 'amendment', 'activity'], from: '2025-10-14' }));
    expect(calls).toContainEqual(expect.objectContaining({ farmId: 'farm-1', kinds: ['input'] }));
  });

  it('shows what is known about the OMRI status of each material, and what is not', async () => {
    renderTool();
    const table = await screen.findByRole('table');
    const kelp = within(table).getByText('Kelp meal').closest('tr');
    const neem = within(table).getByText('Neem oil').closest('tr');
    expect(within(kelp).getByText('OMRI listed')).toBeTruthy();
    expect(within(neem).getByText('Unknown')).toBeTruthy();
  });

  it('points out a material whose records disagree about its status', async () => {
    serve({ dated: [purchase('2026-03-01', { omri_status: 'not_listed' }), purchase('2026-08-01', { omri_status: 'listed' })] });
    renderTool();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Your records disagree')).toBeTruthy();
  });

  it('names the categories used by the Input List too, not only the purchase ones', async () => {
    serve({ inputs: [rec('input', null, { product: 'Barn cleaner', category: 'cleaner' })] });
    renderTool();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Cleaner / sanitizer')).toBeTruthy();
  });

  it('shows when a material was last used if it was never bought', async () => {
    serve({ dated: [spray('2026-09-01', { product: 'Neem oil' })] });
    renderTool();
    const table = await screen.findByRole('table');
    expect(within(within(table).getByText('Neem oil').closest('tr')).getByText('2026-09-01')).toBeTruthy();
  });

  it('shows a material that is not listed in OMRI as such', async () => {
    serve({ dated: [purchase('2026-08-01', { product: 'Mystery spray', omri_status: 'not_listed' })] });
    renderTool();
    expect(await screen.findByText('Not listed')).toBeTruthy();
  });

  it('says which materials are on the Input List', async () => {
    serve({ dated: [purchase('2026-08-01')], inputs: [rec('input', null, { product: 'Kelp meal' })] });
    renderTool();
    await screen.findByRole('table');
    expect(screen.getByText('On your Input List')).toBeTruthy();
  });

  it('flags a material last bought more than a year ago, and one due soon', async () => {
    serve({ dated: [purchase('2025-01-01', { product: 'Old stock' }), purchase('2026-01-15', { product: 'Winter stock' }), purchase('2026-09-30', { product: 'Fresh stock' })] });
    renderTool();
    const table = await screen.findByRole('table');
    expect(within(within(table).getByText('Old stock').closest('tr')).getByText('⚠ Verify this year')).toBeTruthy();
    expect(within(within(table).getByText('Winter stock').closest('tr')).getByText('Review soon')).toBeTruthy();
    expect(within(within(table).getByText('Fresh stock').closest('tr')).queryByText(/Verify this year|Review soon/)).toBeNull();
  });

  it('warns when the list may be missing the oldest materials', async () => {
    serve({ dated: [purchase('2026-08-01')], truncated: true });
    renderTool();
    expect((await screen.findByRole('alert')).textContent).toMatch(/great many records/);
  });
});

describe('InputVerification: no materials yet', () => {
  beforeEach(() => serve());

  it('says so, and points to where to record them', async () => {
    const onNavigate = vi.fn();
    renderTool({ onNavigate });
    expect(await screen.findByText('No materials in your Farm Records yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open Purchases' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open Input List' }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['log:purchase', 'log:input']);
  });

  it('opens the manual list straight away, since that is the way in', async () => {
    renderTool();
    await screen.findByText('No materials in your Farm Records yet');
    expect(screen.getByLabelText('Manual input list')).toBeTruthy();
  });

  it('has nothing to verify until something is entered', async () => {
    renderTool();
    await screen.findByText('No materials in your Farm Records yet');
    expect(screen.getByRole('button', { name: /Re-verify with Jimmy/ }).disabled).toBe(true);
  });

  it('copes with no farm yet', async () => {
    renderTool({ farm: undefined });
    expect(await screen.findByText('No materials in your Farm Records yet')).toBeTruthy();
    expect(listRecordsForReport).not.toHaveBeenCalled();
  });
});

describe('InputVerification: the manual list', () => {
  it('saves what is typed on this device, and says so', async () => {
    serve();
    renderTool();
    await userEvent.type(await screen.findByLabelText('Manual input list'), 'Copper sulfate (fungicide)');
    await userEvent.click(screen.getByRole('button', { name: 'Save list' }));
    expect(screen.getByRole('button', { name: /Saved/ })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('orgpath_manual_inputs'))).toBe('Copper sulfate (fungicide)');
  });

  it('remembers a list saved before', async () => {
    localStorage.setItem('orgpath_manual_inputs', JSON.stringify('Old entry'));
    serve();
    renderTool();
    expect((await screen.findByLabelText('Manual input list')).value).toBe('Old entry');
  });

  it('is tucked away when there are materials, and can be opened', async () => {
    renderTool();
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Manual input list')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add inputs manually' }));
    expect(screen.getByLabelText('Manual input list')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Hide manual entry' }));
    expect(screen.queryByLabelText('Manual input list')).toBeNull();
  });

  it('is counted in the header when there is something in it', async () => {
    localStorage.setItem('orgpath_manual_inputs', JSON.stringify('Old entry'));
    renderTool();
    expect(await screen.findByText(/Manual entries are also included/)).toBeTruthy();
  });
});

describe('InputVerification: asking Jimmy', () => {
  it('sends the materials as they are recorded, with what is not recorded said plainly, and shows the answer', async () => {
    authedFetch.mockResolvedValue(reply('✓ CLEAR Kelp meal'));
    renderTool();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /Re-verify with Jimmy/ }));
    expect(await screen.findByText('✓ CLEAR Kelp meal')).toBeTruthy();

    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/claude');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ mode: 'input_verification', stream: false });
    const prompt = body.messages[0].content;
    expect(prompt).toContain('- Kelp meal | category: fertilizer | suppliers: Sea Co | OMRI status: listed | last purchased: 2026-08-01 | applications recorded: 0');
    expect(prompt).toContain('- Neem oil | category: not recorded | suppliers: not recorded | OMRI status: unknown | last purchased: not recorded | applications recorded: 1');
    expect(prompt).toMatch(/not recorded/i);
    expect(prompt).toMatch(/do not invent/i);
    expect(prompt).not.toMatch(/Spanish/);
  });

  it('includes what was typed by hand, as well', async () => {
    localStorage.setItem('orgpath_manual_inputs', JSON.stringify('Copper sulfate (fungicide)'));
    authedFetch.mockResolvedValue(reply('done'));
    renderTool();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /Re-verify with Jimmy/ }));
    await screen.findByText('done');
    expect(JSON.parse(authedFetch.mock.calls[0][1].body).messages[0].content).toContain('Copper sulfate (fungicide)');
  });

  it('can verify with only a hand-typed list', async () => {
    serve();
    authedFetch.mockResolvedValue(reply('done'));
    renderTool();
    await userEvent.type(await screen.findByLabelText('Manual input list'), 'Copper sulfate');
    const button = screen.getByRole('button', { name: /Re-verify with Jimmy/ });
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    await screen.findByText('done');
  });

  it('asks for the answer in Spanish in a Spanish app', async () => {
    authedFetch.mockResolvedValue(reply('listo'));
    renderTool({}, 'es');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /Reverificar con Jimmy/ }));
    await screen.findByText('listo');
    expect(JSON.parse(authedFetch.mock.calls[0][1].body).messages[0].content).toMatch(/Respond entirely in Spanish/);
  });

  it('shows that it is working, and cannot be started twice meanwhile', async () => {
    let finish;
    authedFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderTool();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /Re-verify with Jimmy/ }));
    const working = screen.getByRole('button', { name: /Analyzing/ });
    expect(working.disabled).toBe(true);
    finish(reply('done'));
    await screen.findByText('done');
    expect(authedFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Re-verify with Jimmy/ }).disabled).toBe(false); // ready to be used again
  });

  it('shows what went wrong when Jimmy cannot answer', async () => {
    authedFetch.mockResolvedValue({ ok: false, text: async () => 'rate limited' });
    renderTool();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /Re-verify with Jimmy/ }));
    expect((await screen.findByText(/rate limited/)).textContent).toContain('Error:');
  });

  it('reminds the person that this does not replace OMRI or their certifier', async () => {
    renderTool();
    await screen.findByRole('table');
    expect(screen.getByText(/does not replace the OMRI Products List or your certifier/)).toBeTruthy();
  });
});

describe('InputVerification: when the records cannot be read', () => {
  it('says so, offers to try again, and still allows a hand-typed list', async () => {
    listRecordsForReport.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    serve();
    listRecordsForReport.mockImplementationOnce(async () => ({ data: null, error: { code: 'unknown' } }));
    renderTool();
    expect(await screen.findByText('Could not load your materials')).toBeTruthy();
    expect(screen.getByLabelText('Manual input list')).toBeTruthy();
    serve({ dated: [purchase('2026-08-01')] });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 material from your Farm Records.')).toBeTruthy();
  });
});

describe('InputVerification: seed', () => {
  it('points to the Seed Log for seed records, instead of the old Receipt Manager', async () => {
    const onNavigate = vi.fn();
    renderTool({ onNavigate });
    await screen.findByRole('table');
    expect(screen.queryByText(/Receipt Manager/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open Seed Log' }));
    expect(onNavigate).toHaveBeenCalledWith('log:seed');
  });
});

describe('InputVerification: Spanish', () => {
  it('speaks Spanish', async () => {
    renderTool({}, 'es');
    expect(await screen.findByText('2 materiales de los Registros de tu Finca.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reverificar con Jimmy/ })).toBeTruthy();
    expect(screen.getByText('Fertilizante')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Estado OMRI')).toBeTruthy());
  });
});
