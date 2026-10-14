// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/agent.js', () => ({
  CAPTURE_FILE_ACCEPT: 'image/jpeg,application/pdf',
  CAPTURE_MAX_FILES: 3,
  prepareAttachments: vi.fn(),
  captureRecords: vi.fn(),
  replyToRecord: vi.fn(),
}));
const agent = await import('../../lib/agent.js');
const { default: CapturePanel } = await import('./CapturePanel.jsx');

const filed = { id: 'r1', kind: 'purchase', status: 'pending_review', record_date: '2026-10-11', payload: { product: 'Compost', supplier: 'Acme' }, missing_fields: [], version: 1, questions: { text: '', asked: [] } };
const waiting = { id: 'r2', kind: 'activity', status: 'needs_info', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B4' }, missing_fields: ['product', 'rate'], version: 1, questions: { text: 'I need a few details to finish this record:\n• Which product did you use?\n• At what mix rate?', asked: ['product', 'rate'] } };

const setup = (props = {}, lang = 'en') => {
  const onChanged = vi.fn();
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  const view = renderWithLang(<CapturePanel farm={{ id: 'farm-1' }} onChanged={onChanged} onNavigate={onNavigate} {...props} />, lang);
  return { user, onChanged, onNavigate, ...view };
};
const send = async (user, text = 'bought compost') => {
  await user.type(screen.getByRole('textbox', { name: /what happened|qué pasó/i }), text);
  await user.click(screen.getByRole('button', { name: /^(read it|leer)$/i }));
};
const ok = (data) => ({ data: { records: [], message: '', ...data }, error: null });

beforeEach(() => {
  agent.prepareAttachments.mockResolvedValue({ ok: true, attachments: [] });
  agent.captureRecords.mockResolvedValue(ok({ records: [filed] }));
});
afterEach(cleanup);

describe('CapturePanel: sending', () => {
  it('cannot submit until there is a message or a file', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Read it' }).disabled).toBe(true);
  });

  it('sends the message with the language and shows what was filed', async () => {
    const { user, onChanged } = setup();
    await send(user, 'bought compost from Acme');
    expect(agent.captureRecords).toHaveBeenCalledWith({ text: 'bought compost from Acme', attachments: [], lang: 'en' });
    expect(await screen.findByText('1 record filed')).toBeTruthy();
    expect(screen.getByText('Compost · Acme')).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('works in Spanish', async () => {
    const { user } = setup({}, 'es');
    await send(user, 'compré composta');
    expect(agent.captureRecords).toHaveBeenCalledWith(expect.objectContaining({ lang: 'es' }));
    expect(await screen.findByText('1 registro archivado')).toBeTruthy();
  });

  it('blocks a second submit while reading', async () => {
    let finish;
    agent.captureRecords.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { user } = setup();
    await send(user);
    expect(screen.getByRole('button', { name: 'Reading…' }).disabled).toBe(true);
    finish(ok({ records: [filed] }));
    await screen.findByText('1 record filed');
  });

  it('opens the review queue from the result', async () => {
    const { user, onNavigate } = setup();
    await send(user);
    await user.click(await screen.findByRole('button', { name: 'Open review queue' }));
    expect(onNavigate).toHaveBeenCalledWith('needsReview');
  });

  it('lets you capture another after a result', async () => {
    const { user } = setup();
    await send(user, 'first');
    await user.click(await screen.findByRole('button', { name: 'Capture another' }));
    expect(screen.queryByText('1 record filed')).toBeNull();
    expect(screen.getByRole('textbox', { name: /what happened/i }).value).toBe('');
  });
});

describe('CapturePanel: files', () => {
  const photo = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

  it('lists a chosen file, lets you remove it, and sends the prepared attachments', async () => {
    agent.prepareAttachments.mockResolvedValue({ ok: true, attachments: [{ type: 'image' }] });
    const { user } = setup();
    const input = document.querySelector('input[type="file"]');
    expect(input.accept).toBe('image/jpeg,application/pdf');
    await user.upload(input, photo);
    expect(screen.getByText('receipt.jpg')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Read it' }));
    await screen.findByText('1 record filed');
    expect(agent.prepareAttachments).toHaveBeenCalledWith([photo]);
    expect(agent.captureRecords).toHaveBeenCalledWith({ text: '', attachments: [{ type: 'image' }], lang: 'en' });
  });

  it('removes a file before sending', async () => {
    const { user } = setup();
    await user.upload(document.querySelector('input[type="file"]'), photo);
    await user.click(screen.getByRole('button', { name: /remove/i }));
    expect(screen.queryByText('receipt.jpg')).toBeNull();
    expect(screen.getByRole('button', { name: 'Read it' }).disabled).toBe(true);
  });

  it.each([['type', /JPG, PNG/], ['size', /too large/], ['read', /Could not read/]])('explains a %s problem and sends nothing', async (code, message) => {
    agent.prepareAttachments.mockResolvedValue({ ok: false, code });
    const { user } = setup();
    await user.upload(document.querySelector('input[type="file"]'), photo);
    await user.click(screen.getByRole('button', { name: 'Read it' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(agent.captureRecords).not.toHaveBeenCalled();
  });

  it('refuses more than three files', async () => {
    const { user } = setup();
    const files = ['a', 'b', 'c', 'd'].map((n) => new File(['x'], `${n}.jpg`, { type: 'image/jpeg' }));
    await user.upload(document.querySelector('input[type="file"]'), files);
    expect((await screen.findByRole('alert')).textContent).toMatch(/up to 3 files/);
    expect(screen.queryByText('d.jpg')).toBeNull();
  });
});

describe('CapturePanel: results', () => {
  it('shows a duplicate notice instead of a fresh result', async () => {
    agent.captureRecords.mockResolvedValue(ok({ records: [filed], duplicate: true }));
    const { user, onChanged } = setup();
    await send(user);
    expect(await screen.findByText(/already sent this one/i)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows the assistant’s words when nothing was found', async () => {
    agent.captureRecords.mockResolvedValue(ok({ records: [], message: 'That looks like a landscape photo.' }));
    const { user } = setup();
    await send(user);
    expect(await screen.findByText('No farm record found in that.')).toBeTruthy();
    expect(screen.getByText('That looks like a landscape photo.')).toBeTruthy();
  });

  it('says so when the assistant refused', async () => {
    agent.captureRecords.mockResolvedValue(ok({ refused: true }));
    const { user } = setup();
    await send(user);
    expect(await screen.findByText('The assistant could not read that.')).toBeTruthy();
  });

  it('warns about cut-short, capped and skipped output', async () => {
    agent.captureRecords.mockResolvedValue(ok({ records: [filed], truncated: true, tooMany: true, skipped: 2 }));
    const { user } = setup();
    await send(user);
    expect(await screen.findByText(/cut short/)).toBeTruthy();
    expect(screen.getByText(/first 10 records/)).toBeTruthy();
    expect(screen.getByText('2 items could not be read and were skipped.')).toBeTruthy();
  });

  it('tells you when the records were saved but the original photo could not be kept', async () => {
    agent.captureRecords.mockResolvedValue(ok({ records: [filed], warnings: ['files_not_saved'] }));
    const { user } = setup();
    await send(user);
    expect(await screen.findByText(/original photo could not be kept/i)).toBeTruthy();
  });

  it('ignores warning codes it does not know', async () => {
    agent.captureRecords.mockResolvedValue(ok({ records: [filed], warnings: ['something_new'] }));
    const { user } = setup();
    await send(user);
    await screen.findByText('1 record filed');
    expect(screen.queryByText(/something_new/)).toBeNull();
  });

  it('renders the assistant’s message as plain text, never as markup', async () => {
    agent.captureRecords.mockResolvedValue(ok({ records: [filed], message: '<img src=x onerror="alert(1)"><b>hi</b>' }));
    const { user, container } = setup();
    await send(user);
    expect(await screen.findByText(/<img src=x/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it.each([
    ['signin', /sign in again/], ['no_farm', /not part of a farm/], ['too_large', /too much/], ['rate_limited', /Too many requests/],
    ['unavailable', /not available/], ['network', /Could not reach/],
  ])('explains a %s failure and keeps what you typed', async (code, message) => {
    agent.captureRecords.mockResolvedValue({ data: null, error: { code } });
    const { user } = setup();
    await send(user, 'keep me');
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(screen.getByRole('textbox', { name: /what happened/i }).value).toBe('keep me');
  });
});

describe('CapturePanel: follow-up questions', () => {
  beforeEach(() => agent.captureRecords.mockResolvedValue(ok({ records: [filed, waiting] })));

  it('asks the questions for incomplete records only', async () => {
    const { user } = setup();
    await send(user);
    expect(await screen.findByText(/Which product did you use\?/)).toBeTruthy();
    expect(screen.getAllByRole('textbox', { name: 'Your answer' })).toHaveLength(1);
  });

  it('sends the answer and updates the record in place', async () => {
    const answered = { ...waiting, status: 'pending_review', payload: { activity_type: 'spray', field: 'B4', product: 'Neem', rate: '2 oz/gal' }, missing_fields: [], version: 2, questions: { text: '', asked: [] } };
    agent.replyToRecord.mockResolvedValue({ data: { record: answered, applied: ['product', 'rate'], rejected: [], message: '' }, error: null });
    const { user, onChanged } = setup();
    await send(user);
    await user.type(await screen.findByRole('textbox', { name: 'Your answer' }), 'Neem, 2 oz per gallon');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(agent.replyToRecord).toHaveBeenCalledWith({ recordId: 'r2', text: 'Neem, 2 oz per gallon', lang: 'en' });
    const updated = await screen.findByText(/^Updated:/);
    expect(updated.textContent).toMatch(/Product/);
    expect(updated.textContent).toMatch(/rate/i);
    await waitFor(() => expect(screen.queryByText(/Which product did you use/)).toBeNull());
    expect(screen.queryByRole('textbox', { name: 'Your answer' })).toBeNull();
    expect(screen.getAllByText('Needs review')).toHaveLength(2);
    expect(onChanged).toHaveBeenCalledTimes(2); // capture + reply
  });

  it('shows the model’s follow-up and what it could not use, keeping the record waiting', async () => {
    agent.replyToRecord.mockResolvedValue({ data: { record: waiting, applied: [], rejected: ['rate'], message: 'What was the mix rate?' }, error: null });
    const { user } = setup();
    await send(user);
    await user.type(await screen.findByRole('textbox', { name: 'Your answer' }), 'um');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText('What was the mix rate?')).toBeTruthy();
    expect(screen.getByText(/Could not use:/).textContent).toMatch(/Rate|rate|Mix/i);
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeTruthy();
  });

  it('explains a failed reply on that record without losing the others', async () => {
    agent.replyToRecord.mockResolvedValue({ data: null, error: { code: 'conflict' } });
    const { user } = setup();
    await send(user);
    await user.type(await screen.findByRole('textbox', { name: 'Your answer' }), 'Neem');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/changed while you were answering/);
    expect(screen.getByText('Compost · Acme')).toBeTruthy();
    expect(within(alert).queryByText('Compost · Acme')).toBeNull();
  });

  it('does not send an empty answer', async () => {
    const { user } = setup();
    await send(user);
    expect((await screen.findByRole('button', { name: 'Send answer' })).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('button', { name: 'Send answer' }).closest('form'));
    expect(agent.replyToRecord).not.toHaveBeenCalled();
  });
});
