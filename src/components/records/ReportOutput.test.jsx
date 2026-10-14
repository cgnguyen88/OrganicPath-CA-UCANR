// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';
import { GLOBAL_CSS } from '../../styles/global.js';

vi.mock('../../lib/reportCsv.js', () => ({ downloadCsv: vi.fn() }));
vi.mock('../../lib/reportDocx.js', () => ({ downloadReportDocx: vi.fn() }));
const { downloadCsv } = await import('../../lib/reportCsv.js');
const { downloadReportDocx } = await import('../../lib/reportDocx.js');
const { default: ReportOutput } = await import('./ReportOutput.jsx');

let n = 0;
const rec = (kind, record_date, payload, extra = {}) =>
  ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, source: 'manual', reviewed_at: '2026-06-02T10:00:00Z', created_at: `2026-06-01T10:00:${String(n % 60).padStart(2, '0')}Z`, ...extra });
const spray = (date, payload = {}, extra) => rec('activity', date, { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', omri_status: 'listed', ...payload }, extra);

const farm = { id: 'farm-1', name: 'Palo Verde Farm', farm_code: 'PV-1234' };
const operation = { operationName: 'Palo Verde Organics', certifierName: 'CCOF' };
const TITLE = { en: 'This season’s sprays', es: 'Aplicaciones de esta temporada' };
const props = (records, extra = {}) => ({ records, truncated: false, farm, operation, title: TITLE, period: { type: 'range', from: '2026-04-01', to: '2027-03-31' }, includeUnapproved: false, needsReviewCount: 0, ...extra });

beforeEach(() => {
  downloadCsv.mockReset();
  downloadReportDocx.mockReset();
  downloadReportDocx.mockResolvedValue(undefined);
  window.print = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  document.body.classList.remove('printing-report');
});

describe('ReportOutput: what it shows', () => {
  it('says how many records are in the report and shows a preview of them', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01'), spray('2026-07-02')])} />);
    expect(screen.getByText('2 records in this report')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'This season’s sprays' })).toBeTruthy();
    expect(screen.getAllByText('Neem oil').length).toBeGreaterThan(0);
  });

  it('shows only the first rows of each log in the preview, and says so', () => {
    const records = Array.from({ length: 40 }, (_, i) => spray(`2026-07-${String((i % 28) + 1).padStart(2, '0')}`, { notes: `entry ${i}` }));
    renderWithLang(<ReportOutput {...props(records)} />);
    const table = screen.getByRole('table', { name: /Activities/ });
    expect(within(table).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText(/shows the first 25 rows of each log/)).toBeTruthy();
  });

  it('does not mention a cut preview when everything fits', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    expect(screen.queryByText(/shows the first/)).toBeNull();
  });

  it('says so, and offers no downloads, when there is nothing to put in the report', () => {
    renderWithLang(<ReportOutput {...props([])} />);
    expect(screen.getByText(/No records match/)).toBeTruthy();
    for (const name of [/Download Word/, /Download spreadsheet/, /Print/]) expect(screen.getByRole('button', { name }).disabled).toBe(true);
  });

  it('warns when the list was cut short', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { truncated: true })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/cut short/);
  });
});

describe('ReportOutput: notes before handing it over', () => {
  it('points out materials with no confirmed OMRI listing and seed that is not organic', () => {
    renderWithLang(<ReportOutput {...props([
      spray('2026-07-01', { omri_status: 'not_listed' }),
      spray('2026-07-02', { omri_status: 'unknown' }),
      rec('seed', '2026-03-01', { crop: 'Tomato', variety: 'Roma', organic_status: 'untreated' }),
    ])} />);
    const box = screen.getByRole('region', { name: 'Before you hand this over' });
    expect(within(box).getByText(/2 materials have no confirmed OMRI listing/)).toBeTruthy();
    expect(within(box).getByText(/1 seed record is not marked as certified organic/)).toBeTruthy();
  });

  it('points out records still waiting for review, which are not in the report', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { needsReviewCount: 3 })} />);
    expect(screen.getByText('Your farm has 3 records waiting for review. Records waiting for review are not included in this report.')).toBeTruthy();
  });

  it('does not say records are left out when they are included', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { needsReviewCount: 3, includeUnapproved: true })} />);
    expect(screen.queryByText(/Your farm has/)).toBeNull();
  });

  it('shows no box at all when there is nothing to point out', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    expect(screen.queryByRole('region', { name: 'Before you hand this over' })).toBeNull();
  });

  it('keeps the notes out of the report itself', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01', { omri_status: 'not_listed' })])} />);
    const report = document.querySelector('.report-doc');
    expect(report.textContent).not.toMatch(/Before you hand this over|no confirmed OMRI/);
  });

  it('writes the notes in the app language', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { needsReviewCount: 2 })} />, 'es');
    expect(screen.getByText('Tu finca tiene 2 registros esperando revisión. Los registros que esperan revisión no se incluyen en este informe.')).toBeTruthy();
  });
});

describe('ReportOutput: language', () => {
  it('starts in the app language, and the report language can be changed on its own', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { title: undefined })} />);
    const select = screen.getByLabelText('Report language');
    expect(select.value).toBe('en');
    await userEvent.selectOptions(select, 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Informe de Registros Orgánicos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download Word/ })).toBeTruthy(); // the app itself stays English
  });

  it('starts in Spanish for a Spanish app', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { title: undefined })} />, 'es');
    expect(screen.getByLabelText('Idioma del informe').value).toBe('es');
    expect(screen.getByRole('heading', { level: 1, name: 'Informe de Registros Orgánicos' })).toBeTruthy();
  });
});

describe('ReportOutput: downloads', () => {
  it('saves a Word file in the report language with a plain file name', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.click(screen.getByRole('button', { name: /Download Word/ }));
    await waitFor(() => expect(downloadReportDocx).toHaveBeenCalledTimes(1));
    const [report, fileName] = downloadReportDocx.mock.calls[0];
    expect(report.title).toBe('This season’s sprays');
    expect(report.lang).toBe('en');
    expect(report.total).toBe(1);
    expect(fileName).toMatch(/^organic-records_palo-verde-farm_this-season-s-sprays_\d{4}-\d{2}-\d{2}\.docx$/);
  });

  it('uses the language chosen for the report', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'es');
    await userEvent.click(screen.getByRole('button', { name: /Download Word/ }));
    await waitFor(() => expect(downloadReportDocx).toHaveBeenCalled());
    expect(downloadReportDocx.mock.calls[0][0].lang).toBe('es');
  });

  it('shows that it is working, and cannot be started twice, while the file is being made', async () => {
    let finish;
    downloadReportDocx.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.click(screen.getByRole('button', { name: /Download Word/ }));
    const working = await screen.findByRole('button', { name: 'Preparing…' });
    expect(working.getAttribute('aria-disabled')).toBe('true');
    expect(working.disabled).toBe(false); // stays focusable, so keyboard focus is not thrown away mid-action
    await userEvent.click(working);
    await userEvent.click(screen.getByRole('button', { name: /Print/ }));
    await userEvent.click(screen.getByRole('button', { name: /Download spreadsheet/ }));
    expect(window.print).not.toHaveBeenCalled(); // nothing else can be started meanwhile either
    expect(downloadCsv).not.toHaveBeenCalled();
    finish();
    await screen.findByRole('button', { name: /Download Word/ });
    expect(downloadReportDocx).toHaveBeenCalledTimes(1);
  });

  it('tells the person when the file could not be made', async () => {
    downloadReportDocx.mockRejectedValue(new Error('boom'));
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.click(screen.getByRole('button', { name: /Download Word/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not create the file/);
    expect(screen.getByRole('button', { name: /Download Word/ }).disabled).toBe(false);
  });

  it('saves a spreadsheet with a column for every field, in the report language', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'es');
    await userEvent.click(screen.getByRole('button', { name: /Download spreadsheet/ }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [rows, fileName] = downloadCsv.mock.calls[0];
    expect(rows[0][0]).toBe('Fecha');
    expect(rows).toHaveLength(2);
    expect(fileName).toMatch(/\.csv$/);
  });

  it('puts records that are not approved in the spreadsheet only when they are included', async () => {
    const records = [spray('2026-07-01'), spray('2026-07-02', {}, { status: 'draft' })];
    const { unmount } = renderWithLang(<ReportOutput {...props(records)} />);
    await userEvent.click(screen.getByRole('button', { name: /Download spreadsheet/ }));
    expect(downloadCsv.mock.calls[0][0]).toHaveLength(2);
    unmount();

    renderWithLang(<ReportOutput {...props(records, { includeUnapproved: true })} />);
    await userEvent.click(screen.getByRole('button', { name: /Download spreadsheet/ }));
    expect(downloadCsv.mock.calls[1][0]).toHaveLength(3);
  });
});

describe('ReportOutput: printing and saving as PDF', () => {
  it('opens the print window with the whole report, and tidies up afterwards', async () => {
    const records = Array.from({ length: 40 }, (_, i) => spray(`2026-07-${String((i % 28) + 1).padStart(2, '0')}`, { notes: `entry ${i}` }));
    renderWithLang(<ReportOutput {...props(records)} />);
    expect(document.querySelector('.print-only')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Print \/ Save as PDF/ }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-report')).toBe(true);
    const printed = document.querySelector('.print-only .report-doc');
    expect(printed).not.toBeNull();
    expect(printed.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(40); // every row, not just the preview

    fireEvent(window, new Event('afterprint'));
    expect(document.body.classList.contains('printing-report')).toBe(false);
  });

  it('can be printed again', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    const button = screen.getByRole('button', { name: /Print \/ Save as PDF/ });
    await userEvent.click(button);
    fireEvent(window, new Event('afterprint'));
    await userEvent.click(button);
    expect(window.print).toHaveBeenCalledTimes(2);
    expect(document.body.classList.contains('printing-report')).toBe(true);
  });

  it('prints the report in the chosen language', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { title: undefined })} />);
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'es');
    await userEvent.click(screen.getByRole('button', { name: /Print/ }));
    expect(document.querySelector('.print-only h1').textContent).toBe('Informe de Registros Orgánicos');
  });

  it('explains how to save as PDF', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    expect(screen.getByText(/choose “Save as PDF”/)).toBeTruthy();
  });

  it('removes the print-only copy and the body class when it goes away', async () => {
    const { unmount } = renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.click(screen.getByRole('button', { name: /Print/ }));
    unmount();
    expect(document.querySelector('.print-only')).toBeNull();
    expect(document.body.classList.contains('printing-report')).toBe(false);
  });
});

describe('ReportOutput: the report follows the language chosen for it', () => {
  it('translates the title along with everything else, and the name of the file', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    expect(screen.getByRole('heading', { level: 1, name: 'This season’s sprays' })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Aplicaciones de esta temporada' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Download Word/ }));
    await waitFor(() => expect(downloadReportDocx).toHaveBeenCalled());
    const [report, fileName] = downloadReportDocx.mock.calls[0];
    expect(report.title).toBe('Aplicaciones de esta temporada');
    expect(fileName).toContain('aplicaciones-de-esta-temporada');
  });

  it('marks the report with its language, so a screen reader reads it with the right voice', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    expect(document.querySelector('.report-doc').getAttribute('lang')).toBe('en');
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'es');
    expect(document.querySelector('.report-doc').getAttribute('lang')).toBe('es');
  });

  it('can be told which language to use, and says when it is changed (so a parent can keep the choice)', async () => {
    const onLangChange = vi.fn();
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} lang="es" onLangChange={onLangChange} />);
    expect(screen.getByLabelText('Report language').value).toBe('es');
    expect(screen.getByRole('heading', { level: 1, name: 'Aplicaciones de esta temporada' })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'en');
    expect(onLangChange).toHaveBeenCalledWith('en');
  });
});

describe('ReportOutput: a list cut short', () => {
  it('says so in the spreadsheet and in the name of the file', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { truncated: true })} />);
    await userEvent.click(screen.getByRole('button', { name: /Download spreadsheet/ }));
    const [rows, fileName] = downloadCsv.mock.calls[0];
    expect(rows.at(-1)).toEqual([expect.stringMatching(/cut short/)]);
    expect(fileName).toMatch(/_partial_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('says so in the name of the Word file too', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')], { truncated: true })} />);
    await userEvent.click(screen.getByRole('button', { name: /Download Word/ }));
    await waitFor(() => expect(downloadReportDocx).toHaveBeenCalled());
    expect(downloadReportDocx.mock.calls[0][1]).toMatch(/_partial_/);
  });

  it('leaves the name and the spreadsheet alone when the list is complete', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.click(screen.getByRole('button', { name: /Download spreadsheet/ }));
    const [rows, fileName] = downloadCsv.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(fileName).not.toContain('partial');
  });
});

describe('ReportOutput: for people who use a screen reader', () => {
  it('announces how many records are in the report', () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01'), spray('2026-07-02')])} />);
    expect(screen.getByRole('status').textContent).toBe('2 records in this report');
  });
});

describe('ReportOutput: the print copy', () => {
  it('goes away once the print window is closed, and comes back for the next print', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    const button = screen.getByRole('button', { name: /Print \/ Save as PDF/ });
    await userEvent.click(button);
    expect(document.querySelector('.print-only')).not.toBeNull();

    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(document.querySelector('.print-only')).toBeNull());

    await userEvent.click(button);
    expect(document.querySelector('.print-only')).not.toBeNull();
    expect(window.print).toHaveBeenCalledTimes(2);
  });

  it('is found by the print styles: the names this component uses are the ones the stylesheet uses', async () => {
    renderWithLang(<ReportOutput {...props([spray('2026-07-01')])} />);
    await userEvent.click(screen.getByRole('button', { name: /Print/ }));
    const portal = document.querySelector('.print-only');
    expect(portal.parentElement).toBe(document.body);
    expect(document.body.classList.contains('printing-report')).toBe(true);
    expect(GLOBAL_CSS).toContain('body.printing-report > *:not(.print-only)');
    expect(GLOBAL_CSS).toContain('body.printing-report .print-only');
    expect(GLOBAL_CSS).toMatch(/\.print-only\s*\{\s*display:\s*none/);
    expect(GLOBAL_CSS).toContain('.print-only .report-doc');
  });
});
