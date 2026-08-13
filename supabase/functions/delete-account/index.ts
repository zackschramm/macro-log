import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Permanent account deletion.
 *
 * App Store Guideline 5.1.1(v) requires that an app offering account creation
 * also offers account deletion from inside the app — not a support email, not a
 * web form. This is the server half of that.
 *
 * Deletion is explicit rather than relying on ON DELETE CASCADE from auth.users.
 * Cascades may well be configured, in which case these deletes are harmless
 * no-ops; but if any table is missing its foreign key, cascading alone would
 * silently orphan that user's rows. Orphaned personal data after a deletion
 * request is both a privacy failure and, for anyone in the EU or California, a
 * legal one. Deleting explicitly and then removing the auth user covers both
 * arrangements.
 *
 * Tables are attempted child-first and failures are collected rather than
 * thrown: a table that has no user_id column, or a view like public_profiles,
 * must not abort the run and leave the account half-deleted.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Ordered child-to-parent so that rows depending on other rows go first. Any
 * table without a user_id simply reports an error and is skipped — its parent
 * going away takes it with it.
 */
const USER_TABLES = [
  // Social graph first: these reference posts and profiles.
  'post_likes',
  'post_comments',
  'social_posts',
  // 'referrals' is NOT in this list: it has no user_id column
  // (referrer_id/referee_id, see migrations/20260704_referrals.sql) and its
  // FKs to auth.users do not cascade. The generic loop silently skipped it,
  // and auth.admin.deleteUser then failed with an FK violation — meaning any
  // user who ever referred or was referred could not delete their account.
  // Handled explicitly below, by its real columns.

  // Workout tree, leaves upward.
  'workout_sets',
  'workout_exercises',
  'workout_sessions',
  'program_completed_days',
  'workout_logs',
  'workout_programs',
  'custom_workouts',

  // Nutrition and logging.
  'macro_logs',
  'meal_plans',
  'user_recipes',
  'user_foods',
  'micronutrient_targets',

  // Body and health.
  'progress_logs',
  'body_measurements',
  'inbody_logs',
  'bloodwork',
  'cycle_logs',
  'cycle_settings',

  // Integrations and assistant state.
  'wearable_tokens',
  'coach_memories',
  'proactive_notifications',

  // Profile last — other rows may reference it.
  'avatars',
  'public_profiles',
  'profiles',
]

const USER_BUCKETS = ['avatars', 'food-images']

/** Remove every object the user owns from a storage bucket. */
async function purgeBucket(bucket: string, userId: string, problems: string[]) {
  try {
    // Convention across the app is a per-user folder keyed by user id.
    const { data: files, error } = await supabaseAdmin.storage.from(bucket).list(userId, {
      limit: 1000,
    })
    if (error) {
      problems.push(`storage:${bucket}:list:${error.message}`)
      return
    }
    if (!files?.length) return

    const paths = files.map((f) => `${userId}/${f.name}`)
    const { error: rmError } = await supabaseAdmin.storage.from(bucket).remove(paths)
    if (rmError) problems.push(`storage:${bucket}:remove:${rmError.message}`)
  } catch (e) {
    problems.push(`storage:${bucket}:${(e as Error).message}`)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse(405, 'Method not allowed')

  // Identify the caller from their own JWT. A user can only ever delete
  // themselves — the id is taken from the verified token, never from the body.
  const authHeader = req.headers.get('authorization') ?? ''
  const bearerToken = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authError || !user) return errorResponse(401, 'Unauthorized')

  // Require an explicit confirmation string so a malformed or replayed request
  // cannot destroy an account by accident.
  let body: { confirm?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'Invalid JSON')
  }
  if (body.confirm !== 'DELETE') {
    return errorResponse(400, 'Missing confirmation')
  }

  const userId = user.id
  const problems: string[] = []

  for (const bucket of USER_BUCKETS) {
    await purgeBucket(bucket, userId, problems)
  }

  for (const table of USER_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().eq('user_id', userId)
    // A missing table or missing user_id column is expected for a few of these
    // and must not stop the run. Recorded so a real problem is still visible.
    if (error) problems.push(`${table}:${error.message}`)
  }

  // referrals keys on referrer_id / referee_id rather than user_id, and its
  // FKs block auth-user deletion if any row survives.
  for (const col of ['referrer_id', 'referee_id']) {
    const { error } = await supabaseAdmin.from('referrals').delete().eq(col, userId)
    if (error) problems.push(`referrals.${col}:${error.message}`)
  }

  // Finally the auth record. Until this succeeds the account still exists, so
  // its failure is the only one worth failing the whole request over.
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error('delete-account: auth deletion failed', userId, deleteError.message, problems)
    return errorResponse(500, 'Could not delete the account. Please contact support@fuelog.app.')
  }

  // Non-fatal issues are logged, never returned — the user asked for deletion,
  // it happened, and a list of internal table names helps nobody.
  if (problems.length) {
    console.error('delete-account: completed with issues', userId, problems)
  }

  return new Response(JSON.stringify({ data: { deleted: true } }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
