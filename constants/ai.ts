import { supabase } from './supabase';
import { isLocalAIAvailable, generateLocalAI } from '../modules/fuelog-native';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

/**
 * Feature flag for the hybrid AI system (fuelog-hybrid-ai-plan.md).
 * When false, every call goes to the ai-proxy edge function exactly as before.
 */
export const LOCAL_AI_ENABLED = true;

/**
 * Auth headers for ANY direct fetch to the ai-proxy edge function.
 *
 * The proxy's auth gate resolves the bearer via auth.getUser(), which cannot
 * resolve the anon key — so a hardcoded `Bearer ANON_KEY` gets a 401 on every
 * request. That is exactly what happened to food search in build 161: six
 * screens had copy-pasted anon-key headers and the feature was 100% down the
 * moment the gate deployed. Every direct call site must use this helper; the
 * anon-key fallback below only applies signed out, where the gate's 401 is the
 * correct outcome anyway.
 */
export async function aiProxyHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ANON_KEY}`,
    apikey: ANON_KEY,
  };
}

/** 'local' = try the on-device model first (silent cloud fallback). 'cloud' = ai-proxy only. */
export type AITier = 'local' | 'cloud';

// Cache the availability probe — it can't change mid-session.
let localAvailable: boolean | null = null;
async function canRunLocally(): Promise<boolean> {
  if (!LOCAL_AI_ENABLED) return false;
  if (localAvailable === null) {
    try { localAvailable = await isLocalAIAvailable(); } catch { localAvailable = false; }
  }
  return localAvailable;
}

async function callCloud(messages: { role: string; content: string }[], system?: string, max_tokens = 8192) {
  const response = await fetch(
    'https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy',
    {
      method: 'POST',
      headers: await aiProxyHeaders(),
      body: JSON.stringify({ messages, system, max_tokens }),
    }
  );

  const raw = await response.text();
  console.log('callAI raw response:', raw.slice(0, 300));

  // Previously this went straight to JSON.parse(raw). Any non-2xx from the
  // proxy — an expired Anthropic key, a rate limit, a cold-start failure —
  // came back as either an opaque SyntaxError or an empty string, depending on
  // whether the error body happened to be JSON. Callers could not tell "the
  // model returned nothing" from "the request never reached the model", and
  // neither case named the status code. Fail loudly and say why.
  if (!response.ok) {
    throw new Error(`ai-proxy ${response.status}: ${raw.slice(0, 200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`ai-proxy returned non-JSON (${response.status}): ${raw.slice(0, 200)}`);
  }

  return data.content?.find((b: any) => b.type === 'text')?.text || '';
}

/**
 * Routes an AI request per the hybrid plan.
 *
 * - `tier: 'local'` — run on-device (Apple Foundation Models, iOS 26+) when the
 *   device supports it; any failure, timeout, or empty output silently falls
 *   back to the ai-proxy edge function. Single-turn prompts only.
 * - `tier: 'cloud'` (default) — ai-proxy edge function, unchanged behavior.
 *
 * Existing call sites need no changes; local-first sites opt in with the 4th arg.
 */
export async function callAI(
  messages: { role: string; content: string }[],
  system?: string,
  max_tokens = 8192,
  tier: AITier = 'cloud',
) {
  if (tier === 'local' && messages.length === 1 && (await canRunLocally())) {
    try {
      const text = await Promise.race<string>([
        generateLocalAI(messages[0].content, system, Math.min(max_tokens, 2048)),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('local timeout')), 15000)),
      ]);
      if (text && text.trim().length > 0) {
        console.log('callAI: served on-device');
        return text;
      }
    } catch (e) {
      console.log('callAI: local failed, falling back to cloud —', (e as Error)?.message);
    }
  }
  return callCloud(messages, system, max_tokens);
}
