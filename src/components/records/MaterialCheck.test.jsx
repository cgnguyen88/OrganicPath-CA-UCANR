// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/agent.js', () => ({ checkMaterial: vi.fn() }));
const agent = await import('../../lib/agent.js');
const { default: MaterialCheck } = await import('./MaterialCheck.jsx');

const source = { citation: '7 CFR 205.601(i)', heading: 'Synthetic substances allowed for use in organic crop production.', excerpt: '(i) As plant disease control...', source_url: 'https://www.ecfr.gov/current/title-7/section-205.601', version_date: '2026-10-08' };
const result = (over = {}) => ({ data: { result: { verdict: 'listed_allowed', downgraded: false, refused: false, incomplete: false, summary: 'Allowed with limits.', caveats: ['Minimize copper buildup.'], sources: [source], ...over }, reminder: 'confirm_with_certifier' }, error: null });

const setup = (lang = 'en') => {
  const user = userEvent.setup();
  renderWithLang(<MaterialCheck />, lang);
  return user;
};
const ask = async (user, material = 'copper sulfate', use = '') => {
  await user.type(screen.getByRole('textbox', { name: /material|material/i }), material);
  if (use) await user.type(screen.getByRole('textbox', { name: /use|uso/i }), use);
  await user.click(screen.getByRole('button', { name: /^(check|revisar)/i }));
};

beforeEach(() => agent.checkMaterial.mockResolvedValue(result()));
afterEach(cleanup);

describe('MaterialCheck', () => {
  it('cannot ask until a material is typed', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Check' }).disabled).toBe(true);
  });

  it('sends the question and shows the verdict, summary, caveats and cited text', async () => {
    const user = setup();
    await ask(user, 'copper sulfate', 'tomato blight');
    expect(agent.checkMaterial).toHaveBeenCalledWith({ material: 'copper sulfate', use: 'tomato blight', lang: 'en' });
    expect(await screen.findByText('Named as allowed')).toBeTruthy();
    expect(screen.getByText('Allowed with limits.')).toBeTruthy();
    expect(screen.getByText('Minimize copper buildup.')).toBeTruthy();
    expect(screen.getByText('7 CFR 205.601(i)')).toBeTruthy();
    expect(screen.getByText(/As plant disease control/)).toBeTruthy();
  });

  it('links the cited text to eCFR in a new tab without leaking the opener', async () => {
    const user = setup();
    await ask(user);
    const link = await screen.findByRole('link', { name: /eCFR/ });
    expect(link.getAttribute('href')).toBe(source.source_url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });

  it('always reminds the worker to confirm with their certifier', async () => {
    const user = setup();
    await ask(user);
    expect((await screen.findByText(/not an approval/i)).textContent).toMatch(/certifier/);
  });

  it('says "not named" is not a prohibition', async () => {
    agent.checkMaterial.mockResolvedValue(result({ verdict: 'not_named', sources: [] }));
    const user = setup();
    await ask(user, 'kelp meal');
    expect(await screen.findByText('Not named in the regulations')).toBeTruthy();
    expect(screen.getByText(/does not mean it is prohibited/i)).toBeTruthy();
  });

  it('explains a result the assistant could not back with the regulation text', async () => {
    agent.checkMaterial.mockResolvedValue(result({ verdict: 'needs_review', downgraded: true, summary: '', caveats: [], sources: [] }));
    const user = setup();
    await ask(user);
    expect(await screen.findByText('Needs review')).toBeTruthy();
    expect(screen.getByText(/could not back an answer/i)).toBeTruthy();
  });

  it('renders the assistant’s text as plain text, never markup', async () => {
    agent.checkMaterial.mockResolvedValue(result({ summary: '<img src=x onerror="alert(1)">' }));
    const user = setup();
    await ask(user);
    expect(await screen.findByText(/<img src=x/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it.each([['rate_limited', /Too many requests/], ['unavailable', /not available/], ['signin', /sign in again/]])('explains a %s failure and keeps the question', async (code, message) => {
    agent.checkMaterial.mockResolvedValue({ data: null, error: { code } });
    const user = setup();
    await ask(user, 'keep me');
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(screen.getByRole('textbox', { name: /material/i }).value).toBe('keep me');
  });

  it('works in Spanish', async () => {
    const user = setup('es');
    await ask(user, 'aceite de neem');
    expect(agent.checkMaterial).toHaveBeenCalledWith(expect.objectContaining({ lang: 'es' }));
    expect(await screen.findByText('Nombrado como permitido')).toBeTruthy();
  });
});
