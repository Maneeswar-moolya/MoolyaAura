# AI subsystem instructions

Read [AGENTS.md](../AGENTS.md) and its governance references first. MoolyaAura is a generic,
application-scoped framework. No application-specific knowledge is bundled with it.

- Resolve every artifact through the active application scope. Use explicit ownership,
  never registry cardinality or a URL-derived identity.
- Reuse measured Page Object capabilities before proposing methods. Knowledge enrichment
  is append-safe and idempotent; Page Object, knowledge and fixture writes are transactional.
- Preserve press/pick provenance, same-document target identity, candidate admissibility,
  deterministic scoring, and separate action versus assertion semantics. Unknown means review.
  `elementRef` names the element; `captureRef` names one capture of it. Two assertions
  around an interaction can share an elementRef but require separate captureRefs and
  measurements. Resolve an assertion through its own capture first; matching a locator
  string cannot establish target identity or substitute another assertion's evidence.
- Keep the recorder-owned UI out of retained user actions. Preserve accepted evidence and
  assertion provenance. Never invent a measurement or silently regenerate an accepted spec.
- Generation receives the selected application's facts and framework-managed authentication.
  Never put credentials into prompts or artifacts. Runtime AI is currently the existing
  Claude CLI integration; the Copilot provider abstraction remains planned.
- Verification requires a clean pass and a failure after assertion falsification. Do not
  change business expectations, force actions, or heal an assertion mismatch to obtain a pass.
- Contract fixtures run in guarded OS temporary checkouts populated by `testing/seed-project.ts`.
  Installed application artifacts must never be copied into that fixture environment.

Use [RECORDING-GUIDE.md](../RECORDING-GUIDE.md),
[ABSTRACTION-GUIDE.md](../ABSTRACTION-GUIDE.md),
[the generation brief](knowledge/brief.md), and the current
[handoff](../docs/history/REMAINING.md) for operational details.
Detailed historical rationale and measurements remain in
[AI-IMPLEMENTATION-NOTES.md](../docs/history/AI-IMPLEMENTATION-NOTES.md); its dated application
examples are not instructions to install or restore those projects.
