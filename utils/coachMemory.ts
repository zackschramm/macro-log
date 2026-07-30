import { supabase } from '../constants/supabase';

/**
 * Persistent Coach memory — the durable facts about a user that raw logs don't
 * capture: injuries, food dislikes, behavioural patterns, PRs, and advice
 * already given. Backed by public.coach_memories (see the 20260727 migration).
 *
 * Read path is used by buildCoachContext on every Coach call, so everything
 * here fails soft: a memory outage should degrade the Coach's personalisation,
 * never break the conversation.
 */

export type MemoryKind = 'preference' | 'constraint' | 'pattern' | 'fact' | 'directive';
export type MemorySource = 'stated' | 'inferred' | 'measured' | 'user_edited';

export interface CoachMemory {
  id: string;
  kind: MemoryKind;
  subject: string;
  content: string;
  confidence: number;
  source: MemorySource;
  confirmed_at: string;
}

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  constraint: 'Limits & restrictions',
  preference: 'Preferences',
  pattern: 'Habits I’ve noticed',
  fact: 'Milestones',
  directive: 'Advice already given',
};

/** Display order — constraints first because they're safety-relevant. */
export const MEMORY_KIND_ORDER: MemoryKind[] = [
  'constraint', 'preference', 'pattern', 'fact', 'directive',
];

export const MEMORY_SOURCE_LABELS: Record<MemorySource, string> = {
  stated: 'you told me',
  inferred: 'I picked this up',
  measured: 'from your data',
  user_edited: 'you edited this',
};

/**
 * Budgeted memories for the Coach prompt. Returns every active constraint plus
 * the top few of each other kind — the RPC does the ranking so the limits can't
 * drift between callers.
 */
export async function getCoachMemories(limits?: {
  preferences?: number; patterns?: number; facts?: number; directives?: number;
}): Promise<CoachMemory[]> {
  try {
    const { data, error } = await supabase.rpc('get_coach_memories', {
      p_preferences: limits?.preferences ?? 5,
      p_patterns: limits?.patterns ?? 3,
      p_facts: limits?.facts ?? 3,
      p_directives: limits?.directives ?? 3,
    });
    if (error) return [];
    return (data ?? []) as CoachMemory[];
  } catch {
    return [];
  }
}

/** Every active memory, for the "What Fuelog remembers" screen. */
export async function getAllCoachMemories(): Promise<CoachMemory[]> {
  try {
    const { data, error } = await supabase
      .from('coach_memories')
      .select('id, kind, subject, content, confidence, source, confirmed_at')
      .is('superseded_by', null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('confidence', { ascending: false })
      .order('confirmed_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as CoachMemory[];
  } catch {
    return [];
  }
}

/**
 * Record a memory. Re-observing an identical memory re-confirms it and nudges
 * confidence up; a contradicting one supersedes the old row rather than
 * overwriting it, so corrections stay auditable.
 */
export async function rememberFact(m: {
  kind: MemoryKind;
  subject: string;
  content: string;
  confidence?: number;
  source?: MemorySource;
  expiresAt?: Date | null;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('upsert_coach_memory', {
      p_kind: m.kind,
      p_subject: m.subject,
      p_content: m.content,
      p_confidence: m.confidence ?? 0.7,
      p_source: m.source ?? 'inferred',
      p_expires_at: m.expiresAt ? m.expiresAt.toISOString() : null,
    });
    if (error) return null;
    return (data as string) ?? null;
  } catch {
    return null;
  }
}

/** User correction from the memories screen — promoted to ground truth. */
export async function editCoachMemory(id: string, content: string): Promise<boolean> {
  const { error } = await supabase
    .from('coach_memories')
    .update({ content, source: 'user_edited', confidence: 1, confirmed_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

export async function forgetCoachMemory(id: string): Promise<boolean> {
  const { error } = await supabase.from('coach_memories').delete().eq('id', id);
  return !error;
}

export async function forgetAllCoachMemories(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from('coach_memories').delete().eq('user_id', user.id);
  return !error;
}

/**
 * Renders memories as the "WHAT I KNOW ABOUT THIS USER" prompt block.
 * Returns '' when there's nothing worth saying, so callers can skip the header.
 */
export function formatMemoriesForPrompt(memories: CoachMemory[]): string {
  if (memories.length === 0) return '';

  const byKind = new Map<MemoryKind, CoachMemory[]>();
  for (const m of memories) {
    const list = byKind.get(m.kind) ?? [];
    list.push(m);
    byKind.set(m.kind, list);
  }

  const lines: string[] = ['WHAT I KNOW ABOUT THIS USER:'];
  for (const kind of MEMORY_KIND_ORDER) {
    for (const m of byKind.get(kind) ?? []) {
      lines.push(`- [${kind}] ${m.content} (${m.source})`);
    }
  }

  // Constraints are the one category where being wrong causes harm, so they get
  // an explicit instruction rather than relying on the model to infer priority.
  if ((byKind.get('constraint') ?? []).length > 0) {
    lines.push(
      'Constraints are absolute — never suggest anything that violates one, ' +
      'even if the user asks for general advice.'
    );
  }
  if ((byKind.get('directive') ?? []).length > 0) {
    lines.push('Do not re-suggest advice listed above as already given and declined.');
  }

  return lines.join('\n');
}
