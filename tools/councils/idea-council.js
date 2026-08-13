export const meta = {
  name: 'fuelog-idea-council',
  description: 'Five opposed seats judge a product idea; synthesis preserves disagreement and designs the cheapest real test',
  phases: [
    { title: 'Deliberate', detail: 'five seats argue independently' },
    { title: 'Synthesize', detail: 'preserve disagreement, verdict + cheapest test' },
  ],
}

// args: { idea: string, context?: string }
const IDEA = args.idea
const CTX = args.context ?? ''

const SEAT_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', description: '1-10 for this idea through YOUR lens only' },
    strongest_for: { type: 'string' },
    strongest_against: { type: 'string' },
    evidence_needed: { type: 'string', description: 'what real-world evidence would change your mind' },
  },
  required: ['score', 'strongest_for', 'strongest_against', 'evidence_needed'],
}

const SEATS = [
  { key: 'athlete', persona: 'a serious endurance athlete (ultra/tri/MTB) who pays for tools that solve fueling problems and churns instantly on gimmicks. You care: does this fix a real race-day or training-day fueling problem I actually have?' },
  { key: 'operator', persona: 'a solo-founder operator. You care about build time, maintenance burden, support tickets, and opportunity cost against launch-critical work. Complexity is a tax paid forever.' },
  { key: 'positioner', persona: 'the brand strategist. Hard rules: Fuelog wins on the endurance-fueling wedge, never generic macro tracking; every marketing claim must trace to real code; do NOT chase Bevel onto recovery-score turf (Bevel is now free, which proves that turf is scorched earth).' },
  { key: 'store-realist', persona: 'an App Store review and platform-risk expert. You care: guideline exposure (2.1 dead-ends, 3.1 payments, 5.1 privacy), subscription rules, TestFlight constraints, and anything that risks rejection or account standing.' },
  { key: 'skeptic', persona: 'the professional skeptic. Your ONLY job is the kill-case: the strongest argument this fails, the assumption most likely false, and the precedent of similar features that flopped. You never score above 5 unless the kill-case is genuinely weak.' },
]

phase('Deliberate')
const seats = await parallel(SEATS.map(s => () =>
  agent(
    `You are ${s.persona}\n\nThe idea under review for Fuelog (AI endurance-nutrition app, pre-launch, solo founder):\n"${IDEA}"\n${CTX}\n\nJudge it through YOUR lens only. Be concrete and unsparing; generic praise or generic caution is failure.`,
    { label: `seat:${s.key}`, phase: 'Deliberate', schema: SEAT_SCHEMA }
  ).then(r => ({ seat: s.key, ...r }))
))

phase('Synthesize')
const valid = seats.filter(Boolean)
const synthesis = await agent(
  `You are the council clerk. Five seats judged this idea for Fuelog:\n"${IDEA}"\n\nSeat verdicts (JSON):\n${JSON.stringify(valid, null, 2)}\n\n` +
  `Rules: (1) Do NOT manufacture consensus - if seats disagree, the disagreement IS the output; name which seats split and why. (2) The council can never bless an idea into existence: users validate, councils only de-risk. (3) You MUST design the cheapest real-world test that would settle the biggest open question (target: under a day of work). ` +
  `Return verdict as one of: build-now | cheap-test-first | post-launch | kill.`,
  {
    label: 'synthesis', phase: 'Synthesize', effort: 'high',
    schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['build-now', 'cheap-test-first', 'post-launch', 'kill'] },
        disagreement: { type: 'string' },
        rationale: { type: 'string' },
        cheapest_real_test: { type: 'string' },
      },
      required: ['verdict', 'disagreement', 'rationale', 'cheapest_real_test'],
    },
  }
)

return { idea: IDEA, seats: valid, synthesis }
