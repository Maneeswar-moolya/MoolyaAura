# MoolyaAura Locator Intelligence Contract

## Objective
> **Find the strongest locator for the exact recorded target.**

A strong locator combines exact target correctness, uniqueness, stability where measurable, maintainability, provenance and application/Page Object ownership.

The objective is not the strictest possible gate. It is: **aggressive in discovery, flexible about optional evidence, strict about target correctness.** Generate every candidate the evidence supports; let optional evidence — name stability, durability, quality signals — influence confidence, ranking and review status; and admit a candidate on proven target identity alone. Optional evidence that is absent or `unknown` does not by itself reject a candidate whose identity is deterministically proven. Hard safety requirements remain hard.

## Decision Order
1. Reuse an existing Page Object capability only where its runtime identity for this element is proven (see the Architecture contract). "Appropriate" is not a judgement made here.
2. Generate deterministic evidence-backed candidates.
3. Measure candidates against the live target.
4. Verify exact target identity.
5. Reject unsafe/ambiguous/wrong-target candidates.
6. Rank proven candidates.
7. Use AI only as controlled last-mile candidate generation when eligible.
8. Re-verify AI candidates through the same pipeline.

## Hard Rejections
Reject candidates that identify the wrong target, belong to another document, depend on unsafe generated identifiers, use forbidden mechanisms, rely on unsupported arbitrary position, bypass gates, or cross application ownership.

Forbidden mechanisms are refused wherever they appear in a locator chain, whether the recorder produced them or a resolver proposed them: `.first()`, `.last()`, `.nth()`, XPath, `force`, mouse coordinates, `dispatchEvent`, sleeps and retries. All of them make a locator resolve; none of them makes it correct. Nothing is stripped from a chain to make it pass — a chain is judged as it stands.

**`.nth()` is the one mechanism with an exception, and it is a measurement, not a relaxation.** It is admitted only where the browser recorded which of several matches was the element acted on, at the interaction, in the interaction's own document, with the index inside the measured match list. `.first()` and `.last()` have no such exception and are refused outright: neither states a position anybody chose, so there is nothing for evidence to back. An index with no measurement behind it is refused exactly like the rest.

## Strategy Contract
Every locator strategy the framework emits must declare its candidate family, the budget that family competes under, its measurement path, that it is scoreable, and — where it is expressed as a chained locator — that it can be rebuilt faithfully for measurement.

> An emitted strategy with no complete declaration is a test failure, not a missing candidate.

The failures this prevents are silent: an unmapped family is discarded by the budget, an unscoreable expression ranks last, and an expression that cannot be rebuilt can never be proven. None of them reports an error.

## Semantic Strategy
Role + accessible-name candidates may have exact and non-exact variants:
- exact helps control ambiguity;
- non-exact can survive appended state text;
- non-exact can become ambiguous.

Neither is universally preferred.

## Stability
`accessibleNameStable` means:
- `stable`: authoritative browser-computed name remained unchanged for the same target at the defined settled point;
- `changed`: authoritative name changed for the same target;
- `unknown`: stability could not be established safely.

Unknown is never stable.

Candidate durability is separate:
> whether the locator continues to identify the exact same target after a relevant state transition.

## Ranking
Ranking changes require objective evidence, corpus comparison, mutation coverage and proof of future-facing benefit. Never create a global ranking rule from one application-specific observation.

**Measuring a property does not make it a ranking input.** Accessible-name stability and candidate durability are collected as evidence and reported; neither participates in ranking. An experiment that measured a property and concluded "no ranking change" leaves ranking unchanged, and the conclusion is that the framework generates both forms and lets the existing gates refuse the wrong one — not that one form is preferred. Where two candidates are otherwise tied, a tie-break must not silently settle a question no measurement has answered.

## Generalization Test
Ask:
> If tomorrow we record 1,000 new targets in a new application, does this rule improve the framework's ability to resolve them?

If not, it is probably a patch rather than framework knowledge.
