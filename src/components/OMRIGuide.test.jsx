// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
const { authedFetch } = await import('../lib/apiClient.js');
const { default: OMRIGuide } = await import('./OMRIGuide.jsx');

const ASSESSMENT = [
  'STATUS: Allowed with Restrictions', '', '## Reasoning', '', 'Neem oil is allowed under **§205.601(e)** when it has no synthetic additives.', '',
  '## Key Concerns', '', '- Check for synthetic solvents', '- Keep the label on file', '', '## Verification Step', '', 'Search omri.org for the exact product.',
].join('\n');

const reply = (text) => ({ ok: true, json: async () => ({ content: [{ text }]}) });

beforeEach(() => authedFetch.mockReset().mockResolvedValue(reply(ASSESSMENT)));
afterEach(cleanup);

async function verify(user, material = 'Neem oil') {
  render(<OMRIGuide />);
  await user.click(screen.getByRole('button', { name: /Verify a Material/ }));
  await user.type(screen.getByPlaceholderText(/PyGanic EC 5.0/), material);
  await user.click(screen.getByRole('button', { name: /Check OMRI Compliance/ }));
  await screen.findByRole('status');
}

describe('OMRI assistant: the assessment', () => {
  it('shows the verdict as a labelled badge, with no emoji and no "STATUS:" line', async () => {
    const user = userEvent.setup();
    await verify(user);
    expect(within(screen.getByRole('status')).getByText('Allowed with Restrictions')).toBeTruthy();
    expect(screen.queryByText(/STATUS:/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/[✅❌❓⚠]/);
  });

  it('lays the written assessment out as headed sections and a list', async () => {
    const user = userEvent.setup();
    await verify(user);
    for (const name of ['Reasoning', 'Key Concerns', 'Verification Step']) expect(screen.getByRole('heading', { name })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Check for synthetic solvents', 'Keep the label on file']);
    expect(screen.getByText('§205.601(e)', { selector: 'strong' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\*\*|## /);
  });

  it('asks for the plain STATUS layout and no emoji', async () => {
    const user = userEvent.setup();
    await verify(user);
    const prompt = JSON.parse(authedFetch.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain('MATERIAL NAME: Neem oil');
    expect(prompt).toMatch(/STATUS: <one of exactly: Likely Allowed, Allowed with Restrictions, Likely Prohibited, Cannot Determine>/);
    expect(prompt).not.toMatch(/[✅❌❓⚠]/);
  });

  it.each([
    ['Likely Allowed', 'Likely Allowed'],
    ['Likely Prohibited', 'Likely Prohibited'],
    ['Cannot Determine', 'Cannot Determine — verify at omri.org'],
  ])('shows "%s" as its own badge', async (verdict, label) => {
    authedFetch.mockResolvedValue(reply(`STATUS: ${verdict}\n\n## Reasoning\n\nBecause.`));
    const user = userEvent.setup();
    await verify(user);
    expect(within(screen.getByRole('status')).getByText(label)).toBeTruthy();
  });

  it('still shows an answer that has no verdict line, without a badge', async () => {
    authedFetch.mockResolvedValue(reply('Some general guidance.'));
    const user = userEvent.setup();
    render(<OMRIGuide />);
    await user.click(screen.getByRole('button', { name: /Verify a Material/ }));
    await user.type(screen.getByPlaceholderText(/PyGanic EC 5.0/), 'Kelp');
    await user.click(screen.getByRole('button', { name: /Check OMRI Compliance/ }));
    expect(await screen.findByText('Some general guidance.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces the result to screen readers, because the panel is a live region', async () => {
    const user = userEvent.setup();
    await verify(user);
    const panel = screen.getByRole('status').closest('[aria-live]');
    expect(panel.getAttribute('aria-live')).toBe('polite');
    expect(panel.contains(screen.getByRole('heading', { name: 'Reasoning' }))).toBe(true);
  });

  it('puts the headings of the assessment below its own heading', async () => {
    const user = userEvent.setup();
    await verify(user);
    expect(screen.getByRole('heading', { name: "Jimmy's Assessment" }).tagName).toBe('H4');
    expect(screen.getByRole('heading', { name: 'Reasoning' }).tagName).toBe('H5');
  });

  it('writes the verdict in a colour dark enough to read', async () => {
    const user = userEvent.setup();
    await verify(user);
    expect(screen.getByText('Allowed with Restrictions').style.color).toBe('rgb(180, 83, 9)');
  });
});
