import { callAI } from '../constants/ai';
import { MemoryKind, rememberFact } from './coachMemory';
import { logError } from './logError';

/**
 * "Bring your AI coach with you" — turn pasted text into Coach memories.
 *
 * WHY PASTE AND NOT SIGN-IN:
 * None of ChatGPT, Claude, or Gemini expose a consumer OAuth that lets a
 * third-party app read someone's chat history. A ChatGPT Plus subscription and
 * an API account are separate products, and no endpoint returns a user's
 * conversations. Asking for their password would be an App Store rejection and
 * a security problem; automating their session breaks all three providers'
 * terms. Pasting is the only route that is both possible and legitimate — and
 * it works with any AI, including ones that don't exist yet.
 *
 * PRIVACY: the pasted text is sent for extraction and then dropped. Only the
 * extracted fitness facts are stored, and every one is visible and deletable on
 * the Coach Memory screen. Anything unrelated to training is discarded — people
 * paste more than they mean to.
 */

export interface ImportedMemory {
  kind: MemoryKind;
  subject: string;
  content: string;
  confidence: number;
}

export interface ImportResult {
  memories: ImportedMemory[];
  saved: number;
  error?: string;
}

const MAX_INPUT_CHARS = 6000;

const SYSTEM = `You extract durable fitness facts from text a user pasted from another AI assistant.

Return ONLY a JSON array. No markdown, no prose. Each item:
{"kind":"constraint|preference|pattern|fact","subject":"short_slug","content":"one sentence","confidence":0.0-1.0}

kind meanings:
- constraint: injuries, allergies, dietary restrictions, medical limits. SAFETY-CRITICAL.
- preference: likes/dislikes about food or training
- pattern: habits and tendencies (schedule, adherence, behaviour)
- fact: PRs, measurements, milestones, experience level

RULES:
- ONLY include things relevant to training, nutrition, recovery, or body composition.
- DISCARD everything else — work, relationships, mental health, finances, medical
  detail not affecting exercise. If in doubt, leave it out.
- Do not invent. Only what the text actually states.
- content must be self-contained and readable on its own.
- confidence: 0.9 stated plainly, 0.7 implied, 0.5 uncertain.
- Max 15 items. Prefer the most useful.
- If nothing relevant, return []`;

function parseMemories(raw: string): ImportedMemory[] {
  let t = (raw || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  t = t.slice(start, end + 1);

  let arr: any;
  try {
    arr = JSON.parse(t);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const VALID: MemoryKind[] = ['constraint', 'preference', 'pattern', 'fact'];
  const out: ImportedMemory[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const kind = String(item.kind || '').toLowerCase() as MemoryKind;
    const content = String(item.content || '').trim();
    const subject = String(item.subject || '').trim().slice(0, 60).replace(/\s+/g, '_');
    if (!VALID.includes(kind) || !content || !subject) continue;
    if (content.length > 300) continue;               // runaway output
    let conf = Number(item.confidence);
    if (!Number.isFinite(conf)) conf = 0.7;
    out.push({ kind, subject, content, confidence: Math.min(1, Math.max(0.1, conf)) });
    if (out.length >= 15) break;
  }
  return out;
}

/**
 * Extract memories from pasted text WITHOUT saving them.
 * The user reviews first — silently writing inferred facts about someone's body
 * into their profile is exactly the kind of thing that erodes trust.
 */
export async function extractMemoriesFromText(text: string): Promise<ImportedMemory[]> {
  const input = (text || '').trim().slice(0, MAX_INPUT_CHARS);
  if (input.length < 20) return [];

  // 'local' tier: a parse/extract task is the ideal on-device workload — high
  // volume, cheap, and this is the most privacy-sensitive text in the app.
  // callAI silently falls back to the cloud when on-device isn't available.
  const raw = await callAI(
    [{ role: 'user', content: `Extract fitness facts from this text:\n\n${input}` }],
    SYSTEM,
    2048,
    'local'
  );
  return parseMemories(raw);
}

/** Persist the memories the user approved. Returns how many stuck. */
export async function saveImportedMemories(memories: ImportedMemory[]): Promise<number> {
  let saved = 0;
  for (const m of memories) {
    try {
      // source 'stated' — the user reviewed and approved each one, so these
      // outrank anything the Coach later infers on its own.
      const id = await rememberFact({
        kind: m.kind,
        subject: m.subject,
        content: m.content,
        confidence: m.confidence,
        source: 'stated',
      });
      if (id) saved++;
    } catch (e) {
      logError('importCoachMemories.save', e, { subject: m.subject });
    }
  }
  return saved;
}

/** Prompt we suggest users give their other AI, to get a useful paste. */
export const SUGGESTED_PROMPT =
  'Summarize everything you know about my training, nutrition, injuries, ' +
  'food preferences, and fitness goals. Be specific and factual.';
