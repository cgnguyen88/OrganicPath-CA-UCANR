// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
vi.mock('../lib/db.js', () => ({ getProfile: vi.fn().mockResolvedValue(null), debouncedSync: vi.fn() }));
const { authedFetch } = await import('../lib/apiClient.js');
const { default: OCCSPAssistant } = await import('./OCCSPAssistant.jsx');

function streamed(text) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ delta: { text } })}\n\ndata: [DONE]\n\n`);
  let sent = false;
  const read = async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes }));
  return { ok: true, body: { getReader: () => ({ read }) } };
}

const ANSWER = '## Estimated Reimbursement\n\n75% of $800.00 is **$600.00**.\n\n## Common Mistakes to Avoid\n\n- Missing the STD 204 form\n- Late submission';

beforeEach(() => {
  authedFetch.mockReset().mockResolvedValue(streamed(ANSWER));
  localStorage.clear();
});
afterEach(cleanup);

async function analyze(lang = 'en') {
  renderWithLang(<OCCSPAssistant profile={{ operationName: 'Palo Verde Farm' }} userId={null} />, lang);
  await userEvent.click(screen.getByRole('button', { name: lang === 'es' ? /Analizar con Jimmy/ : /Analyze with Jimmy/ }));
}

describe('OCCSP assistant: Jimmy’s analysis', () => {
  it('shows the analysis as headed sections and a list, with no markdown marks', async () => {
    await analyze();
    expect(await screen.findByRole('heading', { name: 'Estimated Reimbursement' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Common Mistakes to Avoid' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(expect.arrayContaining(['Missing the STD 204 form', 'Late submission']));
    expect(screen.getByText('$600.00', { selector: 'strong' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\*\*|## /);
  });

  it('asks for the answer as a short document with one heading per section', async () => {
    await analyze();
    await screen.findByRole('heading', { name: 'Estimated Reimbursement' });
    const body = JSON.parse(authedFetch.mock.calls[0][1].body);
    expect(body.mode).toBe('occsp');
    const prompt = body.messages[0].content;
    expect(prompt).toMatch(/each under its own ## heading/);
    for (const section of ['Estimated Reimbursement', 'Tips for This Operation', 'Common Mistakes to Avoid', 'Recommended Timeline', 'Multiple Certifications']) expect(prompt).toContain(section);
    expect(prompt).not.toMatch(/ESTIMATED REIMBURSEMENT CALCULATION|Format clearly with headers/);
  });
});
