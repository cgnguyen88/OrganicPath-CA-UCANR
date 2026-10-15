// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';
import Dashboard from './Dashboard.jsx';

const TOOL_TITLES = ['OSP Generator', 'Eligibility Check', 'Compliance Tracker', 'Certification Maintenance'];

/** The tool cards on the dashboard, by title, in order. */
const cardTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).filter((title) => TOOL_TITLES.includes(title));

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Dashboard: tool cards', () => {
  it('shows a farmer working toward certification each tool once: OSP Generator, Eligibility Check and Compliance Tracker', () => {
    renderWithLang(<Dashboard user={{ name: 'Ana Reyes' }} onNavigate={() => {}} profile={{ certificationStatus: 'pursuing' }} />);
    expect(cardTitles()).toEqual(['OSP Generator', 'Eligibility Check', 'Compliance Tracker']);
  });

  it('shows a certified farmer Certification Maintenance, Compliance Tracker and OSP Generator, each once', () => {
    renderWithLang(<Dashboard user={{ name: 'Ana Reyes' }} onNavigate={() => {}} profile={{ certificationStatus: 'certified' }} />);
    expect(cardTitles()).toEqual(['Certification Maintenance', 'Compliance Tracker', 'OSP Generator']);
  });

  it('treats a farmer with no profile yet as working toward certification', () => {
    renderWithLang(<Dashboard user={{ name: 'Ana Reyes' }} onNavigate={() => {}} profile={null} />);
    expect(cardTitles()).toEqual(['OSP Generator', 'Eligibility Check', 'Compliance Tracker']);
  });

  it('gives React no duplicate keys to complain about', () => {
    renderWithLang(<Dashboard user={{ name: 'Ana Reyes' }} onNavigate={() => {}} profile={{}} />);
    const duplicateKeyWarnings = console.error.mock.calls.filter((call) => String(call[0]).includes('same key'));
    expect(duplicateKeyWarnings).toEqual([]);
  });

  it('opens the Compliance Tracker from its card', async () => {
    const onNavigate = vi.fn();
    renderWithLang(<Dashboard user={{ name: 'Ana Reyes' }} onNavigate={onNavigate} profile={{}} />);
    const card = screen.getByRole('heading', { level: 3, name: 'Compliance Tracker' }).closest('div[style]');
    await userEvent.click(card);
    expect(onNavigate).toHaveBeenCalledWith('tracker');
  });
});
