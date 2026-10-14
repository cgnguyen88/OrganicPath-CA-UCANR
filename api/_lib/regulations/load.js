const DEFAULT_BATCH_SIZE = 100;

/**
 * Write parsed chunks to `regulation_chunks`. Idempotent: rows are keyed on (citation,
 * version_date), so re-running the same eCFR date replaces rather than duplicates.
 *
 * @param {{ from: (table: string) => { upsert: Function } }} client a Supabase client WITH the service-role key
 * @param {Array<object>} rows
 * @param {{ batchSize?: number }} [options]
 * @returns {Promise<number>} rows written
 */
export async function loadChunks(client, rows, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  if (rows.length === 0) throw new Error('There are no chunks to load.');
  let written = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { error } = await client.from('regulation_chunks').upsert(batch, { onConflict: 'citation,version_date' });
    if (error) throw new Error(`Loading stopped after ${written} of ${rows.length} chunks: ${error.message}`);
    written += batch.length;
  }
  return written;
}
