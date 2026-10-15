// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

vi.mock('../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
const { authedFetch } = await import('../lib/apiClient.js');
const { saveAs } = await import('file-saver');
const { default: OSPGenerator } = await import('./OSPGenerator.jsx');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GENERATED = [
  '## 1. Operation Information', '', '**Operation name:** Palo Verde Farm', '', 'Legal name: [NEEDS OPERATOR INPUT: owner legal name]', '',
  '## 2. Soil Fertility', '', '- Compost applied each spring', '- Cover crops every winter', '', '| Input | Source |', '|---|---|', '| Kelp meal | Sea Co |',
].join('\n');

function streamed(...pieces) {
  const chunks = [...pieces.map((text) => `data: ${JSON.stringify({ delta: { text } })}\n\n`), 'data: [DONE]\n\n'].map((c) => new TextEncoder().encode(c));
  let i = 0;
  const read = async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true });
  return { ok: true, body: { getReader: () => ({ read }) } };
}
const json = (text) => ({ ok: true, json: async () => ({ content: [{ text }] }) });

beforeEach(() => {
  authedFetch.mockReset();
  saveAs.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

async function openFillStep(user) {
  renderWithLang(<OSPGenerator profile={{ operationName: 'Palo Verde Farm', county: 'Yolo' }} onUpdateProfile={() => {}} onNavigate={() => {}} userId={null} />);
  await user.click(screen.getAllByRole('button').find((b) => /CCOF/.test(b.textContent)));
  await user.click(screen.getByRole('button', { name: /Continue to Fill Details/ }));
  await screen.findByRole('button', { name: /Generate OSP/ });
}

/** Opens the form sections one by one until one has an AI Suggest button. */
async function openFirstAiField(user) {
  const toggles = screen.getAllByRole('button').filter((b) => /Required|Optional/.test(b.textContent));
  for (const toggle of toggles) {
    if (screen.queryAllByRole('button', { name: /AI Suggest/ }).length) break;
    await user.click(toggle);
  }
  return screen.getAllByRole('button', { name: /AI Suggest/ })[0];
}

describe('OSP Generator: AI Suggest in a form field', () => {
  it('puts clean text in the field, even when the model used markdown', async () => {
    const user = userEvent.setup();
    authedFetch.mockResolvedValue(streamed('## Plan\n\n**Compost** each spring:\n\n', '- Rotate beds\n- Add kelp'));
    await openFillStep(user);
    await user.click(await openFirstAiField(user));
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Rotate beds', 'Add kelp']);
    expect(JSON.parse(authedFetch.mock.calls[0][1].body).mode).toBe('osp_field');
    await user.click(screen.getByRole('button', { name: /Edit/ }));
    const box = screen.getAllByRole('textbox').find((t) => t.value.includes('Rotate beds'));
    expect(box.value).toBe('Plan\n\nCompost each spring:\n\n• Rotate beds\n• Add kelp');
  });
});

describe('OSP Generator: the finished plan', () => {
  async function generate(user) {
    authedFetch.mockResolvedValue(json(GENERATED));
    await openFillStep(user);
    await user.click(screen.getByRole('button', { name: /Generate OSP/ }));
    await user.click(await screen.findByRole('button', { name: /Generate .*OSP with AI/ }));
    await screen.findByRole('heading', { name: '1. Operation Information' });
  }

  it('shows the plan as a document: headings, a list, a table, and a badge where the farmer must fill something in', async () => {
    const user = userEvent.setup();
    await generate(user);
    expect(screen.getByRole('heading', { name: '2. Soil Fertility' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Compost applied each spring', 'Cover crops every winter']);
    expect(within(screen.getByRole('table')).getByText('Kelp meal')).toBeTruthy();
    expect(screen.getByText(/NEEDS INPUT/).textContent).toContain('owner legal name');
    expect(document.body.textContent).not.toMatch(/\*\*|\[NEEDS OPERATOR INPUT/);
  });

  it('asks the server for the plan in markdown, with the sections the document is laid out from', async () => {
    const user = userEvent.setup();
    await generate(user);
    const body = JSON.parse(authedFetch.mock.calls.at(-1)[1].body);
    expect(body.mode).toBe('osp_generate');
    expect(body.messages[0].content).toMatch(/## for section headings/);
  });

  it('exports the plan as a Word document', async () => {
    const user = userEvent.setup();
    await generate(user);
    await user.click(screen.getByRole('button', { name: /Export as Word/ }));
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toMatch(/^OSP_Palo_Verde_Farm_\d{4}-\d{2}-\d{2}\.docx$/);
    expect(blob.type).toBe(DOCX);
  });

  it('says so when details were changed after the plan was written, and not before', async () => {
    const user = userEvent.setup();
    await generate(user);
    expect(screen.queryByText(/You changed details after this plan was written/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Edit Details/ }));
    await screen.findByRole('button', { name: /Generate OSP/ });
    await user.type(screen.getAllByRole('textbox')[0], 'x');
    await user.click(screen.getByRole('button', { name: /Generate OSP/ }));
    expect(await screen.findByText(/You changed details after this plan was written/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Regenerate/ }));
    await waitFor(() => expect(screen.queryByText(/You changed details after this plan was written/)).toBeNull());
  });

  it('puts the plan’s headings below the preview title', async () => {
    const user = userEvent.setup();
    await generate(user);
    expect(screen.getByRole('heading', { name: 'ORGANIC SYSTEM PLAN (OSP)' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { name: '1. Operation Information' }).tagName).toBe('H3');
  });
});

