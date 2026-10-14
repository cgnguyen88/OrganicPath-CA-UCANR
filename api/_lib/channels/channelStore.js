import { createClient } from '@supabase/supabase-js';
import { RECORD_COLUMNS } from '../agent/supabaseStore.js';

const CAPTURE_KEY = /^[0-9a-f]{64}$/;
const CHECK_VIOLATION = '23514';
const AUTH_OPTIONS = Object.freeze({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });

function dbError(error) {
  return Object.assign(new Error(error.message ?? 'Database error'), { code: error.code });
}

/**
 * Database access for chat channels (Telegram). A chat has no signed-in user, so row-level security
 * cannot protect these queries: the server role is used, and EVERY query here is scoped by the
 * linked identity (their user id and farm id), checked again in SQL where it matters. Nothing in
 * this file takes a farm or user id from message content.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ createClientImpl?: typeof createClient, agentStore: { insertRecords: Function, uploadAttachments: Function } }} deps
 */
export function createChannelStore(env = process.env, { createClientImpl = createClient, agentStore } = {}) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  let admin = null;
  const db = () => {
    if (!url || !serviceKey) throw new Error('Chat channels need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
    admin ??= createClientImpl(url, serviceKey, { auth: AUTH_OPTIONS });
    return admin;
  };

  return {
    /** Redeem a one-time link code. @returns {Promise<{ userId: string, farmId: string, lang: 'en' | 'es' } | null>} */
    async consumeLinkCode(provider, codeHash, externalId, displayName = null) {
      const { data, error } = await db().rpc('consume_channel_link_code', { p_provider: provider, p_code_hash: codeHash, p_external_id: externalId, p_display_name: displayName });
      if (error) throw dbError(error);
      const row = data?.[0];
      return row ? { userId: row.r_user_id, farmId: row.r_farm_id, lang: row.r_lang, farmName: row.r_farm_name, ownerHint: row.r_owner_hint } : null;
    },

    /** A link made with a code but not yet confirmed by the Telegram user (recent ones only). */
    async resolvePending(provider, externalId, since) {
      const { data, error } = await db().from('channel_identities').select('id, lang').eq('provider', provider).eq('external_id', externalId).is('confirmed_at', null).gte('linked_at', since).maybeSingle();
      if (error) throw dbError(error);
      return data ? { identityId: data.id, lang: data.lang } : null;
    },

    /** The Telegram user said yes. @returns {Promise<boolean>} */
    async confirmIdentity(provider, externalId) {
      const { data, error } = await db().rpc('confirm_channel_identity', { p_provider: provider, p_external_id: externalId });
      if (error) throw dbError(error);
      return data === true;
    },

    /** Who is behind this chat account? Null if nobody (or not yet confirmed), or if they no longer belong to the farm. */
    async resolveIdentity(provider, externalId) {
      const found = await db().from('channel_identities').select('id, user_id, farm_id, lang').eq('provider', provider).eq('external_id', externalId).not('confirmed_at', 'is', null).maybeSingle();
      if (found.error) throw dbError(found.error);
      if (!found.data) return null;
      const { id, user_id: userId, farm_id: farmId, lang } = found.data;
      const member = await db().from('farm_members').select('role').eq('user_id', userId).eq('farm_id', farmId).maybeSingle();
      if (member.error) throw dbError(member.error);
      return member.data ? { identityId: id, userId, farmId, lang, role: member.data.role } : null;
    },

    async setLang(identityId, lang) {
      const { error } = await db().from('channel_identities').update({ lang }).eq('id', identityId);
      if (error) throw dbError(error);
    },

    async unlink(identityId) {
      const { error } = await db().from('channel_identities').delete().eq('id', identityId);
      if (error) throw dbError(error);
    },

    /** True the first time an update is seen; false for a retry. */
    async claimUpdate(provider, updateId) {
      const { data, error } = await db().rpc('claim_channel_update', { p_provider: provider, p_update_id: updateId });
      if (error) throw dbError(error);
      if (typeof data !== 'boolean') throw new Error('The update claim returned no verdict.');
      return data;
    },

    async rememberMessage(provider, chatId, messageId, recordId) {
      const { error } = await db().from('channel_messages').insert({ provider, chat_id: chatId, message_id: messageId, record_id: recordId });
      if (error) throw dbError(error);
    },

    /** The record a bot message asked about, but only if it is this person's own, in their farm. */
    async recordForMessage({ provider, chatId, messageId, userId, farmId }) {
      const link = await db().from('channel_messages').select('record_id').eq('provider', provider).eq('chat_id', chatId).eq('message_id', messageId).maybeSingle();
      if (link.error) throw dbError(link.error);
      if (!link.data) return null;
      const record = await db().from('records').select(RECORD_COLUMNS).eq('id', link.data.record_id).eq('farm_id', farmId).eq('created_by', userId).maybeSingle();
      if (record.error) throw dbError(record.error);
      return record.data ?? null;
    },

    /** The most recent Telegram record of this person that is still waiting for details. */
    async latestOpenRecord({ userId, farmId, since }) {
      const { data, error } = await db()
        .from('records')
        .select(RECORD_COLUMNS)
        .eq('farm_id', farmId)
        .eq('created_by', userId)
        .eq('source', 'telegram')
        .eq('status', 'needs_info')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw dbError(error);
      return data?.[0] ?? null;
    },

    async findCapture({ farmId, captureHash }) {
      if (!CAPTURE_KEY.test(captureHash)) throw new Error('Invalid capture key.');
      const { data, error } = await db().from('records').select(RECORD_COLUMNS).eq('farm_id', farmId).like('source_ref', `${captureHash}#%`).order('source_ref', { ascending: true });
      if (error) throw dbError(error);
      return data ?? [];
    },

    insertRecords: (rows) => agentStore.insertRecords(rows),
    uploadAttachments: (args) => agentStore.uploadAttachments(args),

    /**
     * Apply a reply to the author's own open record through the guarded SQL function, which checks
     * the author, their farm and membership, the status and the version, and names the author in the history.
     * @returns {Promise<{ ok: true, row: object } | { ok: false, reason: 'conflict' | 'invalid' }>}
     */
    async updateRecord(actorId, farmId, recordId, expectedVersion, patch) {
      const { data, error } = await db().rpc('channel_update_record', { p_actor: actorId, p_farm_id: farmId, p_record_id: recordId, p_expected_version: expectedVersion, p_patch: patch });
      if (error) {
        if (error.code === CHECK_VIOLATION) return { ok: false, reason: 'invalid' };
        throw dbError(error);
      }
      return data?.length === 1 ? { ok: true, row: data[0] } : { ok: false, reason: 'conflict' };
    },
  };
}
