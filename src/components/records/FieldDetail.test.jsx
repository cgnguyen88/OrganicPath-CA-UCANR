// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';
import { summarizeFields } from '../../domain/records/fields.js';
import FieldDetail from './FieldDetail.jsx';

const B2 = { id: 'f-b2', name: 'B2', area: 2.5, area_unit: 'acre', notes: 'Drip lines', is_active: true };
const rec = (id, kind, date, payload) => ({ id, kind, status: 'approved', record_date: date, source: 'import', payload });
const RECORDS = [
  rec('r1', 'planting', '2026-04-02', { crop: 'Lettuce', field: 'B2' }),
  rec('r2', 'amendment', '2026-04-10', { material: 'Compost', field: 'b2' }),
  rec('r3', 'activity', '2026-06-01', { activity_type: 'spray', field: 'B2', product: 'Neem oil' }),
  rec('r4', 'harvest', '2026-06-20', { crop: 'Lettuce', field: 'B2', quantity: 40, unit: 'lb' }),
];
const summaryOf = (field, records) => summarizeFields([field], records)[0];

const setup = (props = {}, lang = 'en') => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<FieldDetail summary={summaryOf(B2, RECORDS)} truncated={false} onClose={onClose} {...props} />, lang);
  return { user, onClose };
};
afterEach(cleanup);

describe('FieldDetail', () => {
  it('names the field in a dialog, with its area and notes', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'B2' })).toBeTruthy();
    expect(screen.getByText('2.5 acres')).toBeTruthy();
    expect(screen.getByText('Drip lines')).toBeTruthy();
  });

  it('says what has happened in it: crops, last application, last harvest, how many records', () => {
    setup();
    const rows = Object.fromEntries(screen.getAllByTestId('field-fact').map((row) => [row.firstChild.textContent, row.lastChild.textContent]));
    expect(rows).toEqual({ Crops: 'Lettuce', 'Last application': '2026-06-01', 'Last harvest': '2026-06-20', Records: '4 approved records' });
  });

  it('lists the records newest first, with their date, type and summary', () => {
    setup();
    const rows = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['2026-06-20', 'Harvest', 'Lettuce · 40 lb'],
      ['2026-06-01', 'Activity', 'Spray · B2 · Neem oil'],
      ['2026-04-10', 'Amendment', 'Compost · b2'],
      ['2026-04-02', 'Planting', 'Lettuce · B2'],
    ]);
  });

  it('shows a dash for what has not happened, and says no record mentions the field yet', () => {
    setup({ summary: summaryOf({ ...B2, notes: null, area: null, area_unit: null }, []) });
    const rows = Object.fromEntries(screen.getAllByTestId('field-fact').map((row) => [row.firstChild.textContent, row.lastChild.textContent]));
    expect(rows).toEqual({ Crops: '—', 'Last application': '—', 'Last harvest': '—', Records: '0 approved records' });
    expect(screen.getByText('No approved records mention this field yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('2.5 acres')).toBeNull();
  });

  it('shows no area for a field that has a number but no unit', () => {
    setup({ summary: summaryOf({ ...B2, area: 2.5, area_unit: null }, RECORDS) });
    expect(screen.queryByText(/^2\.5/)).toBeNull();
  });

  it('says "1 approved record" for one', () => {
    setup({ summary: summaryOf(B2, RECORDS.slice(0, 1)) });
    expect(screen.getByText('1 approved record')).toBeTruthy();
  });

  it('shows only the newest 50 records, and says so', () => {
    const many = Array.from({ length: 60 }, (_, i) => rec(`m${i}`, 'harvest', `2026-05-${String((i % 28) + 1).padStart(2, '0')}`, { crop: `Crop ${i}`, field: 'B2' }));
    setup({ summary: summaryOf(B2, many) });
    expect(screen.getAllByRole('row').length - 1).toBe(50);
    expect(screen.getByText('Showing the newest 50.')).toBeTruthy();
    expect(screen.getByText('60 approved records')).toBeTruthy();
  });

  it('does not say "newest" when every record is shown', () => {
    setup();
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it('warns that the oldest records may be missing when there were too many to read', () => {
    setup({ truncated: true });
    expect(screen.getByText('You have a great many records, so the oldest may be missing here.')).toBeTruthy();
    cleanup();
    setup({ truncated: false });
    expect(screen.queryByText(/great many records/)).toBeNull();
  });

  it('shows a record whose type has no name of its own rather than failing', () => {
    setup({ summary: { ...summaryOf(B2, RECORDS.slice(0, 1)), records: [rec('x', 'mystery', '2026-01-01', {})] } });
    expect(screen.getAllByText('mystery')).toHaveLength(2); // the type, and the summary that falls back to it
  });

  it('closes', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is in Spanish for a Spanish speaker', () => {
    setup({}, 'es');
    expect(screen.getByText('4 registros aprobados')).toBeTruthy();
    expect(screen.getByText('Última cosecha')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });
});
