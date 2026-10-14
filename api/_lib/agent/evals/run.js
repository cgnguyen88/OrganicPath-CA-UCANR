/**
 * Run the golden set against the REAL Anthropic API and print a scorecard.
 *
 *   npm run eval:agent -- --yes [--only en-spray-complete,es-harvest]
 *
 * This spends real money (one request per case), so it refuses to run without --yes.
 * It reads ANTHROPIC_API_KEY (and optional AGENT_* settings) from .env.local / the environment.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, resolveAnthropicKey } from '../../config.js';
import { extractRecords } from '../extract.js';
import { EVAL_TODAY, GOLDEN_CASES } from './golden.js';
import { scoreCase, summarize } from './score.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
dotenv.config({ path: join(root, '.env.local'), quiet: true });
dotenv.config({ path: join(root, '.env'), quiet: true });

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set((args[args.indexOf('--only') + 1] ?? '').split(',').filter(Boolean)) : null;
const cases = only ? GOLDEN_CASES.filter((c) => only.has(c.id)) : GOLDEN_CASES;

const config = loadConfig(process.env);
const { key } = resolveAnthropicKey(process.env);

if (!args.includes('--yes')) {
  console.info(`This will make ${cases.length} real API request(s) to ${config.agent.model} (effort ${config.agent.effort}, up to ${config.agent.maxTokens} output tokens each).`);
  console.info('It spends real money. Re-run with --yes to proceed.');
  process.exit(0);
}
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set (.env.local or environment).');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: key });
const scores = [];
const usage = { input_tokens: 0, output_tokens: 0 };

for (const testCase of cases) {
  try {
    const result = await extractRecords({ anthropic, config, input: { text: testCase.text }, today: EVAL_TODAY });
    const score = scoreCase(testCase, result);
    scores.push(score);
    usage.input_tokens += result.usage.input_tokens;
    usage.output_tokens += result.usage.output_tokens;
    console.info(`${score.pass ? 'PASS' : 'FAIL'}  ${testCase.id}${score.pass ? '' : `\n      ${score.failures.join('\n      ')}`}`);
  } catch (err) {
    scores.push({ pass: false, failures: [String(err?.message ?? err)] });
    console.info(`ERROR ${testCase.id}: ${err?.status ?? ''} ${String(err?.message ?? err).slice(0, 160)}`);
  }
}

const { total, passed } = summarize(scores);
console.info(`\n${passed}/${total} passed · model ${config.agent.model} · tokens in ${usage.input_tokens} / out ${usage.output_tokens}`);
process.exit(passed === total ? 0 : 1);
