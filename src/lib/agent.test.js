import { describe, it, expect, vi } from 'vitest';

vi.mock('./apiClient.js', () => ({ authedFetch: vi.fn() }));
import { authedFetch } from './apiClient.js';
import { CAPTURE_MAX_FILES, CAPTURE_MAX_TOTAL_BYTES, prepareAttachments, captureRecords, replyToRecord, checkMaterial } from './agent.js';

const file = (name, type, size = 1000) => ({ name, type, size });
const encode = async (blob) => `b64(${blob.name})`;
const keep = async (f) => f; // downscale stub: unchanged
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });


describe('prepareAttachments', () => {
  it('turns photos and PDFs into the API’s base64 blocks', async () => {
    const out = await prepareAttachments([file('a.jpg', 'image/jpeg'), file('b.pdf', 'application/pdf')], { downscale: keep, encode });
    expect(out).toEqual({
      ok: true,
      attachments: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'b64(a.jpg)' } },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'b64(b.pdf)' } },
      ],
    });
  });

  it('accepts an empty list', async () => {
    expect(await prepareAttachments([], { downscale: keep, encode })).toEqual({ ok: true, attachments: [] });
  });

  it.each([['image/heic'], ['image/svg+xml'], ['text/html'], ['application/zip'], ['']])('rejects type %j', async (type) => {
    expect(await prepareAttachments([file('x', type)], { downscale: keep, encode })).toEqual({ ok: false, code: 'type' });
  });

  it('rejects more files than the server accepts', async () => {
    const many = Array.from({ length: CAPTURE_MAX_FILES + 1 }, (_, i) => file(`${i}.jpg`, 'image/jpeg'));
    expect(await prepareAttachments(many, { downscale: keep, encode })).toEqual({ ok: false, code: 'count' });
  });

  it('rejects files that are still too big after downscaling', async () => {
    const big = file('big.pdf', 'application/pdf', CAPTURE_MAX_TOTAL_BYTES + 1);
    expect(await prepareAttachments([big], { downscale: keep, encode })).toEqual({ ok: false, code: 'size' });
  });

  it('downscales photos (not PDFs) and sizes by the downscaled result', async () => {
    const downscale = vi.fn(async () => ({ name: 'small.jpg', type: 'image/jpeg', size: 200_000 }));
    const photo = file('huge.jpg', 'image/jpeg', CAPTURE_MAX_TOTAL_BYTES * 3);
    const pdf = file('p.pdf', 'application/pdf', 1000);
    const out = await prepareAttachments([photo, pdf], { downscale, encode });
    expect(out.ok).toBe(true);
    expect(downscale).toHaveBeenCalledTimes(1);
    expect(out.attachments[0].source.data).toBe('b64(small.jpg)');
  });

  it('reports an unreadable file instead of throwing', async () => {
    const out = await prepareAttachments([file('a.jpg', 'image/jpeg')], { downscale: keep, encode: async () => { throw new Error('boom'); } });
    expect(out).toEqual({ ok: false, code: 'read' });
  });
});

describe('captureRecords', () => {
  it('posts text, files and language, and returns the parsed result', async () => {
    authedFetch.mockResolvedValue(response(200, { records: [{ id: 'r1' }], message: '' }));
    const result = await captureRecords({ text: 'sprayed', attachments: [{ type: 'image' }], lang: 'es' });
    expect(result).toEqual({ data: { records: [{ id: 'r1' }], message: '' }, error: null });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/agent/capture');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ text: 'sprayed', attachments: [{ type: 'image' }], lang: 'es' });
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it.each([
    [401, 'signin'], [403, 'no_farm'], [413, 'too_large'], [429, 'rate_limited'], [400, 'invalid'],
    [500, 'unavailable'], [502, 'unavailable'], [503, 'unavailable'], [504, 'unavailable'],
  ])('maps HTTP %i to %s', async (status, code) => {
    authedFetch.mockResolvedValue(response(status, { error: 'server words' }));
    expect(await captureRecords({ text: 'x', attachments: [], lang: 'en' })).toEqual({ data: null, error: { code } });
  });

  it('maps being signed out to signin without sending anything', async () => {
    const signedOut = Object.assign(new Error('Please sign in'), { code: 'not_signed_in' });
    authedFetch.mockImplementation(async () => { throw signedOut; });
    expect(await captureRecords({ text: 'x', attachments: [], lang: 'en' })).toEqual({ data: null, error: { code: 'signin' } });
  });

  it('maps a network failure to network and an unreadable reply to unavailable', async () => {
    authedFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await captureRecords({ text: 'x', attachments: [], lang: 'en' })).error.code).toBe('network');
    authedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
    expect((await captureRecords({ text: 'x', attachments: [], lang: 'en' })).error.code).toBe('unavailable');
  });
});

describe('replyToRecord', () => {
  it('posts the answer for one record', async () => {
    authedFetch.mockResolvedValue(response(200, { record: { id: 'r1' }, applied: ['supplier'], rejected: [], message: '' }));
    const result = await replyToRecord({ recordId: 'r1', text: 'Johnnys', lang: 'en' });
    expect(result.data.record.id).toBe('r1');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/agent/reply');
    expect(JSON.parse(init.body)).toEqual({ record_id: 'r1', text: 'Johnnys', lang: 'en' });
  });

  it.each([[404, 'not_found'], [409, 'conflict'], [403, 'forbidden'], [422, 'invalid']])('maps HTTP %i to %s', async (status, code) => {
    authedFetch.mockResolvedValue(response(status, { error: 'x' }));
    expect(await replyToRecord({ recordId: 'r1', text: 'x', lang: 'en' })).toEqual({ data: null, error: { code } });
  });
});

describe('checkMaterial', () => {
  it('posts the material, use and language and returns the parsed result', async () => {
    authedFetch.mockResolvedValue(response(200, { result: { verdict: 'not_named' }, reminder: 'confirm_with_certifier' }));
    const out = await checkMaterial({ material: 'kelp meal', use: 'soil', lang: 'es' });
    expect(out).toEqual({ data: { result: { verdict: 'not_named' }, reminder: 'confirm_with_certifier' }, error: null });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/agent/check-material');
    expect(JSON.parse(init.body)).toEqual({ material: 'kelp meal', use: 'soil', lang: 'es' });
  });

  it.each([[401, 'signin'], [413, 'too_large'], [429, 'rate_limited'], [400, 'invalid'], [503, 'unavailable']])('maps HTTP %i to %s', async (status, code) => {
    authedFetch.mockResolvedValue(response(status, { error: 'x' }));
    expect(await checkMaterial({ material: 'x', use: '', lang: 'en' })).toEqual({ data: null, error: { code } });
  });
});
