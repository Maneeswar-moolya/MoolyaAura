# MoolyaAura Engineering Principles

## Purpose
MoolyaAura is a project-aware, evidence-driven AI test automation platform that turns recorded user intent into maintainable Playwright automation using deterministic locator intelligence, reusable Page Object capabilities, project knowledge, runtime verification and controlled AI assistance.

## Non-Negotiable Principle
> **Build generalized framework knowledge, not application-specific fixes.**

A production change must improve a reusable capability, correctness invariant, safety property, or measurable framework behavior for future targets/applications. A change whose primary purpose is only to make an existing locator pass is not acceptable unless explicitly classified as migration or defect correction.

## Core Principles
1. Deterministic-first; AI last-mile.
2. Target correctness over cardinality: one match is not proof.
3. Flexible evidence, strict identity.
4. Page Objects are first-class knowledge.
5. Project/application isolation is mandatory.
6. Evidence before optimization.
7. Unknown is not success.
8. No arbitrary waits to manufacture experimental results.
9. Regression is part of the feature.
10. Every permanent optimization must be future-facing and reusable.
11. Knowledge grows by proven addition; automated enrichment is idempotent and never degrades what is already established.

## Change Classification
- Framework capability — reusable future-facing intelligence.
- Framework correctness — generalized defect/invariant correction.
- Experiment/instrumentation — evidence collection without changing production behavior.
- Test/fixture hardening — stronger proof of existing contracts.
- Application-specific patch — normally prohibited; requires explicit justification.

## Mandatory Pre-Implementation Gate
1. Reproduce the behavior.
2. Identify the exact production-path cause.
3. Prove it with a focused behavioral test.
4. Classify the cause: production defect, harness defect, evidence limitation, experiment limitation, or genuine framework limitation.
5. Define the generalized rule/invariant.
6. Define acceptance and mutation tests.
7. Estimate corpus and artifact impact.
8. Implement the smallest generalized change.

## Experiment Rule
Experiments must answer measurable questions. Do not convert an experiment into a permanent ranking or selection rule without sufficient evidence.

## Definition of Done
- generalized objective is clear;
- focused tests pass;
- mutations bite;
- relevant corpus impact is measured;
- no unsafe gates were weakened;
- artifact integrity is verified;
- exactly one final full regression is run;
- permanent knowledge is separated from open experiments.
