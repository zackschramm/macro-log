# supabase/staged/

Code that is WRITTEN and REVIEWED but must NOT deploy yet.

- ai-proxy-v3-DEPLOY-AFTER-APPROVAL.ts — ai-proxy with the entitlement gate
  (GATE_MODE secret: off/shadow/enforce) and vision max_tokens clamp.
  Council inversion #2: the gate never deploys mid-review. Deploy sequence
  after App Review approval: copy this file over functions/ai-proxy/index.ts,
  deploy with GATE_MODE unset (inert), set GATE_MODE=shadow, watch logs a day,
  then GATE_MODE=enforce. Demo accounts need manual entitlements rows FIRST
  (see migrations/20260824_entitlements.sql tail).
