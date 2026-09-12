# MoolyaAura coding-agent instructions

## Purpose and authority

MoolyaAura is an established, generic multi-application automation framework that turns recorded user intent and authored test cases into maintainable Playwright automation. It is not a Keysight-specific framework. Preserve its architecture; do not restart or redesign it as a new project.

Read these authoritative references before framework work; this file is a concise entry point, not a replacement for them:

- [Engineering principles](MoolyaAura_Governance_Pack/MOOLYAAURA-ENGINEERING-PRINCIPLES.md)
- [Architecture contract](MoolyaAura_Governance_Pack/MOOLYAAURA-ARCHITECTURE.md)
- [Locator contract](MoolyaAura_Governance_Pack/MOOLYAAURA-LOCATOR-CONTRACT.md)
- [Testing contract](MoolyaAura_Governance_Pack/MOOLYAAURA-TESTING-CONTRACT.md)
- [Current engineering state](MoolyaAura_Governance_Pack/MOOLYAAURA-CURRENT-STATE.md)

Also read the `status_version` block in [REMAINING.md](docs/history/REMAINING.md), [CLAUDE.md](CLAUDE.md), and the relevant sections of [ai/CLAUDE.md](ai/CLAUDE.md). Current-state and handoff documents contain dated observations, not permanent guarantees. Verify implementation claims against the repository; report contradictions rather than silently treating historical behavior as the contract. The four governance contracts govern architecture and safety.

## Framework scope and AI roles

- Future applications must be addable through the dashboard and automatically provisioned without framework source-code changes. Application configuration and evidence-backed artifacts belong in the existing provisioning and lifecycle paths.
- Global MoolyaAura capabilities apply to every application. Application-specific Page Objects, components, recordings, evidence, knowledge, test cases, test data, mappings, fixtures, generated specs, results and history remain isolated by declared, immutable `applicationId`. Use the scope layer; never infer application identity from a URL or fall back to another application's artifacts.
- Investigate application-specific failures for reusable framework defects. Where appropriate, implement the smallest generalized solution; keep application facts in scoped configuration, knowledge and Page Objects. Do not add application-specific framework patches merely to make a case pass.
- **Development coding agent: Codex + GPT-6 Astra.** This is separate from the framework's embedded AI provider.
- **Target embedded/runtime AI: GitHub Copilot behind a provider abstraction.** MoolyaAura remains the deterministic authority. Provider output is a suggestion subject to the same identity, ownership, safety and validation gates. This is a target direction, not a claim that Copilot is already integrated; consult current state before provider work.

## Engineering discipline

- For non-trivial framework issues, reproduce the behavior, trace the production path and prove root cause with a focused behavioral test before implementation. Distinguish framework defects from harness defects, missing evidence and application behavior. Follow the governance pre-implementation gate.
- Preserve deterministic-first behavior, runtime target identity, provenance and Page Object reuse before creation. One match or a similar name is not identity; unknown is not success. Do not invent evidence, acceptance criteria, ownership or locators.
- Preserve append-safe, idempotent knowledge enrichment and transactional knowledge/Page Object/fixture writes. Retain recordings and evidence; never silently regenerate accepted specs or overwrite established capabilities. Follow the contracts for reviewed maintenance.
- Preserve mutation and falsification practices: protections need behavioral tests that fail when the protection is removed; generated specs must pass clean and fail under assertion mutation. Falsifiability alone does not prove the correct business requirement was tested. Never heal an assertion mismatch into a pass.
- Measure before optimizing. Compare relevant corpus impact, verify artifact integrity, and run exactly one final full regression after framework changes settle, as required by the testing contract. Report actual checks and exit codes; never present a historical baseline as a fresh run.

## Repository and execution safety

- Inspect git status first. Uncommitted, untracked and ignored files can contain essential architecture and irreplaceable evidence. Never casually run `git clean` or destructive resets; do not stash, revert, delete or overwrite existing work without explicit authorization for that action.
- Limit edits to the authorized task. Preserve application artifacts during framework work, including recordings, knowledge, Page Objects, generated specs, mappings, fixtures and workbooks, unless their modification is explicitly in scope. Do not fabricate historical fields or leak synthetic fixture artifacts into live data.
- Before running an artifact-writing fixture, verify temporary artifact-root isolation and the independent deletion guard in `ai/projects/fixture-safety.ts`. Never let fixture cleanup reach real application artifacts. Read-only tasks must not run commands that write artifacts.
- Keep the suites separate: `npm test` uses `playwright.config.ts` and `tests/`; `npm run excel:test` uses `playwright.excel.config.ts` and `tests-e2e/`. Never merge their configs or output directories. Offline `ai/**/*.fixture.ts` checks are a separate regression suite.
- Inspect command side effects. `npm run lint` regenerates README; `build` is not a typecheck; verification and execution can write artifacts.
- Keep credentials out of prompts, source, knowledge, recordings and reports. Preserve framework-managed authentication and independent test sessions.
- For implementation handoffs, update `docs/history/REMAINING.md` within the authorized scope with completed work, remaining work, blockers and the next action. Keep transient counts, timings and defects out of this file. Distinguish repository-proven findings from inference and recommendations.
