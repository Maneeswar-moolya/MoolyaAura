import '../testing/isolated-checkout';
/**
 * The DOM-evidence contract, pinned offline.
 *
 *   npx tsx ai/autocode/dom-evidence.fixture.ts
 *
 * No browser, no model, no network. It checks the three things that must hold before
 * anything is allowed to capture evidence: the bounds are enforced in one place, a
 * credential cannot survive the funnel, and a recording with no evidence keeps
 * working exactly as it does today.
 */

import { recordingSource } from '../testing/synthetic-data';
import fs from 'node:fs';
import path from 'node:path';

import {
  EVIDENCE_LIMITS, evidenceFor, evidenceUnavailable, isForbiddenKey, looksLikeSecretValue,
  redactNode, sanitiseEvidence, type RelatedNode, type TargetEvidence,
} from './dom-evidence';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, locatorMetrics } from './from-recording';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const related = (count: number, relationship: RelatedNode['relationship'], depth = 1): RelatedNode[] =>
  Array.from({ length: count }, (_, index) => ({
    tag: 'div', text: `node ${index}`, relationship, depth,
  }));

function targetEvidence(overrides: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    locator: "page.locator('#tc_summary_636432')",
    target: { tag: 'div', id: 'tc_summary_636432', text: 'Config Line Chart' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: null, ...overrides,
  };
}

function main(): void {
  process.stdout.write('\n== A — every bound is enforced in one place ==\n');
  const oversized = sanitiseEvidence([targetEvidence({
    ancestors: related(20, 'ancestor'),
    children: related(20, 'child'),
    descendants: [...related(20, 'descendant', 1), ...related(20, 'descendant', 9)],
    previousSiblings: related(20, 'previous-sibling'),
    nextSiblings: related(20, 'next-sibling'),
  })], '2026-08-14T00:00:00.000Z');
  const entry = oversized.targets[0];
  check('ancestors bounded', entry.ancestors.length === EVIDENCE_LIMITS.maxAncestors, String(entry.ancestors.length));
  check('children bounded', entry.children.length === EVIDENCE_LIMITS.maxChildren, String(entry.children.length));
  check('descendants bounded', entry.descendants.length === EVIDENCE_LIMITS.maxDescendants, String(entry.descendants.length));
  check('descendant depth bounded',
      entry.descendants.every(node => node.depth <= EVIDENCE_LIMITS.maxDescendantDepth));
  check('previous siblings bounded', entry.previousSiblings.length === EVIDENCE_LIMITS.maxPreviousSiblings);
  check('next siblings bounded', entry.nextSiblings.length === EVIDENCE_LIMITS.maxNextSiblings);
  check('the limits travel with the evidence', oversized.limits.maxAncestors === EVIDENCE_LIMITS.maxAncestors);

  const longText = 'x'.repeat(500);
  const truncated = redactNode({ tag: 'p', text: longText });
  check('text is truncated, never a page dump',
      (truncated.text?.length ?? 0) <= EVIDENCE_LIMITS.maxTextLength, String(truncated.text?.length));

  process.stdout.write('\n== B — a credential cannot survive the funnel ==\n');
  const secret = 'hunter2-not-a-real-password';
  const dangerous = sanitiseEvidence([targetEvidence({
    target: {
      tag: 'input', type: 'password', name: 'password', id: 'password_field',
      text: secret,
      aria: { 'aria-label': 'Password', 'aria-describedby': secret },
      data: { 'data-testid': 'password-input', 'data-auth-token': secret },
    },
  })], '2026-08-14T00:00:00.000Z');
  const serialised = JSON.stringify(dangerous);
  check('no captured value leaks', !serialised.includes(secret));
  check('the password field is still RECORDED as structure',
      dangerous.targets[0].target.type === 'password' && dangerous.targets[0].target.tag === 'input');
  check('its safe test id survives', dangerous.targets[0].target.data?.['data-testid'] === 'password-input');
  check('its token attribute does not', !('data-auth-token' in (dangerous.targets[0].target.data ?? {})));
  check('text is dropped for a credential-shaped field', !dangerous.targets[0].target.text);
  for (const key of ['password', 'otpCode', 'X-Authorization', 'data-session-token', 'cvv', 'apiKey', 'jwt'])
    check(`forbidden key: ${key}`, isForbiddenKey(key));
  for (const key of ['data-testid', 'aria-label', 'placeholder', 'name'])
    check(`allowed key: ${key}`, !isForbiddenKey(key));
  // Shape, not vocabulary: an identifier that mentions a credential is still an
  // identifier, and it is exactly the hook the next phase wants.
  check('a readable identifier is kept', !looksLikeSecretValue('password-input'));
  check('a JWT is refused', looksLikeSecretValue('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def456'));
  check('a long opaque token is refused', looksLikeSecretValue('sk-live-9f2b81c4d7e60a35bb12'));
  check('a sentence is kept', !looksLikeSecretValue('Enter your password to continue'));

  process.stdout.write('\n== C — uniqueness is measured or unknown, never inferred ==\n');
  const unknown = sanitiseEvidence([targetEvidence({ matchCount: null })], 'x');
  check('null survives sanitisation as null', unknown.targets[0].matchCount === null);
  check('it is not defaulted to 1', unknown.targets[0].matchCount !== 1);
  const measured = sanitiseEvidence([targetEvidence({ matchCount: 4 })], 'x');
  check('a measured count is preserved', measured.targets[0].matchCount === 4);

  process.stdout.write('\n== D — the recorded locator is preserved unchanged ==\n');
  check('locator is the join key, verbatim',
      oversized.targets[0].locator === "page.locator('#tc_summary_636432')");
  check('lookup by locator works', Boolean(evidenceFor(oversized, "page.locator('#tc_summary_636432')")));
  check('a locator with no evidence returns null', evidenceFor(oversized, "page.getByText('nope')") === null);

  process.stdout.write('\n== E — absent evidence is SAID, not silent ==\n');
  const missing = evidenceUnavailable('capture failed: the page navigated away');
  check('available is false', missing.available === false);
  check('a reason is always present', missing.reason.length > 0, missing.reason);
  check('an empty reason is replaced, never stored blank',
      evidenceUnavailable('   ').reason === 'no reason recorded');
  check('evidenceFor on unavailable returns null', evidenceFor(missing, 'anything') === null);
  check('evidenceFor on undefined returns null', evidenceFor(undefined, 'anything') === null);

  process.stdout.write('\n== F — backward compatibility: recordings with no evidence ==\n');
  for (const id of ['row_900001', 'row_900002', 'row_900003']) {
    const recording = parseRecording(recordingSource([
      "await page.getByRole('link', { name: 'Notifications' }).click();",
      "await page.getByRole('button', { name: 'Notification settings' }).click();",
      `await expect(page.locator('#${id}')).toContainText('Record summary');`,
    ]), { startUrl: '', browser: '', durationMs: 0 });
    check(`${id}: parses with evidence marked unavailable`,
        recording.evidence.available === false
        && recording.evidence.reason.includes('Codegen script'));
    const mapped = mapRecording(recording);
    const counts = locatorMetrics(mapped);
    // P0.1 raised the review count for recordings that both CLICK and ASSERT on a
    // dynamic scope: neither can be resolved without measured uniqueness.
    check(`${id}: unavailable evidence preserves safe actions but cannot grant automatic reuse`,
        counts.needsReviewCount >= 1 && counts.existingPageObjectReuseCount === 0
        && mapped.steps.filter(step => step.kind === 'codegen-locator').length === 2,
        `review=${counts.needsReviewCount} reuse=${counts.existingPageObjectReuseCount}`);
  }

  process.stdout.write('\n== G — nothing here touches a browser or a model ==\n');
  const source = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-evidence.ts'), 'utf8');
  check('no playwright import', !/from 'playwright|@playwright/.test(source));
  check('no child process', !/child_process|spawn\(/.test(source));
  check('no network', !/fetch\(|http\.|https\./.test(source));
  check('no model', !/claude|anthropic/i.test(source));
  const verify = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/verify.ts'), 'utf8');
  // NARROWED, AND STRICTER THAN THE STRING IT REPLACED.
  //
  // This used to be `!verify.includes('dom-evidence')` - the gate must not depend on
  // the evidence layer, so that evidence can never excuse a bad spec. The principle is
  // right and is kept below. The blanket check could not survive contact with
  // evidence-backed positional recovery, for a reason that is not a loophole: the proof
  // for an index CANNOT be in the spec text. A locator string carries no provenance, so
  // a shape-only rule can establish that an index is PRESENT and nothing more - which
  // quarantined TC_DASHBOARD_023, whose index was the one measured thing about it.
  //
  // So the gate reads evidence for exactly one purpose, and the checks below pin that
  // purpose rather than the absence of the import: it may ask which positional
  // expressions a recording PROVES, and it may not use evidence for anything else. The
  // mutation and the two runs stay untouched by it, which is what makes the gate still
  // a falsification test and not a rubber stamp.
  const evidenceImports = [...verify.matchAll(/import \{([^}]*)\} from '\.\/dom-evidence';/g)]
      .flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean));
  // The allow-list is by NAME, so widening it is a deliberate act. `isPositionProven`
  // replaced `isPositionProvenAgainstClickedTarget` when an assertion became able to
  // prove a position at its own pick: the gate re-derives what the RECORDING proves,
  // and a recording proves both timings - a press for an action, an assertion's own pick
  // for that assertion. Which timing a CONSUMER may act on is decided in
  // locator-quality.ts, not here, and the gate's teeth are unchanged either way.
  const ALLOWED_EVIDENCE_IMPORTS = ['isPositionProven', 'positionalExpression'];
  check('verify.ts reads evidence for positional proof only',
      evidenceImports.length > 0
      && evidenceImports.every(name => ALLOWED_EVIDENCE_IMPORTS.includes(name)),
      evidenceImports.join(', ') || 'nothing imported');
  check('and it imports nothing else from the evidence layer',
      !/from '\.\/dom-capture-source'|from '\.\/from-recording'/.test(verify));
  // The falsification half must be evidence-blind: a spec is broken and re-run on its
  // own terms, whatever any sidecar says.
  // Bounded by the NEXT top-level declaration, not a character count: a fixed window
  // ran off the end of the function and read the helper after it.
  const mutateStart = verify.indexOf('export function mutate(');
  const afterMutate = verify.indexOf('export ', mutateStart + 1);
  const mutateBody = verify.slice(mutateStart, afterMutate > 0 ? afterMutate : undefined);
  check('the mutator never consults evidence',
      !/Evidence|evidence/.test(mutateBody), 'mutate() is evidence-blind');
  check('and no run is skipped or excused on the strength of evidence',
      !/(isPositionProven|positionalExpression)[^\n]*\n?[^\n]*(verdict|accepted|skip)/.test(verify));

  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
