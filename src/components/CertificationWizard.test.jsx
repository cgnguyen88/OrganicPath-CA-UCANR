// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
vi.mock('../lib/db.js', () => ({ debouncedSync: vi.fn() }));
const { authedFetch } = await import('../lib/apiClient.js');
const { default: CertificationWizard } = await import('./CertificationWizard.jsx');

/** A streamed reply that arrives in two pieces, in the shape the wizard reads. */
function streamed(...pieces) {
  const chunks = [...pieces.map((text) => `data: ${JSON.stringify({ delta: { text } })}\n\n`), 'data: [DONE]\n\n'].map((c) => new TextEncoder().encode(c));
  let i = 0;
  const read = async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true });
  return { ok: true, body: { getReader: () => ({ read }) } };
}

const emptyData = {
  operationName: 'Palo Verde Farm', ownerName: '', address: '', city: '', county: 'Yolo', state: 'CA', zip: '', phone: '', email: '',
  operationType: 'crop', crops: 'tomatoes', acreage: '', grossSales: '', registrationPath: '', landFreeYears: '', lastProhibitedSubstance: '',
  practices: '', inputs: '', monitoring: '', buffers: '', allowedChecked: {}, prohibitedChecked: {}, certifierName: '', certifierContact: '', certifierId: '', registrationNotes: '',
};

beforeEach(() => {
  authedFetch.mockReset();
  localStorage.clear();
  localStorage.setItem('orgpath_wizard_progress', JSON.stringify({ step: 3, data: emptyData }));
});
afterEach(cleanup);

async function suggestPractices(...pieces) {
  authedFetch.mockResolvedValue(streamed(...pieces));
  const onUpdateProfile = vi.fn();
  renderWithLang(<CertificationWizard profile={{}} onUpdateProfile={onUpdateProfile} onNavigate={() => {}} userId={null} />);
  await userEvent.click(screen.getAllByRole('button', { name: /Generate AI Suggestion/ })[0]);
  return onUpdateProfile;
}

describe('Wizard: AI suggestions for a form field', () => {
  it('asks the server for a plain-text suggestion for the field', async () => {
    await suggestPractices('Rotate beds.');
    await screen.findByText('Rotate beds.');
    const body = JSON.parse(authedFetch.mock.calls[0][1].body);
    expect(body.mode).toBe('wizard_suggest');
  });

  it('keeps the field free of markdown marks, even if the model used them', async () => {
    const onUpdateProfile = await suggestPractices('## Practices\n\n**Compost** and cover crops:\n\n', '- Rotate beds\n- Apply compost');
    await screen.findByText('Rotate beds');
    const saved = onUpdateProfile.mock.calls.at(-1)[0].practices;
    expect(saved).toBe('Practices\n\nCompost and cover crops:\n\n• Rotate beds\n• Apply compost');
    expect(saved).not.toMatch(/[#*]/);
  });

  it('shows the suggestion as a list, and the textarea holds clean text when the farmer edits it', async () => {
    await suggestPractices('Cover crops:\n\n- Rotate beds\n- Apply compost');
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Rotate beds', 'Apply compost']);
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const box = screen.getByDisplayValue(/Cover crops:/);
    expect(box.value).toBe('Cover crops:\n\n• Rotate beds\n• Apply compost');
    expect(within(document.body).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows what a farmer typed earlier with markdown in it as formatted text', async () => {
    localStorage.setItem('orgpath_wizard_progress', JSON.stringify({ step: 3, data: { ...emptyData, practices: '**Mulch** every spring' } }));
    renderWithLang(<CertificationWizard profile={{}} onUpdateProfile={() => {}} onNavigate={() => {}} userId={null} />);
    expect(await screen.findByText('Mulch', { selector: 'strong' })).toBeTruthy();
  });
});
