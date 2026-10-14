import { describe, it, expect } from 'vitest';
import { parseTelegramUpdate, MAX_FILE_BYTES } from './telegramUpdate.js';

const base = (message = {}, extra = {}) => ({
  update_id: 100,
  message: { message_id: 7, date: 1_760_000_000, chat: { id: 555, type: 'private' }, from: { id: 555, is_bot: false, language_code: 'es' }, ...message },
  ...extra,
});
const ok = (body) => { const r = parseTelegramUpdate(body); expect(r.ok, JSON.stringify(r)).toBe(true); return r.update; };
const ignored = (body) => { const r = parseTelegramUpdate(body); expect(r.ok).toBe(false); return r.reason; };

describe('parseTelegramUpdate: text', () => {
  it('turns a text message into a normalized message', () => {
    expect(ok(base({ text: '  Sprayed neem on B2  ' }))).toMatchObject({
      updateId: 100, userId: '555', chatId: '555', messageId: 7, text: 'Sprayed neem on B2', languageCode: 'es',
      command: null, files: [], unsupported: null, tooLarge: false, replyToMessageId: null,
    });
  });

  it('treats a caption as the text of a photo', () => {
    const u = ok(base({ caption: 'receipt from Acme', photo: [{ file_id: 'a', file_unique_id: 'ua', width: 90, height: 90, file_size: 1000 }] }));
    expect(u.text).toBe('receipt from Acme');
    expect(u.files).toHaveLength(1);
  });

  it('records which message a reply answers', () => {
    expect(ok(base({ text: 'Neem', reply_to_message: { message_id: 42 } })).replyToMessageId).toBe(42);
  });

  it('strips control characters from text', () => {
    expect(ok(base({ text: 'a\u0000b\u0007c\nd' })).text).toBe('abc\nd');
  });
});

describe('parseTelegramUpdate: who sent it', () => {
  it('names the sender for the person being asked to confirm a link, bounded and without control characters', () => {
    expect(ok(base({ text: 'hi', from: { id: 555, is_bot: false, first_name: 'Maria', username: 'maria_g' } })).displayName).toBe('Maria (@maria_g)');
    expect(ok(base({ text: 'hi', from: { id: 555, is_bot: false, first_name: 'Maria' } })).displayName).toBe('Maria');
    expect(ok(base({ text: 'hi', from: { id: 555, is_bot: false, username: 'maria_g' } })).displayName).toBe('@maria_g');
    expect(ok(base({ text: 'hi' })).displayName).toBeNull();
    const long = ok(base({ text: 'hi', from: { id: 555, is_bot: false, first_name: `Ma\u0000ria\n${'x'.repeat(200)}` } })).displayName;
    expect(long.length).toBeLessThanOrEqual(64);
    // eslint-disable-next-line no-control-regex -- the point is that none remain
    expect(long).not.toMatch(/[\u0000-\u001F]/);
  });
});

describe('parseTelegramUpdate: commands', () => {
  it.each([
    ['/start abc123', 'start', 'abc123'],
    ['/start', 'start', ''],
    ['/start@MyFarmBot abc123', 'start', 'abc123'],
    ['/lang es', 'lang', 'es'],
    ['/HELP', 'help', ''],
    ['/stop', 'stop', ''],
  ])('reads %j as command %s with argument %j', (text, command, arg) => {
    expect(ok(base({ text }))).toMatchObject({ command, commandArg: arg });
  });

  it('does not treat a slash in the middle, or a path, as a command', () => {
    expect(ok(base({ text: 'mix 2/3 oz' })).command).toBeNull();
    expect(ok(base({ text: '/etc/passwd stuff' })).command).toBeNull();
  });
});

describe('parseTelegramUpdate: files', () => {
  const sizes = [
    { file_id: 'small', file_unique_id: 's', width: 90, height: 60, file_size: 4_000 },
    { file_id: 'mid', file_unique_id: 'm', width: 320, height: 240, file_size: 40_000 },
    { file_id: 'big', file_unique_id: 'b', width: 1280, height: 960, file_size: 300_000 },
    { file_id: 'huge', file_unique_id: 'h', width: 4000, height: 3000, file_size: MAX_FILE_BYTES + 1 },
  ];

  it('picks the largest photo size that is small enough to send on', () => {
    expect(ok(base({ photo: sizes })).files).toEqual([{ fileId: 'big', kind: 'photo', mimeType: 'image/jpeg', size: 300_000 }]);
  });

  it('says so when every size is too large', () => {
    const u = ok(base({ photo: [sizes[3]] }));
    expect(u).toMatchObject({ files: [], tooLarge: true });
  });

  it('accepts an image or PDF sent as a file', () => {
    expect(ok(base({ document: { file_id: 'd1', file_unique_id: 'u', mime_type: 'application/pdf', file_name: 'invoice.pdf', file_size: 90_000 } })).files)
      .toEqual([{ fileId: 'd1', kind: 'document', mimeType: 'application/pdf', size: 90_000 }]);
    expect(ok(base({ document: { file_id: 'd2', file_unique_id: 'u2', mime_type: 'image/png', file_size: 1000 } })).files[0].mimeType).toBe('image/png');
  });

  it('flags a file that is too large, or not a supported type', () => {
    expect(ok(base({ document: { file_id: 'd3', file_unique_id: 'u3', mime_type: 'application/pdf', file_size: MAX_FILE_BYTES + 1 } }))).toMatchObject({ files: [], tooLarge: true });
    expect(ok(base({ document: { file_id: 'd4', file_unique_id: 'u4', mime_type: 'application/zip', file_size: 10 } }))).toMatchObject({ files: [], unsupported: 'document' });
    expect(ok(base({ document: { file_id: 'd5', file_unique_id: 'u5', file_size: 10 } }))).toMatchObject({ files: [], unsupported: 'document' });
  });

  it.each(['voice', 'audio', 'video', 'video_note', 'sticker', 'animation', 'location', 'contact'])('flags %s as not supported yet', (kind) => {
    expect(ok(base({ [kind]: { file_id: 'x', file_unique_id: 'y' } })).unsupported).toBe(kind);
  });
});

describe('parseTelegramUpdate: what is ignored', () => {
  it.each([
    ['not an object', 'hello', /invalid/],
    ['null', null, /invalid/],
    ['no update id', { message: base().message }, /invalid/],
    ['a string update id', { update_id: '1', message: base().message }, /invalid/],
    ['an edited message', { update_id: 1, edited_message: base().message }, /ignored/],
    ['a button press', { update_id: 1, callback_query: { id: 'x' } }, /ignored/],
    ['a channel post', { update_id: 1, channel_post: base().message }, /ignored/],
  ])('ignores %s', (_n, body, reason) => {
    expect(ignored(body)).toMatch(reason);
  });

  it.each(['group', 'supergroup', 'channel'])('ignores messages in a %s: the bot only talks in private chats', (type) => {
    expect(ignored(base({ chat: { id: -100, type } }))).toMatch(/private/);
  });

  it('ignores messages from bots', () => {
    expect(ignored(base({ chat: { id: 9, type: 'private' }, from: { id: 9, is_bot: true } }))).toMatch(/bot/);
  });

  it('ignores a "private" message whose chat is not the sender’s own (a forged chat id would send replies to someone else)', () => {
    expect(ignored(base({ chat: { id: 999, type: 'private' }, from: { id: 555, is_bot: false } }))).toMatch(/chat/);
  });

  it('ignores a message with no sender, or a sender id that is not a number', () => {
    expect(ignored(base({ from: undefined }))).toMatch(/sender/);
    expect(ignored(base({ from: { id: 'abc', is_bot: false } }))).toMatch(/sender/);
  });

  it('ignores a message with nothing in it', () => {
    expect(ignored(base({}))).toMatch(/empty/);
  });

  it('keeps ids as safe integers only', () => {
    expect(ignored({ update_id: 1.5, message: base().message })).toMatch(/invalid/);
    expect(ignored({ update_id: Number.MAX_SAFE_INTEGER + 10, message: base().message })).toMatch(/invalid/);
  });
});

describe('parseTelegramUpdate: size of text', () => {
  it('bounds the text it passes on', () => {
    expect(ok(base({ text: 'x'.repeat(50_000) })).text.length).toBeLessThanOrEqual(8000);
  });
});
