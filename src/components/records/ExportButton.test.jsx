// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/reportCsv.js', () => ({ downloadCsv: vi.fn() }));
vi.mock('../../lib/reportDocx.js', () => ({ downloadReportDocx: vi.fn() }));
const { default: ExportButton } = await import('./ExportButton.jsx');

let n = 0;
const rec = (kind, record_date, payload, extra = {}) =>
  ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, source: 'manual', reviewed_at: '2026-06-02T10:00:00Z', created_at: `2026-06-01T10:00:${String(n % 60).padStart(2, '0')}Z`, ...extra });
const spray = (date, payload = {}) => rec('activity', date, { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', omri_status: 'listed', ...payload });

const farm = { id: 'farm-1', name: 'Palo Verde Farm', farm_code: 'PV-1234' };
const operation = { operationName: 'Palo Verde Organics' };
const TITLE = { en: 'This season’s sprays', es: 'Aplicaciones de esta temporada' };
const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });

let load;
const renderButton = (extra = {}, lang = 'en') =>
  renderWithLang(<ExportButton title={TITLE} farm={farm} operation={operation} period={{ type: 'range', from: '2026-04-01', to: '2027-03-31' }} load={load} {...extra} />, lang);

beforeEach(() => {
  load = vi.fn().mockResolvedValue(ok([spray('2026-07-01'), spray('2026-07-02')]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('ExportButton', () => {
  it('shows a Download button and gathers nothing until it is clicked', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a dialog named for what is being downloaded, gathers the records, and shows the report', async () => {
    let deliver;
    load.mockReturnValue(new Promise((resolve) => { deliver = resolve; }));
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    const dialog = screen.getByRole('dialog', { name: 'Download: This season’s sprays' });
    expect(within(dialog).getByText('Gathering your records…')).toBeTruthy();
    deliver(ok([spray('2026-07-01'), spray('2026-07-02')]));
    expect(await within(dialog).findByText('2 records in this report')).toBeTruthy();
    expect(within(dialog).queryByText('Gathering your records…')).toBeNull();
    expect(within(dialog).getByRole('button', { name: /Download Word/ })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('puts who and when on the report', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('2 records in this report');
    const report = document.querySelector('.report-doc');
    expect(within(report).getByText('Palo Verde Organics')).toBeTruthy();
    expect(within(report).getByText('2026-04-01 to 2027-03-31')).toBeTruthy();
    expect(within(report).getByRole('heading', { level: 1, name: 'This season’s sprays' })).toBeTruthy();
  });

  it('keeps the report as it was when the dialog opened, even if the page behind it changes', async () => {
    const { rerender } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('2 records in this report');
    rerender(<ExportButton title={{ en: 'Something else', es: 'Otra cosa' }} farm={{ ...farm, name: 'Other Farm', farm_code: 'ZZ-9999' }} operation={{ operationName: 'Other Org' }} period={{ type: 'all' }} load={load} />);
    const report = document.querySelector('.report-doc');
    expect(within(report).getByRole('heading', { level: 1, name: 'This season’s sprays' })).toBeTruthy();
    expect(within(report).getByText('Palo Verde Organics')).toBeTruthy();
    expect(within(report).getByText('PV-1234')).toBeTruthy();
    expect(within(report).getByText('2026-04-01 to 2027-03-31')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Download: This season’s sprays' })).toBeTruthy();
  });

  it('says so, and lets the person try again, when the records could not be gathered', async () => {
    load.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not gather your records/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('2 records in this report')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('closes with the Close button and with Escape, and gathers afresh when opened again', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('2 records in this report');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('2 records in this report');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('passes on that the list was cut short', async () => {
    load.mockResolvedValue(ok([spray('2026-07-01')], true));
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/cut short/);
  });
});

describe('ExportButton: records that are not approved', () => {
  it('lets the person choose to include them, and gathers again with that choice', async () => {
    load.mockImplementation(async (includeUnapproved) => ok(includeUnapproved ? [spray('2026-07-01'), { ...spray('2026-07-02'), status: 'draft' }] : [spray('2026-07-01')]));
    renderButton({ allowUnapproved: true });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('1 record in this report');
    expect(load).toHaveBeenLastCalledWith(false);

    await userEvent.click(screen.getByLabelText(/Also include records not yet approved/));
    expect(await screen.findByText('2 records in this report')).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith(true);
    expect(within(document.querySelector('.report-doc')).getByText('Includes records not yet approved')).toBeTruthy();
  });

  it('does not offer the choice when the page decides (for example a saved view)', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('2 records in this report');
    expect(screen.queryByLabelText(/Also include records not yet approved/)).toBeNull();
    expect(load).toHaveBeenCalledWith(false);
  });

  it('does not show the previous records while the new choice is being gathered', async () => {
    const pending = [];
    load.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    renderButton({ allowUnapproved: true });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    pending[0](ok([spray('2026-07-01')]));
    await screen.findByText('1 record in this report');

    await userEvent.click(screen.getByLabelText(/Also include records not yet approved/));
    expect(screen.getByText('Gathering your records…')).toBeTruthy();
    expect(screen.queryByText('1 record in this report')).toBeNull();
  });

  it('ignores an answer that arrives late for a choice that has since changed', async () => {
    const pending = [];
    load.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    renderButton({ allowUnapproved: true });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await userEvent.click(screen.getByLabelText(/Also include records not yet approved/));
    expect(pending).toHaveLength(2);

    pending[1](ok([spray('2026-07-01'), spray('2026-07-02')])); // the newer request answers first
    await screen.findByText('2 records in this report');
    pending[0](ok([spray('2026-07-09')]));                       // the older one limps in afterwards
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('2 records in this report')).toBeTruthy();
  });

  it('follows the page when it says to include them, even if the person could otherwise choose', async () => {
    renderButton({ allowUnapproved: true, includeUnapproved: true });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('2 records in this report');
    expect(load).toHaveBeenCalledWith(true);
    expect(screen.queryByLabelText(/Also include records not yet approved/)).toBeNull();
  });
});

describe('ExportButton: language', () => {
  it('speaks Spanish in a Spanish app', async () => {
    renderButton({}, 'es');
    await userEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(screen.getByRole('dialog', { name: 'Descargar: Aplicaciones de esta temporada' })).toBeTruthy();
    expect(await screen.findByText('2 registros en este informe')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });
});

describe('ExportButton: keeping the person’s choices', () => {
  it('keeps the report language when the choice about records not yet approved is changed', async () => {
    renderButton({ allowUnapproved: true });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByText('2 records in this report');
    await userEvent.selectOptions(screen.getByLabelText('Report language'), 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Aplicaciones de esta temporada' })).toBeTruthy();

    await userEvent.click(screen.getByLabelText(/Also include records not yet approved/));
    await screen.findByText('2 records in this report');
    expect(screen.getByLabelText('Report language').value).toBe('es');
    expect(screen.getByRole('heading', { level: 1, name: 'Aplicaciones de esta temporada' })).toBeTruthy();
  });
});

describe('ExportButton: when gathering fails in an unexpected way', () => {
  it('says so, and lets the person try again, instead of waiting forever', async () => {
    load.mockRejectedValueOnce(new Error('network down'));
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not gather your records/);
    expect(screen.queryByText('Gathering your records…')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('2 records in this report')).toBeTruthy();
  });

  it('ignores a failure that arrives late for a choice that has since changed', async () => {
    const pending = [];
    load.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    renderButton({ allowUnapproved: true });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await userEvent.click(screen.getByLabelText(/Also include records not yet approved/));
    pending[1].resolve(ok([spray('2026-07-01'), spray('2026-07-02')]));
    await screen.findByText('2 records in this report');
    pending[0].reject(new Error('too late'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('2 records in this report')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says that it is gathering in a way a screen reader announces', async () => {
    load.mockReturnValue(new Promise(() => {}));
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByRole('status').textContent).toBe('Gathering your records…');
  });
});

