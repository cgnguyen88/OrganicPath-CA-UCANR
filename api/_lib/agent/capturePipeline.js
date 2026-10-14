import { redact } from '../httpUtils.js';
import { buildCaptureRows, CAPTURE_SOURCE, captureHashOf } from './captureRows.js';

const UNIQUE_VIOLATION = '23505';
/** A rejected or voided capture no longer counts as "already filed". */
const TERMINAL_STATUSES = ['rejected', 'voided'];
const MAX_REFILE_ATTEMPTS = 3;

/** A failure in one stage of the pipeline, so each caller can answer in its own way. */
export class PipelineError extends Error {
  /** @param {'lookup' | 'extract' | 'save'} stage @param {unknown} cause */
  constructor(stage, cause) {
    super(`capture pipeline failed at ${stage}`);
    this.name = 'PipelineError';
    this.stage = stage;
    this.cause = cause;
  }
}

/**
 * Read a message and/or files and file the records for review. Shared by every way in (the web
 * form, Telegram, ...): the caller has already authenticated the person and chosen their farm, and
 * supplies the database access as `ports` bound to that farm.
 *
 * @param {{
 *   ports: {
 *     findCapture: (captureHash: string) => Promise<object[]>,
 *     uploadAttachments: (q: { captureHash: string, attachments: object[] }) => Promise<object[]>,
 *     insertRecords: (rows: object[]) => Promise<object[]>,
 *   },
 *   extract: Function, anthropic: object, config: object,
 *   userId: string, farmId: string,
 *   text: string, attachments: object[], lang: 'en' | 'es', day: string,
 *   source?: string, logger: { error: Function, info: Function }, signal?: AbortSignal,
 * }} args
 * @returns {Promise<
 *   { outcome: 'duplicate', rows: object[] }
 *   | { outcome: 'empty', message: string, refused: boolean, flags: object }
 *   | { outcome: 'saved', rows: object[], message: string, flags: object, warnings: string[], usage: object }
 * >}
 * @throws {PipelineError}
 */
export async function runCapture({ ports, extract, anthropic, config, userId, farmId, text, attachments, day, source = CAPTURE_SOURCE, logger, signal }) {
  // ── Already captured? Answer without spending a model call ────────────────
  let captureHash;
  try {
    for (let attempt = 0; ; attempt += 1) {
      captureHash = captureHashOf({ text, attachments, userId, day, attempt });
      const existing = await ports.findCapture(captureHash);
      if (existing.length === 0) break;
      const stillLive = existing.some((row) => !TERMINAL_STATUSES.includes(row.status));
      if (stillLive || attempt >= MAX_REFILE_ATTEMPTS) return { outcome: 'duplicate', rows: existing };
    }
  } catch (err) {
    throw new PipelineError('lookup', err);
  }

  // ── Read ──────────────────────────────────────────────────────────────────
  let result;
  try {
    result = await extract({ anthropic, config, input: { text, attachments }, today: day, signal });
  } catch (err) {
    throw new PipelineError('extract', err);
  }

  const flags = { truncated: result.truncated, tooMany: result.tooMany, skipped: result.skippedProposals };
  if (result.refused || result.proposals.length === 0) {
    return { outcome: 'empty', message: result.message, refused: result.refused, flags };
  }

  // ── File for review ───────────────────────────────────────────────────────
  // Keep the source photo so a reviewer can check the record against it. Losing it is worse than
  // not having asked, but not worth losing the (paid-for) extraction: save the records and warn.
  const warnings = [];
  let storedFiles = [];
  if (attachments.length > 0) {
    try {
      storedFiles = await ports.uploadAttachments({ captureHash, attachments });
    } catch (err) {
      logger.error('[capture] storing the source files failed', { userId, farmId, reason: redact(err?.message ?? err) });
      warnings.push('files_not_saved');
    }
  }
  const rows = buildCaptureRows({ proposals: result.proposals, farmId, userId, captureHash, attachments: storedFiles, source });

  let saved;
  try {
    saved = await ports.insertRecords(rows);
  } catch (err) {
    if (err?.code === UNIQUE_VIOLATION) {
      // A concurrent request filed the same capture first.
      const existing = await ports.findCapture(captureHash).catch(() => []);
      if (existing.length > 0) return { outcome: 'duplicate', rows: existing };
    }
    throw new PipelineError('save', err);
  }

  logger.info('[capture] captured', { userId, farmId, source, records: saved.length, usage: result.usage });
  return { outcome: 'saved', rows: saved, message: result.message, flags, warnings, usage: result.usage };
}
