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

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const WHOOP_API = 'https://api.prod.whoop.com'
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
const OURA_API = 'https://api.ouraring.com'
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'

const TITLES: Record<string, string> = {
  recovery_overreach: 'Recovery signals are low 🔴',
  calorie_deficit_streak: "You've been under your calorie target",
  protein_miss: 'Your protein is trailing this week',
  streak_risk: "Don't break your streak tonight!",
  workout_gap: 'Time to get back in the gym 💪',
  weekly_win: 'Strong week — you crushed it 🏆',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function daysAgoStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
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

async function refreshWhoopToken(userId: string, refreshToken: string | null): Promise<string | null> {
  if (!refreshToken) return null
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: Deno.env.get('WHOOP_CLIENT_ID') || '',
      client_secret: Deno.env.get('WHOOP_CLIENT_SECRET') || '',
    })
    const res = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const tokens = await res.json()
    if (!tokens.access_token) return null
    await supabaseAdmin.from('wearable_tokens').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
    }).eq('user_id', userId).eq('provider', 'whoop')
    return tokens.access_token
  } catch {
    return null
  }
}

async function refreshOuraToken(userId: string, refreshToken: string | null): Promise<string | null> {
  if (!refreshToken) return null
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: Deno.env.get('OURA_CLIENT_ID') || '',
      client_secret: Deno.env.get('OURA_CLIENT_SECRET') || '',
    })
    const res = await fetch(OURA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const tokens = await res.json()
    if (!tokens.access_token) return null
    await supabaseAdmin.from('wearable_tokens').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
    }).eq('user_id', userId).eq('provider', 'oura')
    return tokens.access_token
  } catch {
    return null
  }
}

async function getWhoopRecovery(userId: string): Promise<number | null> {
  try {
    const { data: row } = await supabaseAdmin
      .from('wearable_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .eq('provider', 'whoop')
      .single()
    if (!row) return null

    let token = row.access_token
    if (row.expires_at && new Date(row.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
      token = await refreshWhoopToken(userId, row.refresh_token) ?? token
    }

    let res = await fetch(`${WHOOP_API}/v2/recovery?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      const newToken = await refreshWhoopToken(userId, row.refresh_token)
      if (!newToken) return null
      res = await fetch(`${WHOOP_API}/v2/recovery?limit=1`, {
        headers: { Authorization: `Bearer ${newToken}` },
      })
    }
    if (!res.ok) return null
    const data = await res.json()
    return data?.records?.[0]?.score?.recovery_score ?? null
  } catch {
    return null
  }
}

async function getOuraReadiness(userId: string): Promise<number | null> {
  try {
    const { data: row } = await supabaseAdmin
      .from('wearable_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .eq('provider', 'oura')
      .single()
    if (!row) return null

    let token = row.access_token
    if (row.expires_at && new Date(row.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
      token = await refreshOuraToken(userId, row.refresh_token) ?? token
    }

    const today = todayStr()
    let res = await fetch(
      `${OURA_API}/v2/usercollection/daily_readiness?start_date=${today}&end_date=${today}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.status === 401) {
      const newToken = await refreshOuraToken(userId, row.refresh_token)
      if (!newToken) return null
      res = await fetch(
        `${OURA_API}/v2/usercollection/daily_readiness?start_date=${today}&end_date=${today}`,
        { headers: { Authorization: `Bearer ${newToken}` } }
      )
    }
    if (!res.ok) return null
    const data = await res.json()
    return data?.data?.[0]?.score ?? null
  } catch {
    return null
  }
}

async function callClaude(prompt: string, memoryContext = ''): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: `You are a concise fitness coach. Write 2-3 sentences of actionable, specific insight based on the user's data. No greetings, no bullet points. Be direct and personal.${memoryContext}`,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  return data.content?.find((b: any) => b.type === 'text')?.text || ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('authorization') ?? ''
  const bearerToken = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

  let localHour = 12
  try {
    const body = await req.json()
    if (typeof body.localHour === 'number') localHour = body.localHour
  } catch {}

  const userId = user.id
  const today = todayStr()

  // Rate limit: at most 1 proactive notification per 23 hours
  const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabaseAdmin
    .from('proactive_notifications')
    .select('id')
    .eq('user_id', userId)
    .gte('sent_at', twentyThreeHoursAgo)
    .limit(1)
  if (recent?.length) return jsonResponse({ triggered: false })

  // Fetch all needed data in parallel
  const [profileRes, macrosRes, workoutsRes, todayWorkoutsRes, wearableRes] = await Promise.allSettled([
    supabaseAdmin.from('profiles').select('goal,calories,protein').eq('id', userId).single(),
    supabaseAdmin.from('macro_logs').select('date,calories,protein').eq('user_id', userId).gte('date', daysAgoStr(7)).lte('date', today),
    supabaseAdmin.from('workout_logs').select('date').eq('user_id', userId).gte('date', daysAgoStr(4)).lte('date', today).eq('done', true),
    supabaseAdmin.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('date', today).eq('done', true),
    supabaseAdmin.from('wearable_tokens').select('provider').eq('user_id', userId).in('provider', ['whoop', 'oura']).limit(1),
  ])

  const profile = profileRes.status === 'fulfilled' ? profileRes.value.data : null
  const calorieTarget = profile?.calories ?? null
  const proteinTarget = profile?.protein ?? null
  const goal = profile?.goal ?? null

  // Aggregate macro_logs by date
  const dayMacros: Record<string, { calories: number; protein: number }> = {}
  if (macrosRes.status === 'fulfilled' && macrosRes.value.data?.length) {
    for (const row of macrosRes.value.data as any[]) {
      if (!dayMacros[row.date]) dayMacros[row.date] = { calories: 0, protein: 0 }
      dayMacros[row.date].calories += row.calories ?? 0
      dayMacros[row.date].protein += row.protein ?? 0
    }
  }

  // Distinct workout dates in last 4 days
  const workoutDates = new Set<string>()
  if (workoutsRes.status === 'fulfilled' && workoutsRes.value.data?.length) {
    for (const row of workoutsRes.value.data as any[]) workoutDates.add(row.date)
  }

  const trainedToday = todayWorkoutsRes.status === 'fulfilled'
    ? (todayWorkoutsRes.value.count ?? 0) > 0
    : false

  // Fetch wearable recovery score if connected
  let recoveryScore: number | null = null
  const wearableProvider = wearableRes.status === 'fulfilled'
    ? (wearableRes.value.data as any[])?.[0]?.provider ?? null
    : null
  if (wearableProvider === 'whoop') {
    recoveryScore = await getWhoopRecovery(userId)
  } else if (wearableProvider === 'oura') {
    recoveryScore = await getOuraReadiness(userId)
  }

  // --- Signal evaluation (highest priority first) ---
  let signalType: string | null = null
  let aiPrompt = ''

  // Signal 1: Recovery overreach — wearable in red zone AND trained today
  if (recoveryScore !== null && recoveryScore < 33 && trainedToday) {
    signalType = 'recovery_overreach'
    aiPrompt = `User trained today but their wearable recovery score is ${recoveryScore}/100 (red zone, under 33). Write 2-3 sentences about what to prioritize tonight to support recovery.`
  }

  // Signal 2: Calorie deficit streak — last 3 days all >300 below target
  if (!signalType && calorieTarget) {
    const sortedDays = Object.keys(dayMacros).sort().reverse()
    if (sortedDays.length >= 3) {
      const last3 = sortedDays.slice(0, 3)
      if (last3.every(d => dayMacros[d].calories < calorieTarget - 300)) {
        const avgCal = Math.round(last3.reduce((s, d) => s + dayMacros[d].calories, 0) / 3)
        const cals = last3.map(d => dayMacros[d].calories).join(', ')
        signalType = 'calorie_deficit_streak'
        aiPrompt = `User calorie target: ${calorieTarget}. Intake last 3 days: ${cals} cal (avg ${avgCal}) — all more than 300 below target. Write 2-3 sentences about the risks of a sustained deficit and one practical suggestion to fix it.`
      }
    }
  }

  // Signal 3: Protein miss — 7-day avg protein below 80% of target
  if (!signalType && proteinTarget) {
    const macrodays = Object.values(dayMacros)
    if (macrodays.length >= 5) {
      const avgProtein = Math.round(macrodays.reduce((s, d) => s + d.protein, 0) / macrodays.length)
      if (avgProtein < proteinTarget * 0.8) {
        const pct = Math.round((avgProtein / proteinTarget) * 100)
        signalType = 'protein_miss'
        aiPrompt = `User protein target: ${proteinTarget}g/day. Their ${macrodays.length}-day average: ${avgProtein}g (${pct}% of target). Write 2-3 sentences about closing the gap with practical, specific food suggestions.`
      }
    }
  }

  // Signal 4: Streak risk — no food log today and it's past 7pm locally
  if (!signalType && localHour >= 19 && !dayMacros[today]) {
    // Compute consecutive logged days from yesterday backwards
    let streak = 0
    const d = new Date()
    d.setDate(d.getDate() - 1)
    for (let i = 0; i < 30; i++) {
      const dateKey = d.toISOString().split('T')[0]
      if (dayMacros[dateKey]) {
        streak++
        d.setDate(d.getDate() - 1)
      } else {
        break
      }
    }
    if (streak > 0) {
      signalType = 'streak_risk'
      aiPrompt = `User has a ${streak}-day food logging streak but hasn't logged anything today, and it's past 7pm. Write 2-3 encouraging sentences to motivate a quick dinner log to keep the streak alive.`
    }
  }

  // Signal 5: Workout gap — goal is muscle gain, no workout in 4+ days
  if (!signalType && goal === 'gain' && workoutDates.size === 0) {
    signalType = 'workout_gap'
    aiPrompt = `User's goal is muscle gain and they haven't logged a workout in 4+ days. Write 2-3 motivating sentences and suggest a simple workout to get back on track.`
  }

  // Signal 6: Weekly win — Sunday and hit ≥90% of both cal+protein targets on 5+ days
  if (!signalType && new Date().getDay() === 0 && calorieTarget && proteinTarget) {
    const allDays = Object.keys(dayMacros)
    const winDays = allDays.filter(d =>
      dayMacros[d].calories >= calorieTarget * 0.9 &&
      dayMacros[d].protein >= proteinTarget * 0.9
    )
    if (winDays.length >= 5) {
      signalType = 'weekly_win'
      aiPrompt = `User hit ≥90% of both their calorie (${calorieTarget}) and protein (${proteinTarget}g) targets on ${winDays.length} out of ${allDays.length} days this week. Write 2-3 sentences of specific positive reinforcement highlighting what made this week successful.`
    }
  }

  if (!signalType) return jsonResponse({ triggered: false })

  // Generate AI insight for the triggered signal
  const memoryContext = await buildMemorySection(userId)
  const body = await callClaude(aiPrompt, memoryContext)
  const title = TITLES[signalType] ?? 'A note from your coach'

  await supabaseAdmin.from('proactive_notifications').insert({
    user_id: userId,
    type: signalType,
    title,
    body,
  })

  return jsonResponse({ triggered: true, type: signalType, title, body, deepLink: 'fuelog://coach' })
})
