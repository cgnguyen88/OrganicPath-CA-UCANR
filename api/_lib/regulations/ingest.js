/**
 * Load 7 CFR Part 205 into the `regulation_chunks` table.
 *
 *   curl -s --compressed -o part205.xml \
 *     "https://www.ecfr.gov/api/versioner/v1/full/<YYYY-MM-DD>/title-7.xml?part=205"
 *   npm run ingest:regulations -- --file part205.xml --date <YYYY-MM-DD>           # parse only (dry run)
 *   npm run ingest:regulations -- --file part205.xml --date <YYYY-MM-DD> --load    # write to Supabase
 *
 * <YYYY-MM-DD> is the eCFR "as of" date (https://www.ecfr.gov/api/versioner/v1/titles.json,
 * `up_to_date_as_of` for title 7). --load needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * (.env.local or the environment) and migrations 0-7 applied. Re-run whenever the regulations change.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseEcfrPart } from './parse.js';
import { loadChunks } from './load.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
dotenv.config({ path: join(root, '.env.local'), quiet: true });

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = option('--file');
const date = option('--date');

if (!file || !date) {
  console.error('Usage: npm run ingest:regulations -- --file part205.xml --date YYYY-MM-DD [--load]');
  process.exit(1);
}

const rows = parseEcfrPart(fs.readFileSync(file, 'utf8'), { versionDate: date });
console.info(`Parsed ${rows.length} chunks from ${new Set(rows.map((r) => r.section)).size} sections (eCFR as of ${date}).`);

if (!args.includes('--load')) {
  console.info('Dry run: nothing written. Add --load to write to Supabase.');
  process.exit(0);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('--load needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
console.info(`Loaded ${await loadChunks(client, rows)} chunks.`);
