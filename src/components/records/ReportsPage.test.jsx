// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';
import { RECORD_KINDS } from '../../domain/records/kinds.js';

vi.mock('../../lib/reportCsv.js', () => ({ downloadCsv: vi.fn() }));
vi.mock('../../lib/reportDocx.js', () => ({ downloadReportDocx: vi.fn() }));
vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { default: ReportsPage } = await import('./ReportsPage.jsx');

let n = 0;
const rec = (kind, record_date, payload, extra = {}) =>
  ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, source: 'manual', reviewed_at: '2026-06-02T10:00:00Z', created_at: `2026-06-01T10:00:${String(n % 60).padStart(2, '0')}Z`, ...extra });
const spray = (date, payload = {}) => rec('activity', date, { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', omri_status: 'listed', ...payload });
const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });

const farm = { id: 'farm-1', name: 'Palo Verde Farm', farm_code: 'PV-1234', season_start_month: 4, season_start_day: 1 };
const operation = { operationName: 'Palo Verde Organics' };
const renderPage = (extra = {}, lang = 'en') => renderWithLang(<ReportsPage farm={farm} operation={operation} needsReviewCount={0} {...extra} />, lang);
const create = () => userEvent.click(screen.getByRole('button', { name: 'Create report' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T12:00:00') });
  listRecordsForReport.mockReset();
  listRecordsForReport.mockResolvedValue(ok([spray('2026-07-01'), spray('2026-07-02')]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReportsPage: the form', () => {
  it('starts with this season, every log, and approved records only, and gathers nothing yet', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /This season/ }).checked).toBe(true);
    for (const kind of RECORD_KINDS) expect(screen.getByRole('checkbox', { name: new RegExp(`^${kindPlural(kind)}$`) }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /Approved records only/ }).checked).toBe(true);
    expect(listRecordsForReport).not.toHaveBeenCalled();
  });

  it('lists the logs in the order they appear in the report', () => {
    renderPage();
    const labels = screen.getAllByRole('checkbox').map((box) => box.parentElement.textContent);
    expect(labels).toEqual(['Seed Log', 'Planting Log', 'Amendment Log', 'Activities', 'Input List', 'Purchases', 'Harvest Log', 'Inventory', 'Notes']);
  });

  it('shows the dates of this season and last season, from the farm’s season start', () => {
    renderPage();
    expect(screen.getByRole('radio', { name: /This season.*2026-04-01 to 2027-03-31/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Last season.*2025-04-01 to 2026-03-31/ })).toBeTruthy();
  });

  it('only asks for dates when “Choose dates” is picked', async () => {
    renderPage();
    expect(screen.queryByLabelText('From')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Choose dates' }));
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
  });
});

const kindPlural = (kind) => ({
  activity: 'Activities', purchase: 'Purchases', note: 'Notes', seed: 'Seed Log', planting: 'Planting Log',
  amendment: 'Amendment Log', harvest: 'Harvest Log', input: 'Input List', inventory: 'Inventory',
})[kind];

describe('ReportsPage: what it asks for', () => {
  it('gathers this season’s approved records of every kind', async () => {
    renderPage();
    await create();
    expect(listRecordsForReport).toHaveBeenCalledTimes(1);
    expect(listRecordsForReport).toHaveBeenCalledWith({ farmId: 'farm-1', kinds: RECORD_KINDS, includeUnapproved: false, from: '2026-04-01', to: '2027-03-31' });
  });

  it('gathers last season’s records', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: /Last season/ }));
    await create();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ from: '2025-04-01', to: '2026-03-31' }));
  });

  it('gathers records of all dates', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'All dates' }));
    await create();
    const [args] = listRecordsForReport.mock.calls[0];
    expect(args.from).toBeUndefined();
    expect(args.to).toBeUndefined();
  });

  it('gathers the dates the person chose', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'Choose dates' }));
    await userEvent.type(screen.getByLabelText('From'), '2026-05-01');
    await userEvent.type(screen.getByLabelText('To'), '2026-09-30');
    await create();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-05-01', to: '2026-09-30' }));
  });

  it('accepts a start date with no end date, and the other way round', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'Choose dates' }));
    await userEvent.type(screen.getByLabelText('From'), '2026-05-01');
    await create();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-05-01', to: undefined }));
  });

  it('refuses a start date after the end date, and says why, without gathering anything', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: 'Choose dates' }));
    await userEvent.type(screen.getByLabelText('From'), '2026-09-30');
    await userEvent.type(screen.getByLabelText('To'), '2026-05-01');
    await create();
    expect((await screen.findByRole('alert')).textContent).toBe('Check the dates: use real dates, and the start cannot be after the end.');
    expect(listRecordsForReport).not.toHaveBeenCalled();
  });

  it('gathers only the logs that are ticked', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Activities' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harvest Log' }));
    await create();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['activity', 'harvest'] }));
  });

  it('refuses to gather when no log is ticked, until “Select all” brings them back', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('alert')).toBeNull(); // no scolding before the button is pressed
    await create();
    expect((await screen.findByRole('alert')).textContent).toBe('Choose at least one log.');
    expect(listRecordsForReport).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    await create();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ kinds: RECORD_KINDS }));
    expect(screen.queryByText('Choose at least one log.')).toBeNull();
  });

  it('includes records not yet approved when asked', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: /Also include records not yet approved/ }));
    await create();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ includeUnapproved: true }));
  });
});

describe('ReportsPage: the result', () => {
  it('shows the report once the records are gathered, with the period on it', async () => {
    renderPage();
    await create();
    expect(await screen.findByText('2 records in this report')).toBeTruthy();
    const report = document.querySelector('.report-doc');
    expect(within(report).getByText('2026-04-01 to 2027-03-31')).toBeTruthy();
    expect(within(report).getByText('Palo Verde Organics')).toBeTruthy();
    expect(within(report).getByRole('heading', { level: 1, name: 'Organic Records Report' })).toBeTruthy();
  });

  it('shows that it is gathering, and cannot be started twice meanwhile', async () => {
    let deliver;
    listRecordsForReport.mockReturnValue(new Promise((resolve) => { deliver = resolve; }));
    renderPage();
    await create();
    const button = screen.getByRole('button', { name: 'Gathering records…' });
    expect(button.disabled).toBe(true);
    deliver(ok([spray('2026-07-01')]));
    await screen.findByText('1 record in this report');
    expect(screen.getByRole('button', { name: 'Create report' }).disabled).toBe(false);
    expect(listRecordsForReport).toHaveBeenCalledTimes(1);
  });

  it('says so when the records could not be gathered', async () => {
    listRecordsForReport.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    renderPage();
    await create();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not gather your records. Please try again.');
    expect(screen.queryByText(/records in this report/)).toBeNull();
  });

  it('hides a report that no longer matches the form once the form is changed', async () => {
    renderPage();
    await create();
    await screen.findByText('2 records in this report');
    await userEvent.click(screen.getByRole('radio', { name: 'All dates' }));
    expect(screen.queryByText('2 records in this report')).toBeNull();
    await create();
    expect(await screen.findByText('2 records in this report')).toBeTruthy();
    expect(listRecordsForReport).toHaveBeenCalledTimes(2);
  });

  it('tells the person about records still waiting for review', async () => {
    renderPage({ needsReviewCount: 4 });
    await create();
    expect(await screen.findByText('Your farm has 4 records waiting for review. Records waiting for review are not included in this report.')).toBeTruthy();
  });

  it('passes on that the list was cut short', async () => {
    listRecordsForReport.mockResolvedValue(ok([spray('2026-07-01')], true));
    renderPage();
    await create();
    expect((await screen.findByRole('alert')).textContent).toMatch(/cut short/);
  });

  it('ignores an answer that arrives after the form has changed', async () => {
    const pending = [];
    listRecordsForReport.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    renderPage();
    await create();
    await userEvent.click(screen.getByRole('radio', { name: 'All dates' }));
    pending[0](ok([spray('2026-07-01')]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/records? in this report/)).toBeNull();
  });
});

describe('ReportsPage: dates that are not real', () => {
  const pickCustom = () => userEvent.click(screen.getByRole('radio', { name: 'Choose dates' }));

  it('refuses a year typed short (26 for 2026) with a message about the dates, not a failure to load', async () => {
    renderPage();
    await pickCustom();
    await userEvent.type(screen.getByLabelText('From'), '0026-05-01');
    await create();
    expect((await screen.findByRole('alert')).textContent).toBe('Check the dates: use real dates, and the start cannot be after the end.');
    expect(listRecordsForReport).not.toHaveBeenCalled();
  });

  it('refuses a far-future year in the end date too', async () => {
    renderPage();
    await pickCustom();
    await userEvent.type(screen.getByLabelText('To'), '9999-12-31');
    await create();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Check the dates/);
    expect(listRecordsForReport).not.toHaveBeenCalled();
  });

  it('does not hold dates against a report that does not use them', async () => {
    renderPage();
    await pickCustom();
    await userEvent.type(screen.getByLabelText('From'), '0026-05-01');
    await userEvent.click(screen.getByRole('radio', { name: 'All dates' }));
    await create();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listRecordsForReport).toHaveBeenCalledTimes(1);
  });

  it('limits the date fields to years that make sense', async () => {
    renderPage();
    await pickCustom();
    for (const label of ['From', 'To']) {
      expect(screen.getByLabelText(label).getAttribute('min')).toBe('1900-01-01');
      expect(screen.getByLabelText(label).getAttribute('max')).toBe('2100-12-31');
    }
  });

  it('accepts the first and last year that can be used', async () => {
    renderPage();
    await pickCustom();
    await userEvent.type(screen.getByLabelText('From'), '1900-01-01');
    await userEvent.type(screen.getByLabelText('To'), '2100-12-31');
    await create();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ from: '1900-01-01', to: '2100-12-31' }));
  });
});

describe('ReportsPage: when gathering fails in an unexpected way', () => {
  it('says so and lets the person try again, instead of staying on “gathering” for ever', async () => {
    listRecordsForReport.mockRejectedValueOnce(new Error('network down'));
    renderPage();
    await create();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not gather your records. Please try again.');
    expect(screen.getByRole('button', { name: 'Create report' }).disabled).toBe(false);
    await create();
    expect(await screen.findByText('2 records in this report')).toBeTruthy();
  });
});

describe('ReportsPage: keeping the person’s choices', () => {
  it('keeps the report language when the form is changed and the report is made again', async () => {
    renderPage();
    await create();
    await screen.findByText('2 records in this report');
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'es');

    await userEvent.click(screen.getByRole('radio', { name: 'All dates' }));
    await create();
    await screen.findByText('2 records in this report');
    expect(screen.getByLabelText('Report language').value).toBe('es');
    expect(document.querySelector('.report-doc h1').textContent).toBe('Informe de Registros Orgánicos');
  });

  it('announces when the report is ready', async () => {
    renderPage();
    await create();
    expect((await screen.findByRole('status')).textContent).toBe('2 records in this report');
  });
});

describe('ReportsPage: two requests in a row', () => {
  it('keeps the newer report when the older request answers last', async () => {
    const pending = [];
    listRecordsForReport.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    renderPage();
    await create();                                                          // request 1: this season
    await userEvent.click(screen.getByRole('radio', { name: 'All dates' }));
    await create();                                                          // request 2: all dates
    expect(pending).toHaveLength(2);

    pending[1](ok([spray('2026-07-01'), spray('2026-07-02'), spray('2026-07-03')]));
    await screen.findByText('3 records in this report');
    pending[0](ok([spray('2026-07-09')]));                                   // the older answer limps in
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('3 records in this report')).toBeTruthy();
  });
});

describe('ReportsPage: language', () => {
  it('speaks Spanish in a Spanish app', async () => {
    renderPage({}, 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Informes' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Crear informe' }));
    expect(await screen.findByText('2 registros en este informe')).toBeTruthy();
  });
});
