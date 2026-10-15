// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
const { authedFetch } = await import('../lib/apiClient.js');
const { default: ExpandableChat } = await import('./ExpandableChat.jsx');

/** A streamed reply that arrives in one piece, in the shape the chat reads. */
function streamed(text) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ delta: { text } })}\n\ndata: [DONE]\n\n`);
  let sent = false;
  const read = async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes }));
  return { ok: true, body: { getReader: () => ({ read }) } };
}

beforeEach(() => {
  authedFetch.mockReset();
  sessionStorage.setItem('jimmy_opened', '1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

async function ask(question, reply) {
  authedFetch.mockResolvedValue(streamed(reply));
  renderWithLang(<ExpandableChat profile={{}} />);
  await userEvent.click(screen.getByText('🍓'));
  await userEvent.type(screen.getByPlaceholderText('Ask me anything...'), `${question}{Enter}`);
}

describe('Jimmy chat: how an answer is shown', () => {
  it('lays an answer out as headings, lists and tables, with no markdown marks showing', async () => {
    await ask('Is neem oil allowed?', '## Neem oil\n\n**Allowed** with limits:\n\n- Keep the label\n- Record the date\n\n| Item | Result |\n|---|---|\n| Neem | Allowed |');
    expect(await screen.findByRole('heading', { name: 'Neem oil' })).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Keep the label', 'Record the date']);
    expect(within(screen.getByRole('table')).getByText('Neem')).toBeTruthy();
    expect(screen.getByText('Allowed', { selector: 'strong' })).toBeTruthy();
    const answer = screen.getByRole('heading', { name: 'Neem oil' }).closest('[data-variant]');
    expect(answer.textContent).not.toMatch(/[#*|]{2}|^\s*##/m);
  });

  it('shows what the farmer typed exactly as typed', async () => {
    await ask('I use **kelp** and <b>neem</b>', 'Noted.');
    expect(await screen.findByText('I use **kelp** and <b>neem</b>')).toBeTruthy();
    expect(await screen.findByText('Noted.')).toBeTruthy();
  });

  it('never turns the model’s HTML into elements', async () => {
    await ask('hi', '<img src=x onerror="window.__chatHacked=1"> <script>window.__chatHacked=1</script> Hello');
    expect(await screen.findByText(/Hello/)).toBeTruthy();
    expect(document.querySelector('img[src="x"], script')).toBeNull();
    expect(window.__chatHacked).toBeUndefined();
  });

  it('does not let a link in an answer run script', async () => {
    await ask('hi', 'See [this](javascript:alert(1)) and [CDFA](https://www.cdfa.ca.gov/)');
    expect(await screen.findByRole('link', { name: 'CDFA' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'this' })).toBeNull();
  });
});
