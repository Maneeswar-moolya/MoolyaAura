/**
 * Formatting does not decide whether a recorded step exists.
 *
 * THE DEFECT THIS EXISTS TO STOP COMING BACK
 *
 * `parseRecording` read the generated script a line at a time and required a whole
 * `await <receiver>.<method>(<args>);` on one of them. Codegen makes no such promise: it
 * wraps a call as soon as its arguments grow, and every wrapped action was then DROPPED.
 * Not mislabelled - absent. A person pressed a control, the source recorded it, and the
 * recording did not contain it.
 *
 * Measured on the real corpus before the correction: fifteen saved recordings each lost
 * exactly one action, always the same shape - a click Codegen wrote as
 * `.click({\n  modifiers: ['Alt']\n})`.
 *
 * The contracts below are about the PARSER. Whether a locator may then become reusable
 * automation knowledge is a separate question with its own gate, and one of these checks
 * exists only to prove the two stayed separate.
 */
import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import { parseRecording, flattenExpression, type Recording } from './recorder';
import { RecordingPictures } from '../diagnostics/recording';
import { authoringLocatorProblem } from './authoring-catalog';
import fs from 'node:fs';
import { workspaceData } from '../testing/workspace-data';
import { recordingSource } from '../testing/synthetic-data';
import { recordingMappingReview, saveRecordingMapping, draftOwnersFile } from './recording-mapping';
import type { RecordedAction, RecordedAssertion } from './recorder';

const wrap = (body: string) =>
  `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n${body}\n});\n`;
const parse = (body: string): Recording =>
  parseRecording(wrap(body), { startUrl: 'https://portal.example.invalid/home', browser: 'chromium', durationMs: 0 });
const shapeOf = (recording: Recording) => ({
  actions: recording.actions.map((action: RecordedAction) => ({
    type: action.type, target: action.target, locator: action.locator,
    strategy: action.locatorStrategy, value: action.value, redacted: action.redacted ?? false,
    cause: (action as any).navigationCause ?? null, reason: (action as any).navigationReason ?? null,
  })),
  assertions: recording.assertions.map((assertion: RecordedAssertion) => ({
    type: assertion.type, target: assertion.target, locator: assertion.locator,
    value: assertion.value, expected: assertion.expected, afterActions: assertion.afterActions,
  })),
});

/**
 * Each pair is the SAME call: one as Codegen writes it on a line, one as Codegen wraps it.
 * The contract is equality, not merely that both produce something.
 */
const EQUIVALENT: Array<[string, string, string]> = [
  ['click',
    `  await page.getByRole('button', { name: 'Continue' }).click();`,
    `  await page\n    .getByRole('button', {\n      name: 'Continue'\n    })\n    .click();`],
  ['click with an options object',
    `  await page.getByRole('textbox', { name: 'Password' }).click({ modifiers: ['Alt'] });`,
    `  await page.getByRole('textbox', { name: 'Password' }).click({\n    modifiers: ['Alt']\n  });`],
  ['click with a position option',
    `  await page.getByRole('link').click({ position: { x: 2, y: 3 }, button: 'left', clickCount: 1 });`,
    `  await page.getByRole('link').click({\n    position: { x: 2, y: 3 },\n    button: 'left',\n    clickCount: 1\n  });`],
  ['filter chain',
    `  await page.locator('div').filter({ hasText: 'Example' }).click();`,
    `  await page.locator('div')\n    .filter({\n      hasText: 'Example'\n    })\n    .click();`],
  ['fill',
    `  await page.getByRole('textbox', { name: 'Enter email' }).fill('someone@example.invalid');`,
    `  await page.getByRole('textbox', { name: 'Enter email' }).fill(\n    'someone@example.invalid'\n  );`],
  ['press',
    `  await page.getByRole('textbox').press('Enter');`,
    `  await page.getByRole('textbox').press(\n    'Enter'\n  );`],
  ['dblclick',
    `  await page.getByRole('cell').dblclick();`,
    `  await page\n    .getByRole('cell')\n    .dblclick();`],
  ['check',
    `  await page.getByRole('checkbox', { name: 'Agree' }).check();`,
    `  await page.getByRole('checkbox', {\n    name: 'Agree'\n  }).check();`],
  ['uncheck',
    `  await page.getByRole('checkbox', { name: 'Agree' }).uncheck();`,
    `  await page.getByRole('checkbox', {\n    name: 'Agree'\n  })\n  .uncheck();`],
  ['selectOption',
    `  await page.getByRole('combobox').selectOption('second');`,
    `  await page.getByRole('combobox').selectOption(\n    'second'\n  );`],
  ['hover',
    `  await page.getByRole('link', { name: 'More' }).hover();`,
    `  await page\n    .getByRole('link', { name: 'More' })\n    .hover();`],
  ['goto',
    `  await page.goto('https://portal.example.invalid/home');`,
    `  await page.goto(\n    'https://portal.example.invalid/home'\n  );`],
  ['assertion',
    `  await expect(page.getByTestId('sp-heading')).toContainText('Account Settings');`,
    `  await expect(page.getByTestId('sp-heading')).toContainText(\n    'Account Settings'\n  );`],
  ['negated assertion',
    `  await expect(page.getByTestId('sp-heading')).not.toBeVisible();`,
    `  await expect(\n    page.getByTestId('sp-heading')\n  ).not.toBeVisible();`],
  ['attribute assertion',
    `  await expect(page.getByTestId('panel')).toHaveAttribute('data-state', 'open');`,
    `  await expect(page.getByTestId('panel')).toHaveAttribute(\n    'data-state',\n    'open'\n  );`],
];

function main() {
  const { scope } = workspaceData();
  let checks = 0;
  const check = (condition: unknown, what: string) => { assert.ok(condition, what); checks++; };

  /* 1. One statement is one candidate action, whatever its formatting. */

  for (const [name, single, multi] of EQUIVALENT) {
    const one = parse(single), many = parse(multi);
    // Counted first and compared second, so a statement that VANISHED and a statement that
    // was SPLIT report different failures instead of both arriving as "not equal".
    check(one.actions.length + one.assertions.length === 1, `${name}: the single-line form is one step`);
    check(many.actions.length + many.assertions.length >= 1, `${name}: a wrapped statement must not vanish`);
    check(many.actions.length + many.assertions.length === 1,
      `${name}: a wrapped statement is ONE step, not one per line`);
    assert.deepEqual(shapeOf(many), shapeOf(one), `${name}: wrapping must not change what was recorded`);
    checks++;
  }

  /* 2. Order and indices are the source's, and a wrapped statement occupies one index. */

  const mixed = parse([
    `  await page.goto('https://portal.example.invalid/home');`,
    `  await page.getByRole('link', { name: 'Log In' }).click();`,
    `  await page.getByRole('textbox', { name: 'Enter email' }).fill('someone@example.invalid');`,
    `  await page.getByRole('textbox', { name: 'Password' }).click({`,
    `    modifiers: ['Alt']`,
    `  });`,
    `  await page.getByRole('textbox', { name: 'Password' }).fill('not-a-real-value');`,
    `  await page\n    .getByRole('button', { name: 'Log In' })\n    .click();`,
    `  await expect(page.getByTestId('sp-heading')).toContainText(\n    'Account Settings'\n  );`,
  ].join('\n'));
  assert.deepEqual(mixed.actions.map(action => `${action.type}|${action.target}`), [
    'navigate|https://portal.example.invalid/home', 'click|Log In', 'fill|Enter email',
    'click|Password', 'fill|Password', 'click|Log In',
  ], 'the recorded order is the source order, and the wrapped click sits where it was performed');
  checks++;
  check(mixed.assertions[0]?.afterActions === 6,
    `the assertion still counts the actions before it: ${mixed.assertions[0]?.afterActions}`);
  // The step keys the review and the screenshots share are these indices.
  check(mixed.actions.filter(action => action.type !== 'navigate').length === 5,
    'five reviewable steps, one of them recovered from a wrapped statement');

  /* 3. An options object keeps the action it belongs to. */

  const withOptions = parse(`  await page.getByRole('textbox', { name: 'Password' }).click({\n    modifiers: ['Alt']\n  });`);
  check(withOptions.actions.length === 1 && withOptions.actions[0].type === 'click',
    'a click with modifiers is still a click');
  check(withOptions.actions[0].locator === `page.getByRole('textbox', { name: 'Password' })`,
    `the locator is the single-line spelling: ${withOptions.actions[0].locator}`);
  check(withOptions.actions[0].value === null, 'a click carries no value, options or not');

  /* 4. Navigation provenance survives a wrapped goto. */

  const marker = ' // @aura-navigation observed id=nav-2 reason=http-redirect documents=1 history=0 other=0 unresolved=0';
  const navigated = parse(`  await page.goto(\n    "https://portal.example.invalid/next"\n  );${marker}`);
  check(navigated.actions[0]?.type === 'navigate', 'a wrapped goto is still a navigation');
  check((navigated.actions[0] as any).navigationCause === 'observed',
    `its cause survives: ${(navigated.actions[0] as any).navigationCause}`);
  check((navigated.actions[0] as any).navigationReason === 'http-redirect', 'and so does its reason');
  check(JSON.stringify((navigated.actions[0] as any).navigationCounts) === JSON.stringify(
    { documents: 1, history: 0, other: 0, unresolved: 0 }), 'and its counts');
  const unmarked = parse(`  await page.goto(\n    "https://portal.example.invalid/next"\n  );`);
  check((unmarked.actions[0] as any).navigationCause === 'unknown',
    'a wrapped goto with no marker is unknown, never assumed');

  /* 5. Credential redaction is untouched by the move to statements. */

  const sensitive = parse(`  await page.getByRole('textbox', { name: 'Password' }).fill(\n    'a-real-looking-secret'\n  );`);
  check(sensitive.actions[0]?.type === 'fill', 'a wrapped fill is still a fill');
  check(sensitive.actions[0].redacted === true, 'a wrapped credential fill is still redacted');
  check(sensitive.actions[0].value === '[type=password]', 'and carries the placeholder, not the value');
  check(!JSON.stringify(sensitive).includes('a-real-looking-secret'),
    'the typed value does not survive anywhere in the recording');
  check(sensitive.metrics.redactedValues === 1, 'and the redaction is counted');

  /* 6. Literals are not reformatted, and spacing outside them is canonical. */

  check(flattenExpression(`page.getByText('a  b\\n  c')`) === `page.getByText('a  b\\n  c')`,
    'whitespace inside a literal is left exactly as recorded');
  check(flattenExpression(`page\n  .getByRole('button', {\n    name: 'Go'\n  })`)
    === `page.getByRole('button', { name: 'Go' })`, 'a wrapped chain flattens to the single-line spelling');
  check(flattenExpression(`page.getByRole('button', { name: 'Go' })`)
    === `page.getByRole('button', { name: 'Go' })`, 'and an already single-line chain is unchanged');

  /* 7. Screenshot attribution: restored by the action, never by tolerating a mismatch. */

  const pictures = new RecordingPictures(scope);
  const closed = { isClosed: () => true } as any;
  const steps = ['click', 'click', 'fill', 'click', 'fill', 'click', 'click', 'click', 'click', 'click'];
  for (let at = 0; at < steps.length; at++) {
    void pictures.begin(closed, steps[at], `internal:step=${at}`, false, 'doc-1');
  }
  // One capture per observation, so a paired run has something to attribute.
  for (const observation of pictures.observations)
    observation.captures.push({ captureRef: `ref-${observation.id}`, captureType: 'BEFORE_ACTION',
      recordingStepKey: observation.id, capturedAt: '1970-01-01T00:00:00.000Z', route: '/home',
      artifact: `recordings/x/${observation.id}.png` });
  check(pictures.observations.length === 10, `ten observations were recorded: ${pictures.observations.length}`);

  const tenActions: RecordedAction[] = steps.map((type, at) => ({
    type: type as RecordedAction['type'], target: `t${at}`, locator: `page.getByTestId('t${at}')`,
    locatorStrategy: 'getByTestId', value: null,
  }));
  const paired = pictures.finish(tenActions, []);
  check(pictures.attribution?.paired === true,
    `ten observations and ten actions attribute: ${JSON.stringify(pictures.attribution)}`);
  check(paired.length === 10, 'every action picture reaches a step');
  check(new Set(paired.map(capture => capture.recordingStepKey)).size === 10,
    'and each one reaches a DIFFERENT step');

  // Remove one action - the exact shape the dropped statement produced - and the
  // all-or-nothing rule must still refuse. Restoring the action is the fix; tolerating
  // the mismatch would be a guess about which nine of ten screenshots belong where.
  const nineActions = tenActions.slice(0, 9);
  const refused = pictures.finish(nineActions, []);
  check(pictures.attribution?.paired === false, 'ten observations and nine actions do not pair');
  check(refused.length === 0, 'and nothing is attributed rather than nine being guessed');
  check(pictures.attribution?.observedActions === 10 && pictures.attribution?.recordedActions === 9,
    'the two counts are reported as the reason');

  /* 8. The parser fix does not make a positional locator safe. */

  const positional = parse(`  await page.locator('div')\n    .filter({\n      hasText: 'Close1closeSELECTED ASSETS'\n    })\n    .nth(1)\n    .click();`);
  check(positional.actions.length === 1, 'the wrapped positional statement is recovered as one action');
  check(positional.actions[0].locator === `page.locator('div').filter({ hasText: 'Close1closeSELECTED ASSETS' }).nth(1)`,
    `and keeps its recorded chain: ${positional.actions[0].locator}`);
  check(authoringLocatorProblem(positional.actions[0].locator)?.code === 'POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN',
    'existing in the recording and being safe to reuse remain separate questions');

  /* 9. Statements this parser has never been taught are still skipped, not guessed. */

  const unknown = parse([
    `  await page.waitForTimeout(500);`,
    `  await page.getByRole('button', { name: 'Go' }).click();`,
  ].join('\n'));
  check(unknown.actions.length === 1 && unknown.actions[0].target === 'Go',
    'an unsupported call is skipped, and the action after it is still recorded');

  /* 10. Recovering an action renumbers the steps after it, and a sidecar says which
         stream it was written against rather than being re-applied to a different one. */

  const recovered = recordingSource([
    `await page.goto('https://portal.example.invalid/home');`,
    `await page.getByTestId('continue').click();`,
  ]);
  const draft: any = { source: recovered,
    recording: parseRecording(recovered, { startUrl: '', browser: 'chromium', durationMs: 0 }) };
  const review = recordingMappingReview(scope, draft);
  // Bound to an ESTABLISHED capability, named from the catalog rather than guessed.
  const owner = review.authoring.objects.find(object => object.className === 'FirstPage')!;
  saveRecordingMapping(scope, draft, {
    applicationId: scope.applicationId, revision: review.revision, mappingVersion: review.mappingVersion,
    stepKey: 'action:1', page: { name: owner.pages[0], create: false } as any,
    pageObject: { name: 'FirstPage', create: false }, executionMode: 'PAGE_OBJECT_METHOD', method: 'control',
  } as any);
  const sidecar = JSON.parse(fs.readFileSync(draftOwnersFile(scope, recovered), 'utf8'));
  check(sidecar.revision === review.revision,
    'a saved sidecar records the step stream its choices were made against');

  // The same source, parsed into a DIFFERENT stream - which is exactly what recovering a
  // dropped action does to every index after it. The stored choices must not be re-applied
  // to steps they were never made against; `action:5` meaning a different control is the
  // "wrong control bound" failure arriving with no error at all.
  const shifted: any = { source: recovered, recording: { ...draft.recording,
    actions: [...draft.recording.actions, { type: 'click', target: 'extra',
      locator: `page.getByTestId('extra')`, locatorStrategy: 'getByTestId', value: null }] } };
  assert.throws(() => recordingMappingReview(scope, shifted),
    /different recorded step stream/, 'a sidecar from another step stream is refused, not applied');
  checks++;
  check(fs.readFileSync(draftOwnersFile(scope, recovered), 'utf8').includes('"revision"'),
    'and the sidecar itself was not touched by the refusal');

  console.log(`PASS ${checks} recording statement contracts`);
}

main();
