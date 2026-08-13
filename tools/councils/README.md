# Fuelog Councils

Two reusable multi-agent councils, run by Claude (Cowork) on request. The scripts are
Workflow definitions — Claude executes them with its Workflow tool.

## Review Council — adversarial code review
Say: **"review council the last N commits"** (or a branch/range).
Five lenses (correctness, security, data-integrity, UI-truth, regression) review the diff
independently; every finding then faces a skeptical verifier that tries to refute it.
Only confirmed findings survive. Findings are ranked P1/P2/P3 with concrete failure scenarios.

## Idea Council — de-risk, never bless
Say: **"council this idea: <the idea>"**.
Five opposed seats (endurance athlete, solo-founder operator, brand positioner, App Store
realist, professional skeptic) argue independently; a clerk synthesizes WITHOUT manufacturing
consensus and must design the cheapest real-world test (<1 day).
Verdicts: build-now | cheap-test-first | post-launch | kill.
House rule: users validate ideas; the council only finds kill-cases and cheap tests.
