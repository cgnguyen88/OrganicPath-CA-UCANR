// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
const { authedFetch } = await import('../../lib/apiClient.js');
const { saveAs } = await import('file-saver');
const { default: OSPUpdateWorkflow } = await import('./OSPUpdateWorkflow.jsx');
const { default: ActionResponse } = await import('./ActionResponse.jsx');
const { default: InspectorPrep } = await import('./InspectorPrep.jsx');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DRAFT = '## Summary of Annual Changes\n\nNew field: **North Block**.\n\n- Added kelp meal\n- Added drip lines\n\n| Item | Status |\n|---|---|\n| Kelp | Listed |';

/** A streamed reply in the shape the maintenance screens read. */
function streamed(text) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ delta: { text } })}\n\ndata: [DONE]\n\n`);
  let sent = false;
  const read = async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes }));
  return { ok: true, body: { getReader: () => ({ read }) } };
}

const profile = { operationName: 'Palo Verde Farm', certifierName: 'CCOF', operationType: 'crop', county: 'Yolo' };

beforeEach(() => {
  authedFetch.mockReset().mockResolvedValue(streamed(DRAFT));
  saveAs.mockReset();
});
afterEach(cleanup);

/** Every screen that shows an AI draft should lay it out as a document and let it leave the app cleanly. */
async function expectDocumentBehaviour(user, { filenamePattern }) {
  expect(await screen.findByRole('heading', { name: 'Summary of Annual Changes' })).toBeTruthy();
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Added kelp meal', 'Added drip lines']);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByText('North Block', { selector: 'strong' })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/\*\*|## /);

  await user.click(screen.getByRole('button', { name: /Copy/ }));
  const copied = await navigator.clipboard.readText();
  expect(copied).toContain('Summary of Annual Changes');
  expect(copied).toContain('• Added kelp meal');
  expect(copied).toContain('Kelp\tListed');
  expect(copied).not.toMatch(/\*\*|##|\|---/);

  await user.click(screen.getByRole('button', { name: /Download Word/ }));
  await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
  const [blob, name] = saveAs.mock.calls[0];
  expect(name).toMatch(filenamePattern);
  expect(blob.type).toBe(DOCX);
  expect(blob.size).toBeGreaterThan(1000);
}

describe('Annual OSP Update', () => {
  it('shows the draft as a document, copies clean text, and downloads a Word file', async () => {
    const user = userEvent.setup();
    render(<OSPUpdateWorkflow profile={profile} />);
    await user.click(screen.getByRole('button', { name: /Generate §205.406 Update Document/ }));
    await expectDocumentBehaviour(user, { filenamePattern: /^OSP-Update-\d{4}-Palo-Verde-Farm\.docx$/ });
  });

  it('asks for sections under headings and does not ask for numbered capitals', async () => {
    const user = userEvent.setup();
    render(<OSPUpdateWorkflow profile={profile} />);
    await user.click(screen.getByRole('button', { name: /Generate §205.406 Update Document/ }));
    await screen.findByRole('heading', { name: 'Summary of Annual Changes' });
    const prompt = JSON.parse(authedFetch.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toMatch(/each under its own ## heading/);
    expect(prompt).not.toMatch(/1\. HEADER|2\. SUMMARY OF ANNUAL CHANGES/);
  });
});

describe('Corrective Action Response', () => {
  it('shows the draft as a document, copies clean text, and downloads a Word file', async () => {
    const user = userEvent.setup();
    render(<ActionResponse profile={profile} />);
    await user.type(screen.getByPlaceholderText(/Paste or summarize the finding/), 'Records for the north block were incomplete.');
    await user.click(screen.getByRole('button', { name: /Draft Corrective Action Response/ }));
    await expectDocumentBehaviour(user, { filenamePattern: /^Corrective-Action-Response-\d{4}-\d{2}-\d{2}\.docx$/ });
  });
});

describe('Inspector Prep', () => {
  it('shows the draft as a document, copies clean text, and downloads a Word file', async () => {
    const user = userEvent.setup();
    render(<InspectorPrep profile={profile} />);
    await user.click(screen.getByText('Document Portfolio'));
    await expectDocumentBehaviour(user, { filenamePattern: /^Document-Portfolio\.docx$/ });
  });
});

/** A reply that delivers `text` and then breaks, like a dropped connection. */
function breaking(text) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`);
  let sent = false;
  const read = async () => {
    if (!sent) { sent = true; return { done: false, value: bytes }; }
    throw new Error('connection lost');
  };
  return { ok: true, body: { getReader: () => ({ read }) } };
}

describe('When the writing fails halfway', () => {
  const expectNothingToSave = async () => {
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('connection lost');
    const draft = screen.getByRole('heading', { name: 'Half a draft' }).closest('[data-variant]');
    expect(draft.textContent).not.toContain('connection lost');
    expect(screen.getByRole('button', { name: /Download Word/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy' }).disabled).toBe(true);
  };

  beforeEach(() => authedFetch.mockReset().mockResolvedValue(breaking('## Half a draft')));

  it('keeps the error out of the OSP update and switches Copy and Download off', async () => {
    const user = userEvent.setup();
    render(<OSPUpdateWorkflow profile={profile} />);
    await user.click(screen.getByRole('button', { name: /Generate §205.406 Update Document/ }));
    await expectNothingToSave();
  });

  it('keeps the error out of the corrective action response and switches Copy and Download off', async () => {
    const user = userEvent.setup();
    render(<ActionResponse profile={profile} />);
    await user.type(screen.getByPlaceholderText(/Paste or summarize the finding/), 'Records were incomplete.');
    await user.click(screen.getByRole('button', { name: /Draft Corrective Action Response/ }));
    await expectNothingToSave();
  });

  it('keeps the error out of the inspector pack and switches Copy and Download off', async () => {
    const user = userEvent.setup();
    render(<InspectorPrep profile={profile} />);
    await user.click(screen.getByText('Document Portfolio'));
    await expectNothingToSave();
  });

  it('shows only the error, and no buttons, when nothing at all was written', async () => {
    authedFetch.mockResolvedValue({ ok: false, status: 500 });
    const user = userEvent.setup();
    render(<InspectorPrep profile={profile} />);
    await user.click(screen.getByText('Document Portfolio'));
    expect((await screen.findByRole('alert')).textContent).toContain('API 500');
    expect(screen.queryByRole('button', { name: /Download Word/ })).toBeNull();
    expect(screen.queryByText(/Jimmy is generating/)).toBeNull();
  });
});

