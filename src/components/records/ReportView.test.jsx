// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { buildReport } from '../../domain/records/report.js';
import ReportView from './ReportView.jsx';

afterEach(cleanup);

let n = 0;
const rec = (kind, record_date, payload, extra = {}) =>
  ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, source: 'manual', reviewed_at: '2026-06-02T10:00:00Z', created_at: `2026-06-01T10:00:${String(n % 60).padStart(2, '0')}Z`, ...extra });
const spray = (date, payload = {}) => rec('activity', date, { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', ...payload });

const farm = { name: 'Palo Verde Farm', farm_code: 'PV-1234' };
const make = (records, extra = {}) => buildReport({ records, farm, operation: { operationName: 'Palo Verde Organics', certifierName: 'CCOF' }, lang: 'en', generatedOn: '2026-10-14', ...extra });

describe('ReportView', () => {
  it('shows the title, who the report is about, and each log with its records', () => {
    render(<ReportView report={make([spray('2026-07-01'), rec('harvest', '2026-08-01', { crop: 'Tomato', field: 'B2', quantity: 40, unit: 'lb' })])} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Organic Records Report' })).toBeTruthy();
    expect(screen.getByText('Palo Verde Organics')).toBeTruthy();
    expect(screen.getByText('PV-1234')).toBeTruthy();
    expect(screen.getByText('CCOF')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Activities/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Harvest Log/ })).toBeTruthy();
    expect(screen.getByText('Neem oil')).toBeTruthy();
    expect(screen.getByText('40 lb')).toBeTruthy();
  });

  it('gives each table real column headings, so a screen reader can read it', () => {
    render(<ReportView report={make([spray('2026-07-01')])} />);
    const table = screen.getByRole('table', { name: /Activities/ });
    const headings = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headings).toEqual(['Date', 'Activity type', 'Field / block', 'Product', 'Mix rate', 'Target pest / disease', 'Approved']);
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('keeps the records in order, oldest first', () => {
    render(<ReportView report={make([spray('2026-07-20'), spray('2026-07-01')])} />);
    const rows = within(screen.getByRole('table', { name: /Activities/ })).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.firstChild.textContent)).toEqual(['2026-07-01', '2026-07-20']);
  });

  it('shows a summary of how many records each log has', () => {
    render(<ReportView report={make([spray('2026-07-01'), spray('2026-07-02')])} />);
    const summary = screen.getByRole('table', { name: 'Summary' });
    expect(within(summary).getByText('2 records')).toBeTruthy();
  });

  it('can show only the first rows of each log, for a preview', () => {
    const records = Array.from({ length: 8 }, (_, i) => spray(`2026-07-0${i + 1}`));
    render(<ReportView report={make(records)} maxRows={3} />);
    expect(within(screen.getByRole('table', { name: /Activities/ })).getAllByRole('row')).toHaveLength(4);
  });

  it('shows everything when no limit is given', () => {
    const records = Array.from({ length: 8 }, (_, i) => spray(`2026-07-0${i + 1}`));
    render(<ReportView report={make(records)} />);
    expect(within(screen.getByRole('table', { name: /Activities/ })).getAllByRole('row')).toHaveLength(9);
  });

  it('shows text that looks like markup as plain text', () => {
    const { container } = render(<ReportView report={make([spray('2026-07-01', { notes: '<img src=x onerror=alert(1)>' })])} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('keeps a line break inside a note', () => {
    render(<ReportView report={make([spray('2026-07-01', { notes: 'first line\nsecond line' })])} />);
    const cell = screen.getByText(/first line/);
    expect(cell.textContent).toBe('first line\nsecond line');
    expect(getComputedStyle(cell).whiteSpace).toBe('pre-wrap');
  });

  it('says so when there is nothing to show', () => {
    render(<ReportView report={make([])} />);
    expect(screen.getByText('There are no records for this selection.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Summary' })).toBeNull();
  });

  it('says so when the list was cut short', () => {
    render(<ReportView report={make([spray('2026-07-01')], { truncated: true })} />);
    expect(screen.getByText(/cut short/)).toBeTruthy();
  });

  it('ends with the lines to sign and the note that this is a copy, not a statement of compliance', () => {
    render(<ReportView report={make([spray('2026-07-01')])} />);
    for (const label of ['Prepared by', 'Signature', 'Date']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText(/not a statement of compliance/)).toBeTruthy();
  });

  it('reads in Spanish when the report is in Spanish', () => {
    render(<ReportView report={make([spray('2026-07-01')], { lang: 'es' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Informe de Registros Orgánicos' })).toBeTruthy();
    expect(screen.getByText('Preparado por')).toBeTruthy();
  });

  it('marks the date cells, so a date is never split over two lines, and leaves other cells free to wrap', () => {
    render(<ReportView report={make([spray('2026-07-01', { notes: 'a long note' })])} />);
    const table = screen.getByRole('table', { name: /Activities/ });
    const cells = [...within(table).getAllByRole('row')[1].children];
    const headings = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    const dateCells = cells.filter((cell, i) => ['Date', 'Approved'].includes(headings[i]));
    expect(dateCells).toHaveLength(2);
    for (const cell of dateCells) expect(cell.className).toBe('report-date');
    for (const cell of cells.filter((c) => !dateCells.includes(c))) expect(cell.className).toBe('');
    expect(getComputedStyle(cells[headings.indexOf('Notes')]).whiteSpace).toBe('pre-wrap');
  });

  it('says which language it is written in', () => {
    const { container, rerender } = render(<ReportView report={make([spray('2026-07-01')])} />);
    expect(container.querySelector('.report-doc').getAttribute('lang')).toBe('en');
    rerender(<ReportView report={make([spray('2026-07-01')], { lang: 'es' })} />);
    expect(container.querySelector('.report-doc').getAttribute('lang')).toBe('es');
  });

  it('carries the class the print styles look for', () => {
    const { container } = render(<ReportView report={make([spray('2026-07-01')])} />);
    expect(container.querySelector('.report-doc')).not.toBeNull();
  });
});
