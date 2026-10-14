import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient.js', () => ({ authedFetch: vi.fn() }));
const { authedFetch } = await import('../../lib/apiClient.js');
const { default: streamClaude } = await import('./streamClaude.js');

const encoder = new TextEncoder();
/** A response whose body arrives in the given pieces. */
const streaming = (pieces, init = {}) => ({
  ok: true,
  body: new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  }),
  ...init,
});
const chunk = (text) => `data: ${JSON.stringify({ delta: { text } })}\n`;
const openai = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`;

let chunks;
let errors;
const run = (prompt = 'hello') => streamClaude(prompt, (c) => chunks.push(c), (e) => errors.push(e));

beforeEach(() => {
  authedFetch.mockReset();
  chunks = [];
  errors = [];
});

describe('streamClaude', () => {
  it('asks the server for a streamed record-generator answer to the prompt', async () => {
    authedFetch.mockResolvedValue(streaming([]));
    await run('Write an audit');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/claude');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ messages: [{ role: 'user', content: 'Write an audit' }], mode: 'record_generator', stream: true });
  });

  it('hands over the text as it arrives, in order, for both shapes of stream', async () => {
    authedFetch.mockResolvedValue(streaming([chunk('One '), openai('two '), chunk('three')]));
    await run();
    expect(chunks).toEqual(['One ', 'two ', 'three']);
    expect(errors).toEqual([]);
  });

  it('puts together a line that arrives in pieces', async () => {
    const line = chunk('whole');
    authedFetch.mockResolvedValue(streaming([line.slice(0, 9), line.slice(9, 20), line.slice(20)]));
    await run();
    expect(chunks).toEqual(['whole']);
  });

  it('handles several lines in one piece', async () => {
    authedFetch.mockResolvedValue(streaming([chunk('a') + chunk('b') + chunk('c')]));
    await run();
    expect(chunks).toEqual(['a', 'b', 'c']);
  });

  it('stops when the server says it is done', async () => {
    authedFetch.mockResolvedValue(streaming([chunk('before'), 'data: [DONE]\n', chunk('after')]));
    await run();
    expect(chunks).toEqual(['before']);
  });

  it('skips lines that are not text: comments, blank lines, broken JSON, events without text', async () => {
    authedFetch.mockResolvedValue(streaming([': keep-alive\n', '\n', 'event: ping\n', `event: ${JSON.stringify({ delta: { text: 'NOT TEXT' } })}\n`, 'data: {not json}\n', 'data: {"delta":{}}\n', `data: ${JSON.stringify({ delta: { text: '' } })}\n`, chunk('real')]));
    await run();
    expect(chunks).toEqual(['real']);
    expect(errors).toEqual([]);
  });

  it('reports a refusal from the server, with its status', async () => {
    authedFetch.mockResolvedValue({ ok: false, status: 429 });
    await run();
    expect(errors).toEqual(['API 429']);
    expect(chunks).toEqual([]);
  });

  it('reports a failure to reach the server', async () => {
    authedFetch.mockRejectedValue(new Error('network down'));
    await run();
    expect(errors).toEqual(['network down']);
  });

  it('reports that the person has to sign in again', async () => {
    authedFetch.mockRejectedValue(Object.assign(new Error('Please sign in to use this feature.'), { code: 'not_signed_in' }));
    await run();
    expect(errors).toEqual(['Please sign in to use this feature.']);
  });

  it('reports a stream that breaks half way, after what it already handed over', async () => {
    authedFetch.mockResolvedValue({
      ok: true,
      body: (() => {
        let reads = 0;
        return new ReadableStream({
          pull(controller) {
            reads += 1;
            if (reads === 1) controller.enqueue(encoder.encode(chunk('partial')));
            else controller.error(new Error('connection lost'));
          },
        });
      })(),
    });
    await run();
    expect(chunks).toEqual(['partial']);
    expect(errors).toEqual(['connection lost']);
  });

  it('copes with multi-byte text split across pieces', async () => {
    const bytes = encoder.encode(chunk('mañana 😀'));
    const cut = bytes.indexOf(0xc3) + 1; // inside the two bytes of “ñ”
    authedFetch.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, cut));
          controller.enqueue(bytes.slice(cut));
          controller.close();
        },
      }),
    });
    await run();
    expect(chunks.join('')).toBe('mañana 😀');
  });
});
