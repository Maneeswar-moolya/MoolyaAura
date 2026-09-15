/** Source mutations in disposable guarded checkouts. Never edits the real framework. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const mapper = 'ai/autocode/from-recording.ts';
const mutants = [
  { name: 'hardcoded auth class', file: mapper,
    edits: [['const receiver = match ? receiverFor(match) : locator!;', "const receiver = match ? 'await loginPage.' + match.method + '()' : locator!;"]],
    gate: 'authentication composes proven non-LoginPage controls' },
  { name: 'foreign credential ownership', file: mapper,
    edits: [['(origin?.applicationId ?? recording.authoringOwners?.applicationId) !== activeScope().applicationId', '!origin']],
    gate: 'unproven or foreign authentication cannot use credentials' },
  { name: 'redirect replay and disclosure', file: mapper,
    edits: [["label: 'Observed browser navigation', code: [],", "label: 'Observed browser navigation', code: [`await page.goto(${JSON.stringify(action.value)});`],"]],
    gate: 'deliberate navigation retained and redirects never replayed' },
  { name: 'invented legacy navigation intent', file: mapper,
    edits: [["action.navigationCause !== 'intentional' || !replayableNavigation(action.value ?? '')", "!replayableNavigation(action.value ?? '')"]],
    gate: 'old navigation fails honestly without leaking transient URLs' },
  { name: 'session URL leak', file: 'ai/dashboard/navigation.ts',
    edits: [["&& !value.search && !value.hash", "&& true"]],
    gate: 'intentional navigation cannot emit session-bearing destinations' },
  { name: 'heading capability omitted', file: 'ai/autocode/abstraction/classify.ts',
    edits: [["if (role === 'assertion' && !isContainerElement(node)", "if (false && role === 'assertion' && !isContainerElement(node)"]],
    gate: 'assertion heading bootstraps deterministically' },
  { name: 'bootstrap requires preexisting class', file: 'ai/autocode/abstraction/semantic.ts',
    edits: [['if (!index.pages[owner] && !validBootstrap)', 'if (!index.pages[owner])']],
    gate: 'semantic review accepts only the proven bootstrap owner' },
  { name: 'fabricated assertion proof', file: 'ai/autocode/abstraction/classify.ts',
    edits: [['const proof = provenCandidate(evidence, role);', "const proof = provenCandidate(evidence, role) ?? { matchCount: 1, identityMatched: true, sameDocument: true };"]],
    gate: 'missing assertion identity is refused' },
  { name: 'navigation counted as an element', file: 'ai/autocode/abstraction/lifecycle.ts',
    edits: [["new Set(['codegen-locator', 'needs-review', 'unresolved'])", "new Set(['navigate', 'codegen-locator', 'needs-review', 'unresolved'])"],
      ['if (step.subject) continue;', ''], ['if (step.subject || !REQUIRES_PAGE_OBJECT.has(step.kind))', 'if (!REQUIRES_PAGE_OBJECT.has(step.kind))']],
    gate: 'navigation is excluded from element lifecycle' },
  { name: 'unproven composite reuse', file: mapper,
    edits: [["body.replace(/\\s/g, '') === expected.replace(/\\s/g, '')", 'true']],
    gate: 'Unproven composite body is never reused' },
  // Guards against the fixture silently depending on an ambient source environment again.
  { name: 'recorded-flow drops its explicit source environment', file: 'ai/autocode/recorded-flow.fixture.ts',
    edits: [["resolveExecutionContext(activeScope(), { sourceEnvironmentId: 'qa' })", 'resolveExecutionContext(activeScope(), {})']],
    gate: 'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE', raw: true },
  { name: 'generic AI fallback for mapping defect', file: 'ai/autocode/orchestrate.ts',
    edits: [["if (recordedResult && !recordedResult.assembled && recordedResult.block !== 'needsReview'",
      "if (false && recordedResult && !recordedResult.assembled && recordedResult.block !== 'needsReview'"]],
    gate: 'Deterministic failure never calls generic AI' },
];
const choice = process.argv.find(arg => arg.startsWith('--mutant='));
if (!choice && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename, `--mutant=${i}`],
      { stdio: 'inherit', timeout: 300000, windowsHide: true });
    assert.equal(child.status, 0, `Mutation ${i}: ${child.error ?? ''}`);
  }
  console.log(`PASS all ${mutants.length} recorded-flow source mutants killed`);
} else {
  require('./isolated-checkout');
  assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant = mutants[Number(choice?.split('=')[1])]; assert.ok(mutant);
  const before = fs.readFileSync(mutant.file, 'utf8'); let changed = before.replace(/\r\n/g, '\n');
  for (const [from, to] of mutant.edits) {
    assert.ok(changed.includes(from), `Mutation anchor: ${mutant.name}`);
    changed = changed.split(from).join(to);
  }
  try {
    fs.writeFileSync(mutant.file, changed);
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/autocode/recorded-flow.fixture.ts'], {
      env: { ...process.env, AURA_SYNTHETIC_FIXTURE_ROOT: '' }, encoding: 'utf8',
      timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    const output = child.stdout + child.stderr;
    assert.notEqual(child.status, 0, `SURVIVED: ${mutant.name}`);
    // `raw` mutants fail with a thrown product error rather than a named fixture gate.
    assert.ok((mutant as { raw?: boolean }).raw
        ? output.includes(mutant.gate)
        : output.includes(`FAIL ${mutant.gate}`) || output.includes(`[ERR_ASSERTION]: ${mutant.gate}`),
      `Wrong failure for ${mutant.name}: ${output}`);
    console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
  } finally { fs.writeFileSync(mutant.file, before); }
}
