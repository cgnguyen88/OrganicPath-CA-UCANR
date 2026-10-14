import { createHash } from 'node:crypto';
import { summarizeRecord } from '../../../src/domain/records/schemas.js';
import { fieldLabel } from '../../../src/domain/records/labels.js';
import { RECORDS_TEXT } from '../../../src/components/records/text.js';
import { checkRateLimits, describeUpstreamError, redact } from '../httpUtils.js';
import { buildReplyPatch, farmToday, presentRecord } from '../agent/captureRows.js';
import { PipelineError, runCapture } from '../agent/capturePipeline.js';
import { extractRecords } from '../agent/extract.js';
import { readFieldNames } from '../agent/fieldNames.js';
import { applyReply } from '../agent/followup.js';
import { channelText } from './channelText.js';
import { TelegramApiError } from './telegramApi.js';
import { MAX_FILE_BYTES } from './telegramUpdate.js';

const PROVIDER = 'telegram';
const LINK_CODE = /^[0-9a-f]{32}$/;
const OPEN_QUESTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const PENDING_LINK_WINDOW_MS = 15 * 60 * 1000;
const YES_WORDS = new Set(['yes', 'y', 'si', 'confirm', 'confirmar']);
const NO_WORDS = new Set(['no', 'n', 'cancel', 'cancelar']);
const MAX_MODEL_TEXT_CHARS = 400;
const EDITABLE_STATUSES = ['draft', 'needs_info'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** "Sí." -> "si": lowercase, accents and trailing punctuation removed. */
const answerWord = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s.!¡?¿,;:]+$/g, '').trim();

/**
 * The assistant's own words, made safe to relay: web links, @mentions and /commands are removed (a
 * hostile photo could otherwise make the bot show a phishing link or a tappable /stop), and the length
 * is bounded. Telegram would still make a bare domain tappable, so those go too.
 */
function plainModelText(text) {
  return String(text ?? '')
    .replace(/\b(?:https?:\/\/|www\.|t\.me\/)\S*/gi, '')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|me|co|app|dev|ly|gl|xyz|info|biz|ru|cn|tk)\b\S*/gi, '')
    .replace(/@\w+/g, '')
    .replace(/(^|\s)\/\w+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_MODEL_TEXT_CHARS);
}

const languageOf = (code) => (typeof code === 'string' && code.toLowerCase().startsWith('es') ? 'es' : 'en');

/**
 * The conversation: decides what to do with one message from a chat and answers it. It knows
 * nothing about HTTP or webhooks (see telegramWebhook.js) and never reads a farm or user id from
 * the message: who someone is, and which farm they act in, comes only from the account they linked.
 *
 * Nothing the bot files is ever approved: records go to review, and a reply can only fill in the
 * details that were missing from the sender's own open record.
 *
 * @param {{
 *   config: object, store: object,
 *   telegram: { sendMessage: Function, sendChatAction: Function, downloadFile: Function },
 *   getAnthropic: () => object | null,
 *   extract?: Function, reply?: Function,
 *   limiters: { chat: object, stranger: { check: Function }, linking: { check: Function } },
 *   logger: { error: Function, warn: Function, info: Function },
 *   today?: () => string, now?: () => number,
 * }} deps
 */
export function createChannelHandler({ config, store, telegram, getAnthropic, extract = extractRecords, reply = applyReply, limiters, logger, today, now = Date.now }) {
  const todayFn = today ?? (() => farmToday(config.agent.timeZone));

  /** The linked farm's field names, to help the model spell a field the way the farm does (none if they cannot be read). */
  const fieldNamesOf = (farmId) => readFieldNames(store.listFieldNames ? () => store.listFieldNames({ farmId }) : undefined, logger);

  async function say(chatId, text, { recordId } = {}) {
    try {
      const { messageId } = await telegram.sendMessage({ chatId, text });
      if (recordId) await store.rememberMessage(PROVIDER, chatId, messageId, recordId).catch((err) => logger.warn('[telegram] could not remember a message', { reason: redact(err?.message ?? err) }));
      return messageId;
    } catch (err) {
      logger.warn('[telegram] could not send a message', { code: err?.code });
      return null;
    }
  }

  /** The lines describing filed records, and a separate question message for each one still incomplete. */
  async function describeRecords(chatId, rows, lang, headline, notices = []) {
    const t = channelText(lang);
    const lines = rows.map((row) => t.recordLine(summarizeRecord(row, lang), row.record_date));
    await say(chatId, [headline, lines.join('\n'), ...notices].filter(Boolean).join('\n\n'));
    for (const row of rows.filter((r) => r.status === 'needs_info')) {
      const { questions } = presentRecord(row, lang);
      if (questions.text) await say(chatId, t.needsDetails(summarizeRecord(row, lang), questions.text), { recordId: row.id });
    }
  }

  // ── People who have not linked their account ────────────────────────────────

  async function handleStranger(update) {
    const lang = languageOf(update.languageCode);
    const t = channelText(lang);
    const maySpeak = async () => (await limiters.stranger.check(update.userId)).allowed;

    // Step 1: a link code from the app. It makes a PENDING link and shows whose farm it is.
    if (update.command === 'start' && update.commandArg) {
      if (!LINK_CODE.test(update.commandArg) || !(await limiters.linking.check(update.userId)).allowed) {
        if (await maySpeak()) await say(update.chatId, t.linkFailed);
        return { action: 'link-failed' };
      }
      const pending = await store.consumeLinkCode(PROVIDER, createHash('sha256').update(update.commandArg).digest('hex'), update.userId, update.displayName);
      if (!pending) {
        if (await maySpeak()) await say(update.chatId, t.linkFailed);
        return { action: 'link-failed' };
      }
      await say(update.chatId, channelText(pending.lang).confirmPrompt(pending.farmName, pending.ownerHint));
      return { action: 'link-pending' };
    }

    // Step 2: the Telegram user answers YES or NO to "connect this chat to that farm?".
    if (!update.command && update.text) {
      const waiting = await store.resolvePending(PROVIDER, update.userId, new Date(now() - PENDING_LINK_WINDOW_MS).toISOString());
      if (waiting) {
        const wt = channelText(waiting.lang);
        const word = answerWord(update.text);
        if (YES_WORDS.has(word)) {
          const confirmed = await store.confirmIdentity(PROVIDER, update.userId);
          await say(update.chatId, confirmed ? wt.linked : wt.linkFailed);
          return { action: confirmed ? 'linked' : 'link-failed' };
        }
        if (NO_WORDS.has(word)) {
          await store.unlink(waiting.identityId);
          await say(update.chatId, wt.cancelled);
          return { action: 'link-cancelled' };
        }
        if (await maySpeak()) await say(update.chatId, wt.confirmHint);
        return { action: 'link-waiting' };
      }
    }

    if (await maySpeak()) await say(update.chatId, t.notLinked);
    return { action: 'not-linked' };
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  async function handleCommand(update, identity) {
    const t = channelText(identity.lang);
    switch (update.command) {
      case 'start':
        await say(update.chatId, t.alreadyLinked);
        return { action: 'already-linked' };
      case 'help':
        await say(update.chatId, t.help);
        return { action: 'help' };
      case 'lang': {
        const lang = update.commandArg.toLowerCase();
        if (lang !== 'en' && lang !== 'es') {
          await say(update.chatId, t.langUsage);
          return { action: 'lang-usage' };
        }
        await store.setLang(identity.identityId, lang);
        await say(update.chatId, channelText(lang).langSet[lang]);
        return { action: 'lang' };
      }
      case 'stop':
        await store.unlink(identity.identityId);
        await say(update.chatId, t.stopped);
        return { action: 'unlinked' };
      default:
        await say(update.chatId, t.unknownCommand);
        return { action: 'unknown-command' };
    }
  }

  // ── An answer to a question ─────────────────────────────────────────────────

  /** @returns {Promise<{ action: string } | null>} null when the message was not an answer (file it as new) */
  async function tryAnswer(update, identity, anthropic, day) {
    const t = channelText(identity.lang);
    let target = null;
    let explicit = false;
    if (update.replyToMessageId) {
      target = await store.recordForMessage({ provider: PROVIDER, chatId: update.chatId, messageId: update.replyToMessageId, userId: identity.userId, farmId: identity.farmId });
      explicit = Boolean(target);
    }
    target ??= await store.latestOpenRecord({ userId: identity.userId, farmId: identity.farmId, since: new Date(now() - OPEN_QUESTION_WINDOW_MS).toISOString() });
    if (!target) return null;

    if (!EDITABLE_STATUSES.includes(target.status)) {
      if (!explicit) return null;
      await say(update.chatId, t.recordNotEditable);
      return { action: 'record-not-editable' };
    }

    await telegram.sendChatAction({ chatId: update.chatId }).catch(() => {});
    const result = await reply({
      anthropic, config,
      draft: { kind: target.kind, record_date: target.record_date, payload: target.payload },
      replyText: update.text, today: day, allowedKeys: target.missing_fields ?? [],
      fieldNames: await fieldNamesOf(identity.farmId),
    });

    if (result.applied.length === 0) {
      // A model call was spent. A plain message that answered nothing is filed as new: the caller charges again.
      if (!explicit) return { fellThrough: true };
      const words = plainModelText(result.message);
      await say(update.chatId, words ? `${t.replyNothing}\n\n${words}` : t.replyNothing);
      return { action: 'answer-unusable' };
    }
    if (!result.evaluation?.ok) {
      await say(update.chatId, t.error);
      return { action: 'error' };
    }

    const outcome = await store.updateRecord(identity.userId, identity.farmId, target.id, target.version, buildReplyPatch(target.kind, result.evaluation));
    if (!outcome.ok) {
      await say(update.chatId, outcome.reason === 'conflict' ? t.recordChanged : t.error);
      return { action: 'answer-conflict' };
    }

    const summary = summarizeRecord({ kind: target.kind, payload: result.evaluation.value.payload }, identity.lang);
    const label = (key) => fieldLabel(target.kind, key, identity.lang, RECORDS_TEXT[identity.lang].form.date);
    // Say exactly what changed, so an answer matched to the wrong record is noticed at once.
    const changed = `\n${t.updated(result.applied.map(label).join(', '))}`;
    const ignored = result.rejected.length > 0 ? `\n\n${t.replyIgnored(result.rejected.map(label).join(', '))}` : '';
    if (result.evaluation.complete) {
      await say(update.chatId, `${t.replyDone(summary)}${changed}${ignored}`);
    } else {
      const { questions } = presentRecord(outcome.row, identity.lang);
      await say(update.chatId, `${t.replyMore(summary, questions.text)}${changed}${ignored}`, { recordId: target.id });
    }
    return { action: 'answered' };
  }

  // ── A new photo or message ──────────────────────────────────────────────────

  async function fetchAttachments(update, t) {
    const attachments = [];
    for (const file of update.files) {
      try {
        const bytes = await telegram.downloadFile(file.fileId, { maxBytes: MAX_FILE_BYTES });
        attachments.push({ type: IMAGE_TYPES.includes(file.mimeType) ? 'image' : 'document', source: { type: 'base64', media_type: file.mimeType, data: bytes.toString('base64') } });
      } catch (err) {
        await say(update.chatId, err instanceof TelegramApiError && err.code === 'too_large' ? t.fileTooLarge : t.downloadFailed);
        return null;
      }
    }
    return attachments;
  }

  async function capture(update, identity, anthropic, day) {
    const t = channelText(identity.lang);
    await telegram.sendChatAction({ chatId: update.chatId }).catch(() => {});

    const attachments = await fetchAttachments(update, t);
    if (!attachments) return { action: 'download-failed' };

    const { userId, farmId, lang } = identity;
    let outcome;
    try {
      outcome = await runCapture({
        ports: {
          findCapture: (captureHash) => store.findCapture({ farmId, captureHash }),
          uploadAttachments: ({ captureHash, attachments: files }) => store.uploadAttachments({ farmId, captureHash, attachments: files }),
          insertRecords: (rows) => store.insertRecords(rows),
          listFieldNames: store.listFieldNames ? () => store.listFieldNames({ farmId }) : undefined,
        },
        extract, anthropic, config, userId, farmId, text: update.text, attachments, day, source: PROVIDER, logger,
      });
    } catch (err) {
      if (!(err instanceof PipelineError)) throw err;
      if (err.stage === 'extract') {
        const { status } = describeUpstreamError(err.cause);
        logger.error('[telegram] extraction failed', { userId, upstreamStatus: err.cause?.status, errorName: err.cause?.name, detail: redact(err.cause?.message ?? err.cause) });
        await say(update.chatId, status === 429 || status === 503 ? t.busy : t.unavailable);
      } else {
        logger.error(`[telegram] ${err.stage} failed`, { userId, farmId, code: err.cause?.code, reason: redact(err.cause?.message ?? err.cause) });
        await say(update.chatId, t.error);
      }
      return { action: 'capture-failed' };
    }

    if (outcome.outcome === 'duplicate') {
      await describeRecords(update.chatId, outcome.rows, lang, t.duplicate);
      return { action: 'duplicate' };
    }
    if (outcome.outcome === 'empty') {
      await say(update.chatId, outcome.refused ? t.refused : [t.nothingFound, plainModelText(outcome.message)].filter(Boolean).join('\n\n'));
      return { action: 'nothing-found' };
    }

    const { flags, warnings } = outcome;
    const notices = [
      flags.truncated && t.truncated,
      flags.tooMany && t.tooMany,
      flags.skipped > 0 && t.skipped(flags.skipped),
      warnings.includes('files_not_saved') && t.filesNotSaved,
    ].filter(Boolean);
    await describeRecords(update.chatId, outcome.rows, lang, t.filedHeader(outcome.rows.length), notices);
    return { action: 'captured' };
  }

  // ── Entry point ─────────────────────────────────────────────────────────────

  /** Handle one parsed update. Never throws: a failure is logged and the person is told, plainly. */
  return async function handleUpdate(update) {
    let identity = null;
    try {
      identity = await store.resolveIdentity(PROVIDER, update.userId);
      if (!identity) return await handleStranger(update);

      const t = channelText(identity.lang);
      if (update.command) return await handleCommand(update, identity);
      if (update.unsupported) {
        await say(update.chatId, t.unsupported[update.unsupported] ?? t.unsupported.document);
        return { action: 'unsupported' };
      }
      if (update.tooLarge) {
        await say(update.chatId, t.fileTooLarge);
        return { action: 'too-large' };
      }

      const verdict = await checkRateLimits(limiters.chat, identity.userId);
      if (!verdict.allowed) {
        await say(update.chatId, verdict.scope === 'global' ? t.busy : t.rateLimited);
        return { action: 'rate-limited' };
      }
      const anthropic = getAnthropic();
      if (!anthropic) {
        logger.error('[telegram] ANTHROPIC_API_KEY is not configured on the server');
        await say(update.chatId, t.unavailable);
        return { action: 'unavailable' };
      }

      const day = todayFn();
      if (update.files.length === 0) {
        const answered = await tryAnswer(update, identity, anthropic, day);
        if (answered && !answered.fellThrough) return answered;
        if (answered?.fellThrough) {
          // That message already cost one model call as an answer attempt; filing it as new costs another.
          const again = await checkRateLimits(limiters.chat, identity.userId);
          if (!again.allowed) {
            await say(update.chatId, again.scope === 'global' ? t.busy : t.rateLimited);
            return { action: 'rate-limited' };
          }
        }
      }
      return await capture(update, identity, anthropic, day);
    } catch (err) {
      // Never log what the person wrote; the error text can name database or API details, so redact it.
      logger.error('[telegram] handling failed', { userId: identity?.userId, errorName: err?.name, code: err?.code, detail: redact(err?.message ?? err) });
      await say(update.chatId, channelText(identity?.lang ?? languageOf(update.languageCode)).error);
      return { action: 'error' };
    }
  };
}
