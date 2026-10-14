// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

vi.mock('../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
vi.mock('../lib/db.js', () => ({ getProfile: vi.fn().mockResolvedValue(null), upsertProfile: vi.fn() }));
const { listRecordsForReport } = await import('../lib/reportData.js');
const { default: MaintenanceModule } = await import('./MaintenanceModule.jsx');

const farm = { id: 'farm-1', name: 'Palo Verde' };
const record = { id: 'r1', kind: 'purchase', status: 'approved', record_date: '2026-08-01', payload: { supplier: 'Sea Co', product: 'Kelp meal', category: 'fertilizer', omri_status: 'listed' }, created_at: '2026-08-01T00:00:00Z' };
const ok = (records) => ({ data: { records, truncated: false }, error: null });

beforeEach(() => {
  listRecordsForReport.mockReset();
  listRecordsForReport.mockImplementation(async ({ kinds }) => ok(kinds.includes('input') ? [] : [record]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('MaintenanceModule: the tools that work from the farm’s records', () => {
  it('gives Input Re-verification the farm, so it shows the materials in the farm’s records', async () => {
    renderWithLang(<MaintenanceModule profile={{}} userId="u1" farm={farm} onNavigate={() => {}} />);
    await userEvent.click(screen.getByText('Input Re-verification'));
    expect(await screen.findByText('1 material from your Farm Records.')).toBeTruthy();
    expect(listRecordsForReport).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1' }));
  });

  it('lets Input Re-verification take the person to the farm records', async () => {
    listRecordsForReport.mockImplementation(async () => ok([]));
    const onNavigate = vi.fn();
    renderWithLang(<MaintenanceModule profile={{}} userId="u1" farm={farm} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Input Re-verification'));
    await userEvent.click(await screen.findByRole('button', { name: 'Open Purchases' }));
    expect(onNavigate).toHaveBeenCalledWith('log:purchase');
  });

  it('gives National List Review the farm, too', async () => {
    renderWithLang(<MaintenanceModule profile={{}} userId="u1" farm={farm} onNavigate={() => {}} />);
    await userEvent.click(screen.getByText('National List Review'));
    expect(await screen.findByText(/1 material from your Farm Records/)).toBeTruthy();
  });
});
