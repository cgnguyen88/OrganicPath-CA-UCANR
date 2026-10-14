import { createClient } from '@supabase/supabase-js';

/** Columns the agent endpoints read back. Provenance (source, source_ref) stays server-side. */
export const RECORD_COLUMNS = 'id, farm_id, kind, status, record_date, payload, missing_fields, confidence, version, created_by, attachments';
const CAPTURE_KEY = /^[0-9a-f]{64}$/;
const NOT_PERMITTED = '42501';
const CHECK_VIOLATION = '23514';

const FILES_BUCKET = 'record-files';
const FILE_EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUTH_OPTIONS = Object.freeze({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });

function dbError(error) {
  return Object.assign(new Error(error.message ?? 'Database error'), { code: error.code });
}

/**
 * Database access for the agent endpoints. It deliberately acts as the CALLER for everything it
 * can (their JWT plus the public anon key, so row-level security decides), and uses the
 * service-role key for exactly one thing: inserting captured records, because the columns that
 * mark where a record came from (`source`, `source_ref`) and who authored it are not writable by
 * users.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ createClientImpl?: typeof createClient }} [deps]
 */
export function createAgentStore(env = process.env, { createClientImpl = createClient } = {}) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const asUser = (token) => {
    if (!url || !anonKey) throw new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY.');
    return createClientImpl(url, anonKey, { auth: AUTH_OPTIONS, global: { headers: { Authorization: `Bearer ${token}` } } });
  };

  let admin = null;
  const asService = () => {
    if (!url || !serviceKey) throw new Error('Saving captured records needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
    admin ??= createClientImpl(url, serviceKey, { auth: AUTH_OPTIONS });
    return admin;
  };

  return {
    /** The caller's farm: their oldest membership. @returns {Promise<{ farmId: string, role: string } | null>} */
    async resolveMembership(token, userId) {
      const { data, error } = await asUser(token)
        .from('farm_members')
        .select('farm_id, role')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (error) throw dbError(error);
      return data?.[0] ? { farmId: data[0].farm_id, role: data[0].role } : null;
    },

    /** Records already filed for this capture key (empty when it is new). */
    async findCapture(token, { farmId, captureHash }) {
      // The key is interpolated into a LIKE pattern: only a plain SHA-256 hex digest is allowed.
      if (!CAPTURE_KEY.test(captureHash)) throw new Error('Invalid capture key.');
      const { data, error } = await asUser(token)
        .from('records')
        .select(RECORD_COLUMNS)
        .eq('farm_id', farmId)
        .like('source_ref', `${captureHash}#%`)
        .order('source_ref', { ascending: true });
      if (error) throw dbError(error);
      return data ?? [];
    },

    /** The only service-role write. Rows come from buildCaptureRows(), never from a client. */
    async insertRecords(rows) {
      const { data, error } = await asService().from('records').insert(rows).select(RECORD_COLUMNS);
      if (error) throw dbError(error);
      return data ?? [];
    },

    /**
     * Keep the original photos/PDFs of a capture in the private bucket, under the farm's folder,
     * so a reviewer can compare a record with its source. Idempotent (a retry overwrites the same
     * paths). Server-only: the bucket has no client write policy.
     *
     * @returns {Promise<Array<{ path: string, media_type: string, bytes: number }>>}
     */
    async uploadAttachments({ farmId, captureHash, attachments }) {
      // Both ids become path segments: only a uuid and a SHA-256 digest are allowed.
      if (!UUID.test(farmId) || !CAPTURE_KEY.test(captureHash)) throw new Error('Invalid storage path.');
      const files = attachments.map((file, index) => {
        const extension = FILE_EXTENSIONS[file.source.media_type];
        if (!extension) throw new Error(`Unsupported media type: ${file.source.media_type}`);
        return { index, extension, mediaType: file.source.media_type, bytes: Buffer.from(file.source.data, 'base64') };
      });

      const bucket = asService().storage.from(FILES_BUCKET);
      const manifest = [];
      for (const { index, extension, mediaType, bytes } of files) {
        const path = `${farmId}/${captureHash}/${index}.${extension}`;
        const { error } = await bucket.upload(path, bytes, { contentType: mediaType, upsert: true });
        if (error) throw dbError(error);
        manifest.push({ path, media_type: mediaType, bytes: bytes.length });
      }
      return manifest;
    },

    /**
     * Ranked passages of 7 CFR 205 for a query (see migration 7). Runs as the caller: only signed-in
     * users can search, and no service role is involved.
     */
    async searchRegulations(token, query, limit = 6) {
      const { data, error } = await asUser(token).rpc('search_regulations', { search_query: query, max_results: limit });
      if (error) throw dbError(error);
      return data ?? [];
    },

    /**
     * Take one token from a shared (database-backed) rate limit. Server-only: the caller passes the
     * subject it has already authenticated, and the limits are chosen by the server, never a client.
     *
     * @returns {Promise<{ allowed: boolean, retry_after_sec: number }>}
     */
    async takeRateToken(bucket, subject, max, windowSeconds) {
      const { data, error } = await asService().rpc('take_rate_token', { p_bucket: bucket, p_subject: subject, p_max: max, p_window_seconds: windowSeconds });
      if (error) throw dbError(error);
      if (typeof data?.[0]?.allowed !== 'boolean') throw new Error('The rate limit function returned no verdict.');
      return data[0];
    },

    /** One record, or null if it does not exist or row-level security hides it. */
    async loadRecord(token, id) {
      const { data, error } = await asUser(token).from('records').select(RECORD_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw dbError(error);
      return data ?? null;
    },

    /**
     * Update guarded by the version that was read (optimistic concurrency).
     * @returns {Promise<{ ok: true, row: object } | { ok: false, reason: 'conflict' | 'forbidden' | 'invalid' }>}
     */
    async updateRecord(token, id, expectedVersion, patch) {
      const client = asUser(token);
      const { data, error } = await client.from('records').update(patch).eq('id', id).eq('version', expectedVersion).select(RECORD_COLUMNS);
      if (error) {
        if (error.code === NOT_PERMITTED) return { ok: false, reason: 'forbidden' };
        if (error.code === CHECK_VIOLATION) return { ok: false, reason: 'invalid' };
        throw dbError(error);
      }
      if (data?.length === 1) return { ok: true, row: data[0] };

      // Nothing matched: either someone changed the record first, or row-level security refused.
      const { data: now, error: reloadError } = await client.from('records').select(RECORD_COLUMNS).eq('id', id).maybeSingle();
      if (reloadError) throw dbError(reloadError);
      return { ok: false, reason: now && now.version !== expectedVersion ? 'conflict' : 'forbidden' };
    },
  };
}
