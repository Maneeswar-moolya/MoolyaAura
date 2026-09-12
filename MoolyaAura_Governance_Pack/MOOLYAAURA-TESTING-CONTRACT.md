# MoolyaAura Testing & Change Protocol

## Test Gates
1. Focused behavioral test — proves the exact behavior.
2. Mutation test — proves the test detects removal/corruption of the protection.
3. Corpus benchmark — measures before/after impact where locator/evidence/ranking behavior changes.
4. Artifact integrity — verifies no unintended writes.
5. Final regression — exactly one full regression after all changes are complete.

## Mutation Testing
Tests must validate behavior, not source-code presence. A mutation bites only when the relevant test becomes red after the protected behavior is intentionally removed or corrupted.

## Corpus Benchmark
For locator changes measure, where relevant:
- raw and retained candidates;
- proven candidates;
- zero-proven targets;
- ambiguous and wrong-target rejections;
- selected locator changes;
- Page Object reuse;
- candidate-budget pressure;
- latency;
- AI eligibility changes.

## Performance Measurement
> **Instrument before optimizing.**

"Slow" is not a finding. Attribute the time first, because these are different problems with different remedies and one of them is not the framework's at all:

- deterministic framework computation;
- browser round trips and runtime element measurement;
- corpus analysis;
- test collection;
- AI inference;
- AI transport latency;
- retry and repair loops.

Provider latency is not framework computation, and conflating them has produced optimizations aimed at the wrong layer. Report them separately, always.

Target correctness is never weakened to make generation faster. **Failing or requesting review quickly is a valid, safe outcome** — better than spending large amounts of provider time on something that cannot currently be proven — but it is an answer reached by the same standard, never a lower one.

Latency figures are observations with a date attached. They do not belong in governance; they belong in `MOOLYAAURA-CURRENT-STATE.md`.

## Failure Diagnosis
Before changing code, classify the issue:
- production defect;
- harness defect;
- stale/misaligned test assumption;
- evidence limitation;
- lifecycle/timing limitation;
- genuine framework limitation.

A harness correction is not automatically a framework improvement.

## Experiment Integrity
Never fabricate historical evidence, weaken identity gates to increase sample size, add arbitrary sleeps, or change ranking during a measurement-only experiment.

## Artifact Safety
A corpus baseline is a **fact about the repository at a moment, not a target**. Record the counts before a phase, compare after, and state the difference. A genuine recording added by a person changes the baseline and the change is recorded with it; a phase that changes a baseline for any other reason must document why before acceptance. Never adjust work to preserve a number, and never quote a stale number as if it were current — the counts live in `MOOLYAAURA-CURRENT-STATE.md` and are re-measured, not remembered.

The live corpus carries no synthetic test artifacts. An id made up by a test — `TC_TEST*` and its like — must never survive into an application's recordings, workbook or mappings.

## Fixture Isolation
> **A fixture must not be able to name a real application artifact, let alone write or delete one.**

This is stated as an ability removed, not a rule remembered, because the failure has happened: a fixture built a synthetic registry, resolved artifact paths that were nonetheless real, and its cleanup deleted a live project's recordings. A made-up application id is only made up until somebody registers it, and a registry users can edit makes that assumption less true over time, not more.

Two independent barriers, and both are required:

1. **Isolation** — a fixture that writes or deletes redirects the artifact root to a temporary directory outside the repository, so every path it can produce is inside that directory. The dangerous path is never constructed.
2. **A guard** — the delete a fixture uses refuses any path outside the active fixture root, including when no isolation is active at all. This catches the fixture that forgot barrier 1.

A fixture that deliberately runs *un*-isolated — because it is asserting something about the real repository — must refuse to proceed if a path it intends to create already exists.

Application-aware architecture requires application-aware validation. A sweep that judges generated artifacts must evaluate each application's artifacts under that application's own scope and fixture ownership; one scope applied to everything reports correct work as broken and lets real breakage through.

## Final Acceptance Checklist
- [ ] Objective is generalized and future-facing.
- [ ] Production-path cause is proven.
- [ ] Focused tests pass.
- [ ] Mutations bite.
- [ ] Corpus impact measured where relevant.
- [ ] No safety/identity gate weakened.
- [ ] No application-specific exception.
- [ ] Page Object reuse preserved.
- [ ] AI boundary preserved.
- [ ] Artifact integrity verified.
- [ ] No fixture wrote to, or deleted, a real application artifact.
- [ ] Exactly one final full regression.
- [ ] Documentation updated.
