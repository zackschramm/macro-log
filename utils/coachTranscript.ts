import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { logError } from './logError';

/**
 * The Coach transcript, stored on the user's ACCOUNT rather than the device.
 *
 * Supabase (`public.coach_messages`) is the source of truth, so the
 * conversation survives a reinstall and follows the user to a new phone.
 * AsyncStorage remains as a per-user offline cache — it paints the thread
 * instantly on open and keeps Coach readable with no signal — but it is never
 * the authority, and it is namespaced by user id so one account can no longer
 * inherit another's conversation on a shared device.
 */

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
  source?: 'local' | 'cloud';
}

/** Client-side window. The server keeps more (see trim_coach_messages). */
export const MAX_HISTORY = 50;

const cacheKeyFor = (userId: string) => `fuelog_coach_history_${userId}`;
// Exchanges whose server write failed (offline, or the coach_messages table
// not yet migrated) wait here and are replayed before the next fetch. Without
// this, "server wins" quietly destroyed any conversation the server never
// received — the council's silent-data-loss finding.
const outboxKeyFor = (userId: string) => `fuelog_coach_outbox_${userId}`;

type OutboxRow = { user_id: string; role: string; content: string; client_id: string | null };

async function readOutbox(userId: string): Promise<OutboxRow[]> {
  try {
    const raw = await AsyncStorage.getItem(outboxKeyFor(userId));
    return raw ? (JSON.parse(raw) as OutboxRow[]) : [];
  } catch { return []; }
}

/**
 * Push queued rows to the server. Returns true when the outbox is empty
 * afterwards (nothing queued, or everything flushed). The upsert is idempotent
 * via client_id, so replaying after a half-failure cannot duplicate messages.
 */
async function flushOutbox(userId: string): Promise<boolean> {
  const rows = await readOutbox(userId);
  if (rows.length === 0) return true;
  try {
    const { error } = await supabase
      .from('coach_messages')
      .upsert(rows, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
    if (error) throw error;
    await AsyncStorage.removeItem(outboxKeyFor(userId)).catch(() => {});
    return true;
  } catch (e) {
    logError('coachTranscript.flushOutbox', e);
    return false;
  }
}

/**
 * Read the thread. Cache first so the UI can paint immediately, then the
 * server, which wins when it answers.
 */
export async function loadCachedTranscript(userId: string): Promise<CoachMessage[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(cacheKeyFor(userId));
    return raw ? (JSON.parse(raw) as CoachMessage[]) : [];
  } catch {
    return [];
  }
}

export async function fetchTranscript(userId: string): Promise<CoachMessage[] | null> {
  if (!userId) return null;
  // Unsynced exchanges go up FIRST. If they cannot (offline, table missing),
  // the server's view is incomplete and must not overwrite the cache — treat
  // it exactly like being offline and let the cache stand.
  const flushed = await flushOutbox(userId);
  if (!flushed) return null;
  try {
    // Newest-first on seq — insertion order, immune to the identical
    // created_at both rows of an exchange share (council finding: ordering by
    // created_at rendered every synced exchange answer-before-question).
    // Reversed here so the UI gets chronological.
    const { data, error } = await supabase
      .from('coach_messages')
      .select('role, content, seq')
      .eq('user_id', userId)
      .order('seq', { ascending: false })
      .limit(MAX_HISTORY);
    if (error) throw error;
    const rows = (data ?? []).slice().reverse();
    const msgs: CoachMessage[] = rows.map((r: any) => ({ role: r.role, content: r.content }));
    // Keep the offline cache in step with what the account actually holds.
    await AsyncStorage.setItem(cacheKeyFor(userId), JSON.stringify(msgs)).catch?.(() => {});
    return msgs;
  } catch (e) {
    // Offline or RLS trouble: the caller keeps whatever the cache painted.
    logError('coachTranscript.fetch', e);
    return null;
  }
}

/**
 * Append one exchange. `clientId` makes the insert idempotent, so a retry after
 * a dropped response cannot double-post the user's question.
 */
export async function appendMessages(
  userId: string,
  msgs: CoachMessage[],
  clientId?: string,
): Promise<void> {
  if (!userId || msgs.length === 0) return;
  try {
    const rows: OutboxRow[] = msgs.map((m, i) => ({
      user_id: userId,
      role: m.role,
      content: m.content,
      client_id: clientId ? `${clientId}:${i}` : null,
    }));
    const { error } = await supabase
      .from('coach_messages')
      .upsert(rows, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
    if (error) throw error;
    // Best-effort: a failed trim must never fail a send.
    supabase.rpc('trim_coach_messages', { p_keep: 200 }).then(undefined, () => {});
  } catch (e) {
    logError('coachTranscript.append', e);
    // Bank the exchange for replay instead of losing it to the next
    // server-wins fetch. Rows without a client_id get one derived from time so
    // the replay upsert stays idempotent.
    try {
      const rows: OutboxRow[] = msgs.map((m, i) => ({
        user_id: userId,
        role: m.role,
        content: m.content,
        client_id: clientId ? `${clientId}:${i}` : `outbox-${Date.now()}:${i}`,
      }));
      const existing = await readOutbox(userId);
      await AsyncStorage.setItem(outboxKeyFor(userId), JSON.stringify([...existing, ...rows]));
    } catch { /* the cache still holds the thread for this device */ }
  }
}

/** Mirror the visible thread into the offline cache. */
export async function cacheTranscript(userId: string, msgs: CoachMessage[]): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(cacheKeyFor(userId), JSON.stringify(msgs.slice(-MAX_HISTORY)));
  } catch {
    // Cache is a convenience; losing it costs nothing.
  }
}

/** Clear the thread on both sides. */
export async function clearTranscript(userId: string): Promise<void> {
  if (!userId) return;
  await AsyncStorage.removeItem(cacheKeyFor(userId)).catch(() => {});
  // A cleared thread must not resurrect from queued rows.
  await AsyncStorage.removeItem(outboxKeyFor(userId)).catch(() => {});
  try {
    const { error } = await supabase.from('coach_messages').delete().eq('user_id', userId);
    if (error) throw error;
  } catch (e) {
    logError('coachTranscript.clear', e);
  }
}
