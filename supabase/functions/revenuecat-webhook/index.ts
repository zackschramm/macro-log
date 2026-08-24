// supabase/functions/revenuecat-webhook/index.ts
//
// RevenueCat → entitlements table. PASSIVE COLLECTOR: deploying this changes
// nothing a user or reviewer can see — it only keeps public.entitlements
// current so the ai-proxy gate has truth to check when enforcement turns on
// (post-approval). Safe to deploy before submission; sandbox purchases during
// device testing will populate rows with environment=SANDBOX, which is exactly
// the shadow data we want to verify against.
//
// Setup (Supabase dashboard):
//   1. Deploy this function with "Verify JWT" DISABLED (RevenueCat is not a
//      Supabase user; auth is the shared secret below).
//   2. Set secret RC_WEBHOOK_AUTH to a long random string.
//   3. RevenueCat → Project → Integrations → Webhooks → Add:
//        URL:    https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/revenuecat-webhook
//        Authorization header value: exactly the RC_WEBHOOK_AUTH string.
//      Leave "send all events" on — unknown types are ignored below.
//
// RevenueCat app_user_id: react-native-purchases was configured with the
// Supabase user id via Purchases.logIn(user.id) — if any event arrives with
// an anonymous id ($RCAnonymousID:...), it is logged and skipped rather than
// guessed at.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const ENTITLEMENT_ID = 'Fuelog Pro'

// Event types that GRANT (or refresh) the entitlement.
const GRANTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'PRODUCT_CHANGE',
  'TRANSFER', // handled specially below — grants to the new owner
])

// Event types that REVOKE access. CANCELLATION alone does NOT revoke — the
// user keeps access until expiration_at_ms; RevenueCat sends EXPIRATION when
// access actually ends.
const REVOKES = new Set(['EXPIRATION', 'BILLING_ISSUE_REVOKE', 'REFUND'])

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // Shared-secret auth. RevenueCat sends the configured value verbatim in the
  // Authorization header.
  const secret = Deno.env.get('RC_WEBHOOK_AUTH') || ''
  const got = req.headers.get('authorization') || ''
  if (!secret || got !== secret) {
    console.error('rc-webhook: bad auth header')
    return new Response('unauthorized', { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('bad json', { status: 400 })
  }

  const ev = body?.event
  if (!ev?.type) return new Response('no event', { status: 400 })

  // Only act on events that concern our entitlement (defensive: RC sends
  // entitlement_ids on entitlement-scoped events; product-only events pass).
  const entIds: string[] = ev.entitlement_ids ?? (ev.entitlement_id ? [ev.entitlement_id] : [])
  if (entIds.length > 0 && !entIds.includes(ENTITLEMENT_ID)) {
    console.log(`rc-webhook: ignoring event for entitlements [${entIds.join(',')}]`)
    return new Response('ok (other entitlement)', { status: 200 })
  }

  const type = String(ev.type)
  // TRANSFER events carry transferred_to / transferred_from instead of app_user_id.
  const userId: string = type === 'TRANSFER'
    ? String(ev.transferred_to?.[0] ?? '')
    : String(ev.app_user_id ?? '')

  if (!isUuid(userId)) {
    // Anonymous RC id or malformed — never guess. Log for follow-up.
    console.error(`rc-webhook: non-uuid app_user_id "${userId.slice(0, 40)}" on ${type}`)
    return new Response('ok (unmapped user)', { status: 200 })
  }

  const expiresAt = ev.expiration_at_ms ? new Date(Number(ev.expiration_at_ms)).toISOString() : null
  const row = {
    user_id: userId,
    source: 'revenuecat',
    product_id: ev.product_id ?? null,
    environment: ev.environment ?? null,
    updated_at: new Date().toISOString(),
  }

  try {
    if (GRANTS.has(type)) {
      const { error } = await supabaseAdmin.from('entitlements').upsert(
        { ...row, is_pro: true, expires_at: expiresAt },
        { onConflict: 'user_id' }
      )
      if (error) throw error
      // A TRANSFER also revokes from the old owner.
      if (type === 'TRANSFER') {
        const from = String(ev.transferred_from?.[0] ?? '')
        if (isUuid(from)) {
          await supabaseAdmin.from('entitlements').upsert(
            { user_id: from, is_pro: false, source: 'revenuecat', updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          )
        }
      }
      console.log(`rc-webhook: GRANT ${type} user=${userId} exp=${expiresAt} env=${ev.environment}`)
    } else if (REVOKES.has(type)) {
      // Never let a revoke clobber a manual (demo/founder) row.
      const { data: existing } = await supabaseAdmin
        .from('entitlements').select('source').eq('user_id', userId).maybeSingle()
      if (existing?.source === 'manual') {
        console.log(`rc-webhook: skip revoke on manual row user=${userId}`)
      } else {
        const { error } = await supabaseAdmin.from('entitlements').upsert(
          { ...row, is_pro: false, expires_at: expiresAt },
          { onConflict: 'user_id' }
        )
        if (error) throw error
        console.log(`rc-webhook: REVOKE ${type} user=${userId}`)
      }
    } else {
      // CANCELLATION, BILLING_ISSUE, TEST, etc. — informational only.
      console.log(`rc-webhook: noted ${type} user=${userId} (no entitlement change)`)
    }
    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('rc-webhook: db error', String(err))
    // 5xx so RevenueCat retries with backoff.
    return new Response('db error', { status: 500 })
  }
})
