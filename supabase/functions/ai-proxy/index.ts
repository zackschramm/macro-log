import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function getNutrient(nutrients: any[], ...names: string[]) {
  for (const name of names) {
    const found = nutrients.find((n: any) => n.nutrientName?.toLowerCase().includes(name.toLowerCase()));
    if (found) return Math.round((found.value || 0) * 100) / 100;
  }
  return 0;
}

async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearerToken = authHeader.replace('Bearer ', '')
  if (!bearerToken) return null
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken)
    return user?.id ?? null
  } catch {
    return null
  }
}

async function buildMemorySection(userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('user_ai_memory')
      .select('id, memory_type, content, importance')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('importance', { ascending: false })
      .limit(15)
    if (!data?.length) return ''

    supabaseAdmin
      .from('user_ai_memory')
      .update({ last_used_at: new Date().toISOString() })
      .in('id', data.map((m: any) => m.id))
      .then(() => {})

    const lines = data.map((m: any) => `[${m.memory_type}] ${m.content}`).join('\n')
    return `\n\n## What I know about this user\n${lines}`
  } catch {
    return ''
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

function isSimilar(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const wordsA = new Set(na.split(/\s+/))
  const wordsB = nb.split(/\s+/)
  const overlap = wordsB.filter((w) => wordsA.has(w)).length
  return overlap / Math.max(wordsB.length, 1) > 0.6
}

async function extractAndSaveMemories(userId: string, messages: any[], reply: string) {
  try {
    const recentTurns = messages.slice(-6).map((m: any) => {
      const text = typeof m.content === 'string' ? m.content : '[non-text content]'
      return `${m.role}: ${text}`
    }).join('\n')
    const convoText = `${recentTurns}\nassistant: ${reply}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: 'Extract durable facts worth remembering about this user from the conversation below: preferences, habits/patterns, goals, corrections/feedback, or useful context. Only include things that will still be true and useful in future conversations. Return ONLY a JSON array (no markdown, no prose) of objects shaped like {"type": "preference"|"pattern"|"goal"|"feedback"|"context", "content": string, "importance": number 1-10}. Return [] if nothing is worth remembering.',
        messages: [{ role: 'user', content: convoText }],
      }),
    })
    const data = await res.json()
    const raw = data.content?.find((b: any) => b.type === 'text')?.text || '[]'
    const learnings = JSON.parse(raw.replace(/```json|```/g, '').trim())
    if (!Array.isArray(learnings) || !learnings.length) return

    const validTypes = new Set(['preference', 'pattern', 'goal', 'feedback', 'context'])
    for (const learning of learnings) {
      if (!learning?.content || !validTypes.has(learning?.type)) continue
      const importance = Math.min(10, Math.max(1, Math.round(learning.importance ?? 5)))

      const { data: existing } = await supabaseAdmin
        .from('user_ai_memory')
        .select('id, content')
        .eq('user_id', userId)
        .eq('memory_type', learning.type)
        .eq('is_active', true)

      const dup = existing?.find((e: any) => isSimilar(e.content, learning.content))
      if (dup) {
        await supabaseAdmin.from('user_ai_memory').update({
          content: learning.content,
          importance,
        }).eq('id', dup.id)
      } else {
        await supabaseAdmin.from('user_ai_memory').insert({
          user_id: userId,
          memory_type: learning.type,
          content: learning.content,
          importance,
        })
      }
    }
  } catch (err) {
    console.log('memory extraction failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Local LLM tier (RTX 3090 via Ollama + Cloudflare Tunnel) — hybrid AI plan.
//
// Secrets (all optional; function behaves exactly as before when unset):
//   OLLAMA_URL          e.g. https://ai.fuelog.app  (unset = tier disabled)
//   OLLAMA_ROUTE        'text' (default) = text requests only; 'all' = also
//                       vision (only after food-photo eval gate passes)
//   OLLAMA_TEXT_MODEL   default 'qwen3:32b'
//   OLLAMA_VISION_MODEL default 'qwen2.5vl:7b'
//   OLLAMA_TIMEOUT_MS   default 60000
//
// Any Ollama failure (down, timeout, bad output) falls through silently to
// Anthropic — the box going offline costs API dollars, never user requests.
// ---------------------------------------------------------------------------

function toOllamaMessages(messages: any[]): any[] {
  return messages.map((m: any) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content }
    // Anthropic-style block array → Ollama {content, images}
    const blocks = Array.isArray(m.content) ? m.content : []
    const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const images = blocks
      .filter((b: any) => b.type === 'image' && b.source?.data)
      .map((b: any) => b.source.data)
    return images.length ? { role: m.role, content: text, images } : { role: m.role, content: text }
  })
}

async function tryOllama(
  messages: any[], system: string | undefined, maxTokens: number, hasImage: boolean,
): Promise<string | null> {
  const base = Deno.env.get('OLLAMA_URL')
  if (!base) return null
  const route = Deno.env.get('OLLAMA_ROUTE') || 'text'
  if (hasImage && route !== 'all') return null

  const model = hasImage
    ? (Deno.env.get('OLLAMA_VISION_MODEL') || 'qwen2.5vl:7b')
    : (Deno.env.get('OLLAMA_TEXT_MODEL') || 'qwen3:32b')
  const timeoutMs = Number(Deno.env.get('OLLAMA_TIMEOUT_MS') || 60000)

  const ollamaMessages = system
    ? [{ role: 'system', content: system }, ...toOllamaMessages(messages)]
    : toOllamaMessages(messages)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: ollamaMessages,
        stream: false,
        options: { num_predict: maxTokens },
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.log('Ollama non-OK:', res.status)
      return null
    }
    const data = await res.json()
    const text = data.message?.content?.trim()
    if (!text) return null
    console.log(`Ollama served (${model}), ${text.length} chars`)
    return text
  } catch (err) {
    console.log('Ollama failed, falling back to Anthropic:', (err as Error)?.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// This function has no errorResponse helper of its own (the proxies do);
// define the same shape so callers get consistent JSON errors.
function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // AUTH GATE for every route in this function — see the comment at the LLM
  // path below. food-search relays to USDA on our API key and was equally open.
  const authedUserId = await getUserId(req)
  if (!authedUserId) return errorResponse(401, 'Unauthorized')

  const url = new URL(req.url)

  // USDA food search
  if (url.pathname.endsWith('/food-search')) {
    const { query } = await req.json()
    const apiKey = Deno.env.get('USDA_API_KEY') || ''
    const res = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=10&api_key=${apiKey}`
    )
    const data = await res.json()
    const foods = (data.foods || []).map((f: any) => {
      const n = f.foodNutrients || []
      return {
        name: f.description,
        brand: f.brandOwner || f.brandName || null,
        serving_size: f.servingSize ? `${f.servingSize}${f.servingSizeUnit || 'g'}` : '100g',
        calories: Math.round(getNutrient(n, 'energy', 'calorie')),
        protein: getNutrient(n, 'protein'),
        carbs: getNutrient(n, 'carbohydrate'),
        fat: getNutrient(n, 'total lipid'),
        vitamin_a: getNutrient(n, 'vitamin a'),
        vitamin_c: getNutrient(n, 'vitamin c'),
        vitamin_d: getNutrient(n, 'vitamin d'),
        vitamin_e: getNutrient(n, 'vitamin e'),
        vitamin_k: getNutrient(n, 'vitamin k'),
        vitamin_b1: getNutrient(n, 'thiamin'),
        vitamin_b2: getNutrient(n, 'riboflavin'),
        vitamin_b3: getNutrient(n, 'niacin'),
        vitamin_b5: getNutrient(n, 'pantothenic'),
        vitamin_b6: getNutrient(n, 'vitamin b-6'),
        vitamin_b7: getNutrient(n, 'biotin'),
        vitamin_b9: getNutrient(n, 'folate', 'folic'),
        vitamin_b12: getNutrient(n, 'vitamin b-12'),
        calcium: getNutrient(n, 'calcium'),
        iron: getNutrient(n, 'iron'),
        magnesium: getNutrient(n, 'magnesium'),
        phosphorus: getNutrient(n, 'phosphorus'),
        potassium: getNutrient(n, 'potassium'),
        sodium: getNutrient(n, 'sodium'),
        zinc: getNutrient(n, 'zinc'),
        copper: getNutrient(n, 'copper'),
        manganese: getNutrient(n, 'manganese'),
        selenium: getNutrient(n, 'selenium'),
        chromium: getNutrient(n, 'chromium'),
        iodine: getNutrient(n, 'iodine'),
        omega3: getNutrient(n, 'omega-3', 'epa', 'dha'),
      }
    })
    return new Response(JSON.stringify({ foods }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // AI proxy
  try {
    // AUTH: gated at the top of serve(). This function relays to Anthropic on
    // our API key and previously accepted any caller — the platform verify_jwt
    // check passes for the public anon key, which ships in the app bundle and
    // appears in the website's static HTML. Every AI feature runs behind
    // login, so a real user JWT is always available; the gate requires it.
    const userId = authedUserId

    const { messages, system, max_tokens } = await req.json()
    const firstContent = messages?.[0]?.content;
    const imgContent = Array.isArray(firstContent) ? firstContent.find((b: any) => b.type === 'image') : null;
    if (imgContent) {
      console.log('Image media_type:', imgContent?.source?.media_type);
      console.log('Image data length:', imgContent?.source?.data?.length);
    }

    let finalSystem = system
    if (!imgContent) {
      const memorySection = await buildMemorySection(userId)
      if (memorySection) finalSystem = `${system || ''}${memorySection}`
    }

    // Tier 1: local LLM on the 3090 (no-op until OLLAMA_URL secret is set)
    let text = await tryOllama(messages, finalSystem, max_tokens || 8192, !!imgContent) ?? ''

    // Tier 2: Anthropic fallback (or primary while Ollama tier is disabled)
    if (!text) {
      const body = JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: max_tokens || 8192,
          system: finalSystem,
          messages,
        });
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || '',
          'anthropic-version': '2023-06-01',
        },
        body,
      })
      const data = await response.json()
      console.log('Anthropic response:', JSON.stringify(data).substring(0, 500));
      if (data.type === 'error') {
        return new Response(JSON.stringify({ error: data.error?.message || 'Anthropic error' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      text = data.content?.find((b: any) => b.type === 'text')?.text || ''
    }

    if (userId && !imgContent && Array.isArray(messages) && messages.length >= 2 && text) {
      const extraction = extractAndSaveMemories(userId, messages, text)
      // @ts-ignore - EdgeRuntime is provided by the Supabase Edge Functions runtime
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(extraction)
      } else {
        extraction.catch(() => {})
      }
    }

    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
