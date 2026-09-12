# MoolyaAura Governance Pack

This pack separates permanent engineering principles from experimental findings and implementation history.

## Governance — durable, and the authority
- `MOOLYAAURA-ENGINEERING-PRINCIPLES.md` — master engineering rules and change philosophy.
- `MOOLYAAURA-ARCHITECTURE.md` — system and ownership contracts.
- `MOOLYAAURA-LOCATOR-CONTRACT.md` — locator intelligence and selection rules.
- `MOOLYAAURA-TESTING-CONTRACT.md` — testing, mutation, benchmark and acceptance protocol.

These four hold contracts and invariants only. Phase numbers, corpus counts, regression totals,
timings, transient defects and one-off experiment results are deliberately **not** here: they
expire, and a governance document that expires stops being read as law. Promote something into
governance only when it is a reusable architectural rule.

## Point-in-time — not governance
- `MOOLYAAURA-CURRENT-STATE.md` — an engineering handoff for the next coding agent: what is
  implemented today, what is measured, what is known broken, what is planned but absent.
  Everything in it is an observation with a date, and it is expected to go stale. Where it
  disagrees with the repository, the repository wins.

## Claude Code workflow
Before modifying production code:
1. Read this README and the relevant contract.
2. Inspect the current implementation and tests.
3. Reproduce the issue.
4. Prove the production-path cause.
5. State the generalized rule/invariant.
6. Implement the smallest justified change.
7. Run focused tests, mutation tests, relevant corpus checks, then one final full regression.
8. Report observed facts separately from interpretation and recommendation.

These repository documents are the authoritative engineering contract; conversation history is not.
