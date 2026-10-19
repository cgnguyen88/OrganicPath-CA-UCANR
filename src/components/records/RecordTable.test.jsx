// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';
import RecordTable from './RecordTable.jsx';

const RECORD = { id: 'r1', kind: 'activity', status: 'approved', record_date: '2026-10-14', source: 'telegram', payload: { activity_type: 'spray', field: 'D4', product: 'neem oil' } };

afterEach(cleanup);

const bodyRow = () => screen.getAllByRole('row')[1];

describe('RecordTable', () => {
  it('lists records with their date, summary, status and source', () => {
    renderWithLang(<RecordTable records={[RECORD]} />);
    const cells = within(bodyRow()).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[0]).toBe('2026-10-14');
    expect(cells).toHaveLength(4);
  });

  it('marks its table to become cards on a phone, and names each cell’s column so a card can label it', () => {
    renderWithLang(<RecordTable records={[RECORD]} showKind />);
    expect(screen.getByRole('table').classList.contains('stack-table')).toBe(true);
    const labels = within(bodyRow()).getAllByRole('cell').map((cell) => cell.getAttribute('data-label'));
    expect(labels).toEqual(['Date', 'Type', null, 'Status', 'Source']);
  });

  it('labels the cells in Spanish in a Spanish app', () => {
    renderWithLang(<RecordTable records={[RECORD]} />, 'es');
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    const labels = within(bodyRow()).getAllByRole('cell').map((cell) => cell.getAttribute('data-label'));
    expect(labels[0]).toBe(headers[0]);
    expect(labels[2]).toBe(headers[2]);
  });

  it('opens a record when its row is chosen', async () => {
    const onSelect = vi.fn();
    renderWithLang(<RecordTable records={[RECORD]} onSelect={onSelect} />);
    await userEvent.click(within(bodyRow()).getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(RECORD);
  });

  it('says so when there are no records', () => {
    renderWithLang(<RecordTable records={[]} />);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
