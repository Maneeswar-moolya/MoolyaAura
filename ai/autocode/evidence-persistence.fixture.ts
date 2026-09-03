/**
 * Does SAVING a recording actually write its evidence to disk?
 *
 *   npx tsx ai/autocode/evidence-persistence.fixture.ts
 *
 * This fixture exists because the previous one could not fail. It created the
 * `.evidence.json` itself and then asserted that reading, validating and deleting it
 * worked - all of which was true while the production write was missing entirely.
 * TC_LOGIN_053, 054 and 055 were all recorded and saved with no sidecar, and 46 green
 * checks said nothing.
 *
 * So every check below drives the REAL production function, `persistRecording()` - the
 * one `keepArtifactFor()` calls - and never writes a sidecar itself. Delete the write
 * from that function and this file goes red on its first check.
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  evidenceUnavailable, sanitiseEvidence, type RecordingEvidence, type TargetEvidence,
} from './dom-evidence';
import { locatorMetrics, mapRecording, readEvidence } from './from-recording';
import {
  artifactPath, discardArtifact, evidencePath, parseRecording, persistRecording,
} from '../dashboard/recorder';

const ROOT = process.cwd();
const CASE_ID = 'TC_EVID_PERSIST';
/** A second id, so the stale test cannot be confused with the main one. */
const STALE_ID = 'TC_EVID_STALE';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const SCRIPT = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://my.bugasura.io/');
  await page.getByText('Faclon labs').click();
  await expect(page.locator('#tc_summary_639978')).toContainText('Line Chart : Getting flat');
  await page.locator('#tc_summary_639978').getByText('Line Chart : Getting flat').click();
});`;

/**
 * A graph shaped like the live capture produces, for the TC_LOGIN_055 targets.
 *
 * The values are the ones measured live on Bugasura during the TC_LOGIN_042
 * investigation - an unclassed span whose PARENT carries the responsive classes,
 * inside `#bugReport-table`. TC_LOGIN_055 itself is only a reference here; it is never
 * written to, regenerated or modified.
 */
function graphFor(locator: string): TargetEvidence {
  return {
    locator,
    target: { tag: 'span', text: 'Line Chart : Getting flat line for Weekly and monthly' },
    parent: { tag: 'div', id: 'tc_update_summary_639978',
      stableClasses: ['bug-report__summary--text', 'hidden-xs'] },
    ancestors: [
      { tag: 'div', id: 'tr_639978', relationship: 'ancestor', depth: 2 },
      { tag: 'div', id: 'bugReport-table', relationship: 'ancestor', depth: 3 },
    ],
    children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: ['parent', 'ancestor'], matchCount: 1,
    captureTiming: 'before-action', attached: true,
    viewport: { inViewport: false, scrollRequired: true, width: 640, height: 32 },
    identifier: { raw: 'tc_summary_639978', dynamic: true, normalised: 'tc_summary_<dynamic>' },
    derivedCandidates: [
      { strategy: 'scoped-parent-class-pair',
        expression: 'page.locator("#bugReport-table .bug-report__summary--text.hidden-xs")',
        matchCount: 1 },
      { strategy: 'parent-class', expression: 'page.locator(".bug-report__summary--text")', matchCount: 26 },
    ],
  };
}

function availableEvidence(): RecordingEvidence {
  return sanitiseEvidence(
      [graphFor("page.locator('#tc_summary_639978')"),
        graphFor("page.locator('#tc_summary_639978').getByText('Line Chart : Getting flat')")],
      new Date(0).toISOString(),
      { transport: 'live', targetCount: 2, failures: 0, beforeActionCount: 2,
        afterActionCount: 0, evidenceBytes: 0 });
}

function main(): void {
  try {
    process.stdout.write('\n== A — the production save writes BOTH files ==\n');
    // Nothing below creates a sidecar. If `persistRecording` stops writing one, the
    // very next check fails.
    const evidence = availableEvidence();
    const returned = persistRecording(CASE_ID, SCRIPT, evidence);
    check('A: the script was written', fs.existsSync(artifactPath(CASE_ID)));
    check('A: *** the sidecar was written by the production save ***',
        fs.existsSync(evidencePath(CASE_ID)), evidencePath(CASE_ID));
    check('A: it returns the .spec.ts path, as before',
        returned === `ai/dashboard/recordings/${CASE_ID}.spec.ts`, String(returned));
    check('A: the sidecar sits beside the script under the same ID',
        path.dirname(evidencePath(CASE_ID)) === path.dirname(artifactPath(CASE_ID))
        && path.basename(evidencePath(CASE_ID)) === `${CASE_ID}.evidence.json`);

    process.stdout.write('\n== B — what was persisted is what was held ==\n');
    const persisted = JSON.parse(fs.readFileSync(evidencePath(CASE_ID), 'utf8'));
    check('B: byte-for-byte the same document',
        JSON.stringify(persisted) === JSON.stringify(evidence));
    check('B: both targets survived', persisted.targets.length === 2, String(persisted.targets.length));
    check('B: the measured candidate survived',
        persisted.targets[0].derivedCandidates?.[0]?.matchCount === 1);
    check('B: the ambiguous candidate was already dropped by the funnel',
        !JSON.stringify(persisted).includes('"matchCount": 26'));
    check('B: capture timing survived', persisted.targets[0].captureTiming === 'before-action');
    check('B: viewport facts survived', persisted.targets[0].viewport?.scrollRequired === true);

    process.stdout.write('\n== C — P0.3 telemetry rides along, unchanged ==\n');
    check('C: transport recorded', persisted.recording?.transport === 'live', String(persisted.recording?.transport));
    check('C: targetCount recorded', persisted.recording?.targetCount === 2);
    check('C: beforeActionCount recorded', persisted.recording?.beforeActionCount === 2);
    check('C: failures recorded', persisted.recording?.failures === 0);
    check('C: no new telemetry file was created',
        !fs.existsSync(path.join(ROOT, 'ai', 'dashboard', 'recordings', `${CASE_ID}.telemetry.json`)));

    process.stdout.write('\n== D — the read side loads exactly this ==\n');
    const loaded = readEvidence(CASE_ID);
    check('D: readEvidence finds it', loaded.available === true);
    check('D: same targets', loaded.available && loaded.targets.length === 2);
    const mapping = mapRecording(parseRecording(SCRIPT, {
      startUrl: '', browser: '', durationMs: 0, evidence: loaded,
    }));
    const counts = locatorMetrics(mapping);
    check('D: generation sees the evidence', counts.domEvidence.captured === true);
    check('D: and its timing', counts.domEvidence.beforeActionCount === 2,
        String(counts.domEvidence.beforeActionCount));
    const assertion = mapping.assessments.find(entry => entry.from.startsWith('assert contains'));
    check('D: the dynamic assertion resolved to the measured candidate',
        assertion?.assessment.expression === 'page.locator("#bugReport-table .bug-report__summary--text.hidden-xs")',
        String(assertion?.assessment.expression));
    // SCOPED TO WHAT THIS FIXTURE IS ABOUT. It used to assert that NOTHING needed
    // review, which was true when the only reviewable thing in the script was the
    // dynamic id this evidence resolves. The script also clicks
    // `page.getByText('Faclon labs')`, for which no evidence is persisted here - and an
    // unscoped text locator that nothing measured is refused now, because TC_LOGIN_096
    // shipped one and Playwright rejected it at run time. That refusal is correct and
    // has nothing to do with persistence, so the assertion is about the targets this
    // fixture actually persists evidence for.
    check('D: no dynamic-id target needs review any more',
        !mapping.needsReview.some(step => /tc_summary|contains/.test(step.from)),
        mapping.needsReview.map(step => step.from).join(', ') || '(none)');
    check('D: no generated id is emitted',
        !mapping.steps.filter(step => step.kind !== 'needs-review')
            .some(step => step.code.join(' ').includes('tc_summary_639978')));

    process.stdout.write('\n== E — accept/discard removes both ==\n');
    discardArtifact(CASE_ID);
    check('E: the script is gone', !fs.existsSync(artifactPath(CASE_ID)));
    check('E: the sidecar is gone with it', !fs.existsSync(evidencePath(CASE_ID)));
    check('E: and the read side says so', readEvidence(CASE_ID).available === false);

    process.stdout.write('\n== F — unavailable evidence: save still succeeds, no file ==\n');
    const unavailable = evidenceUnavailable('live capture was active but located no target');
    const savedAnyway = persistRecording(CASE_ID, SCRIPT, unavailable);
    check('F: the script was still saved', fs.existsSync(artifactPath(CASE_ID)));
    check('F: the save reported success', savedAnyway !== null, String(savedAnyway));
    check('F: NO misleading evidence file was created', !fs.existsSync(evidencePath(CASE_ID)));
    check('F: and the reason is preserved where the architecture keeps it',
        (() => {
          const parsed = parseRecording(SCRIPT, {
            startUrl: '', browser: '', durationMs: 0, evidence: unavailable,
          });
          return !parsed.evidence.available
            && parsed.evidence.reason === 'live capture was active but located no target';
        })());
    check('F: generation degrades to Phase 7 behaviour',
        mapRecording(parseRecording(SCRIPT, { startUrl: '', browser: '', durationMs: 0 }))
            .needsReview.length > 0);
    discardArtifact(CASE_ID);

    process.stdout.write('\n== G — a stale sidecar can never outlive its recording ==\n');
    // An old sidecar for this ID, exactly as a previous recording would have left it.
    fs.mkdirSync(path.dirname(evidencePath(STALE_ID)), { recursive: true });
    fs.writeFileSync(evidencePath(STALE_ID), JSON.stringify(availableEvidence(), null, 2), 'utf8');
    check('G: the stale sidecar exists before the new save', fs.existsSync(evidencePath(STALE_ID)));
    persistRecording(STALE_ID, SCRIPT, evidenceUnavailable('recorded on the codegen transport'));
    check('G: *** the new save removed it ***', !fs.existsSync(evidencePath(STALE_ID)));
    check('G: the new script is there', fs.existsSync(artifactPath(STALE_ID)));
    check('G: so generation cannot pair old evidence with the new recording',
        readEvidence(STALE_ID).available === false);
    // And the same when the new recording DOES have evidence: replaced, not merged.
    persistRecording(STALE_ID, SCRIPT, sanitiseEvidence(
        [graphFor("page.locator('#only_one')")], new Date(0).toISOString()));
    const replaced = readEvidence(STALE_ID);
    check('G: a new graph replaces the old one entirely',
        replaced.available && replaced.targets.length === 1
        && replaced.targets[0].locator === "page.locator('#only_one')",
        replaced.available ? String(replaced.targets.length) : 'unavailable');
    discardArtifact(STALE_ID);

    process.stdout.write('\n== H — the wiring: keepArtifactFor must call it ==\n');
    const source = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/recorder.ts'), 'utf8');
    const keepBody = source.slice(source.indexOf('export function keepArtifactFor'),
        source.indexOf('export function persistRecording'));
    check('H: keepArtifactFor delegates to persistRecording',
        // The first three arguments are still pinned in order - this check exists
        // because the write was once lost to a patch that silently did not apply.
        // A fourth is allowed: P1.2c added the recorded state assertions, and
        // `assertion-persistence.fixture.ts` is what pins that one.
        /return persistRecording\(testCaseId, held\.source, held\.recording\.evidence[,)]/.test(keepBody),
        keepBody.split('\n').find(line => line.includes('persistRecording'))?.trim());
    check('H: it passes the HELD evidence, not a fresh object',
        /held\.recording\.evidence/.test(keepBody));
    check('H: persistRecording uses the existing evidencePath helper',
        /const sidecar = evidencePath\(testCaseId\)/.test(source));
    check('H: the stale removal comes before the availability check',
        source.indexOf('fs.rmSync(sidecar, { force: true })')
          < source.indexOf('if (evidence.available)'));
    check('H: no second path convention was introduced',
        (source.match(/\.evidence\.json/g) ?? []).length === 1,
        `${(source.match(/\.evidence\.json/g) ?? []).length} literal(s)`);

    process.stdout.write('\n== I — TC_LOGIN_055 as a reference, never modified ==\n');
    const real = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_055.spec.ts');
    if (fs.existsSync(real)) {
      const realScript = fs.readFileSync(real, 'utf8');
      const parsed = parseRecording(realScript, { startUrl: '', browser: '', durationMs: 0 });
      check('I: its assertions are executable (P0.3 held)', parsed.assertions.length === 3,
          String(parsed.assertions.length));
      const withEvidence = mapRecording(parseRecording(realScript, {
        startUrl: '', browser: '', durationMs: 0,
        evidence: sanitiseEvidence([
          graphFor("page.locator('#tc_summary_639978')"),
          graphFor("page.locator('#tc_summary_639978').getByText('Line Chart : Getting flat')"),
        ], new Date(0).toISOString()),
      }));
      check('I: had its evidence been persisted, generation would resolve it',
          !withEvidence.needsReview.some(step => /tc_summary|contains/.test(step.from)),
          withEvidence.needsReview.map(step => step.from).join(', ') || '(none)');
      check('I: TC_LOGIN_055 files untouched by this fixture',
          fs.existsSync(real) && !fs.existsSync(evidencePath('TC_LOGIN_055')));
    } else {
      check('I: TC_LOGIN_055 artifact present', false, 'missing');
    }
  } catch (error) {
    check('the fixture ran to completion', false, String(error).slice(0, 240));
  } finally {
    discardArtifact(CASE_ID);
    discardArtifact(STALE_ID);
  }

  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
