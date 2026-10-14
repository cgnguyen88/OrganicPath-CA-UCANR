/**
 * Turn a raw Telegram update into a small, validated message. This is where untrusted input from
 * the network enters, so everything is checked here and nothing else is passed along: only private
 * chats, only real people, only plain `message` updates, bounded text, and at most one file chosen
 * from the sizes Telegram offers.
 */

/** Largest file the bot will fetch. Base64 adds a third, and the agent accepts ~3.5 MB per file. */
export const MAX_FILE_BYTES = 2_500_000;
const MAX_TEXT_CHARS = 8000;
const MAX_ID_CHARS = 256;
const ALLOWED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const UNSUPPORTED_KINDS = ['voice', 'audio', 'video', 'video_note', 'sticker', 'animation', 'location', 'contact'];
// C0 controls except tab and newline, plus DEL.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MAX_NAME_CHARS = 64;
const COMMAND = /^\/([A-Za-z0-9_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSafeId = (value) => Number.isSafeInteger(value);
const isFileId = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
const sizeOk = (size) => size === undefined || (Number.isSafeInteger(size) && size >= 0 && size <= MAX_FILE_BYTES);

const ignore = (reason) => ({ ok: false, reason });

/** "Maria (@maria)" for showing to the person confirming a link; plain, short, no control characters. */
function displayNameOf(from) {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  const clean = (value) => (typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim() : '');
  const name = clean(from.first_name);
  const handle = /^[A-Za-z0-9_]{1,32}$/.test(from.username ?? '') ? `@${from.username}` : '';
  const shown = name && handle ? `${name} (${handle})` : name || handle;
  return shown ? shown.slice(0, MAX_NAME_CHARS) : null;
}

/** The file to send on, from a photo's sizes: the largest one that is small enough. */
function choosePhoto(sizes) {
  const usable = sizes.filter((p) => isObject(p) && isFileId(p.file_id) && sizeOk(p.file_size));
  const best = usable.at(-1);
  return best ? [{ fileId: best.file_id, kind: 'photo', mimeType: 'image/jpeg', size: best.file_size ?? 0 }] : [];
}

/**
 * @param {unknown} body the JSON Telegram posted to the webhook
 * @returns {{ ok: true, update: {
 *   updateId: number, userId: string, chatId: string, messageId: number, text: string,
 *   command: string | null, commandArg: string, replyToMessageId: number | null, displayName: string | null, languageCode: string | null,
 *   files: Array<{ fileId: string, kind: 'photo' | 'document', mimeType: string, size: number }>,
 *   unsupported: string | null, tooLarge: boolean,
 * } } | { ok: false, reason: string }}
 */
export function parseTelegramUpdate(body) {
  if (!isObject(body) || !isSafeId(body.update_id)) return ignore('invalid update');
  if (!isObject(body.message)) return ignore('ignored update type');

  const message = body.message;
  if (!isObject(message.chat) || message.chat.type !== 'private' || !isSafeId(message.chat.id)) return ignore('not a private chat');
  if (!isObject(message.from) || !isSafeId(message.from.id) || message.from.id <= 0) return ignore('no sender');
  // In a private chat the chat id IS the sender's id. A mismatch is not something Telegram sends.
  if (message.chat.id !== message.from.id) return ignore('chat does not belong to the sender');
  if (message.from.is_bot === true) return ignore('sent by a bot');
  if (!isSafeId(message.message_id)) return ignore('invalid update');

  const raw = typeof message.text === 'string' ? message.text : typeof message.caption === 'string' ? message.caption : '';
  const text = raw.replace(CONTROL_CHARS, '').trim().slice(0, MAX_TEXT_CHARS);

  let files = [];
  let tooLarge = false;
  let unsupported = UNSUPPORTED_KINDS.find((kind) => message[kind] !== undefined) ?? null;

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    files = choosePhoto(message.photo);
    tooLarge = files.length === 0;
  } else if (isObject(message.document)) {
    const doc = message.document;
    if (!isFileId(doc.file_id) || !ALLOWED_DOCUMENT_TYPES.includes(doc.mime_type)) {
      unsupported ??= 'document';
    } else if (!sizeOk(doc.file_size)) {
      tooLarge = true;
    } else {
      files = [{ fileId: doc.file_id, kind: 'document', mimeType: doc.mime_type, size: doc.file_size ?? 0 }];
    }
  }

  const match = COMMAND.exec(text);
  const command = match ? match[1].toLowerCase() : null;

  if (!text && files.length === 0 && !unsupported && !tooLarge) return ignore('empty message');

  return {
    ok: true,
    update: {
      updateId: body.update_id,
      userId: String(message.from.id),
      chatId: String(message.chat.id),
      messageId: message.message_id,
      text,
      command,
      commandArg: match ? (match[2] ?? '').trim() : '',
      replyToMessageId: isObject(message.reply_to_message) && isSafeId(message.reply_to_message.message_id) ? message.reply_to_message.message_id : null,
      displayName: displayNameOf(message.from),
      languageCode: typeof message.from.language_code === 'string' && message.from.language_code.length <= 10 ? message.from.language_code : null,
      files,
      unsupported,
      tooLarge,
    },
  };
}
