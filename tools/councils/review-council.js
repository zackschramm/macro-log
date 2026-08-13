export const meta = {
  name: 'fuelog-review-council',
  description: 'Adversarial code-review council: 5 lenses review, skeptics verify, only confirmed findings survive',
  phases: [
    { title: 'Review', detail: 'five specialist lenses over the diff' },
    { title: 'Verify', detail: 'adversarial verification of each finding' },
  ],
}

// args: { filesDir: string, diffPath: string, context?: string }
const FILES = args.filesDir
const DIFF = args.diffPath
const CTX = args.context ?? ''

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          title: { type: 'string' },
          claim: { type: 'string', description: 'one-sentence defect statement' },
          failure_scenario: { type: 'string', description: 'concrete inputs/state -> wrong outcome' },
        },
        required: ['file', 'severity', 'title', 'claim', 'failure_scenario'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does NOT hold up' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const LENSES = [
  { key: 'correctness', prompt: 'logic errors, wrong conditions, broken state transitions, unhandled nulls/undefined, React hook-order and render-time throw risks' },
  { key: 'security', prompt: 'auth bypasses, missing authorization, rate-limit gaps or bypasses, key exposure, injection, RLS/definer-function risks in SQL' },
  { key: 'data-integrity', prompt: 'silent data loss, failed writes shown as success, race conditions on tokens or counters, migration hazards, fixed-window rate limiter edge cases (boundary bursts, clock issues)' },
  { key: 'ui-truth', prompt: 'labels or captions that misstate what the code does, source attributions that can be wrong, stale UI state, error states that lie to the user' },
  { key: 'regression', prompt: 'ways these specific changes break EXISTING behavior: the tolerant source matcher over-matching (e.g. a pref that is a substring of the wrong source), hidden connect buttons stranding existing users, boundary changes masking errors' },
]

phase('Review')
const reviews = await parallel(LENSES.map(l => () =>
  agent(
    `You are the ${l.key} seat on a code-review council for Fuelog, a React Native + Supabase endurance-nutrition app built by a solo developer.\n` +
    `Focus EXCLUSIVELY on: ${l.prompt}.\n` +
    `Read the diff at ${DIFF} first — it is the review target (4 commits: error-boundary diagnostics, InBody empty-scan crash fix, tolerant source matching, ai-proxy rate limiting + whoop-proxy diagnostic removal, API connect buttons hidden). ` +
    `Full current files are under ${FILES} for context. ${CTX}\n` +
    `Report ONLY real defects in the CHANGED code or caused by it — not style, not pre-existing issues untouched by the diff. If the diff is clean through your lens, return an empty findings array. Severity: P1 = user-visible breakage or security hole, P2 = wrong behavior in a plausible case, P3 = latent hazard.`,
    { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }
  )
))

// Barrier justified: dedup across all lenses before paying for verification.
const all = reviews.filter(Boolean).flatMap(r => r.findings)
const seen = new Set()
const deduped = []
for (const f of all) {
  const k = `${f.file}:${f.line ?? '?'}:${f.title.toLowerCase().slice(0, 40)}`
  if (!seen.has(k)) { seen.add(k); deduped.push(f) }
}
const bySev = { P1: 0, P2: 1, P3: 2 }
deduped.sort((a, b) => bySev[a.severity] - bySev[b.severity])
const toVerify = deduped.slice(0, 8)
if (deduped.length > 8) log(`capping verification at 8 of ${deduped.length} findings (severity-ranked)`)

phase('Verify')
const verified = await parallel(toVerify.map(f => () =>
  agent(
    `You are a skeptical verifier. A reviewer claims this defect in Fuelog's recent diff (${DIFF}, files under ${FILES}):\n` +
    `FILE: ${f.file} (line ~${f.line ?? '?'})\nCLAIM: ${f.claim}\nFAILURE SCENARIO: ${f.failure_scenario}\n` +
    `Try hard to REFUTE it by reading the actual code: does the scenario truly occur given how the code is called? Default to refuted=true if you cannot concretely confirm the failure path.`,
    { label: `verify:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' }
  ).then(v => ({ ...f, verdict: v }))
))

const confirmed = verified.filter(Boolean).filter(f => f.verdict && f.verdict.refuted === false)
const rejected = verified.filter(Boolean).filter(f => f.verdict && f.verdict.refuted === true)
return {
  confirmed,
  rejectedCount: rejected.length,
  rejectedTitles: rejected.map(f => f.title),
  totalRaw: all.length,
  dedupedCount: deduped.length,
}
