import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import { parseGenerationLog, deriveStatus } from './generation-history';

/**
 * A BLOCKED GENERATION MUST SAY SO.
 *
 * The verdict pattern required the colon immediately after the verdict word, so every
 * `BLOCKED (classification):` line failed to match and the case was recorded as
 * UNREPORTED with an empty reason - "the generator never said what became of this row",
 * about a run that had said precisely what was wrong.
 */
let checks=0;
const check=(n:string,run:()=>void)=>{try{run();}catch(e:any){throw new Error(`FAIL ${n}: ${e?.message??e}`);}checks++;console.log('PASS '+n);};
const log=(...lines:string[])=>lines.join('\n');

const blocked=log(
  '=== TC_ONE (new) Log In — heading contains "Home"',
  '  writing tests-e2e/generated/north/TC_ONE.spec.ts',
  '  BLOCKED (authenticationCapability): authentication action 3 (fill Enter email): missing admissible interaction-time identity evidence',
  '',
  'autocode run id: 2026-09-14T10-58-07-715Z-l54pbs');
const parsedBlocked=parseGenerationLog(blocked);
check('a blocked generation is recorded as BLOCKED, not UNREPORTED',()=>{
  assert.equal(parsedBlocked.cases.length,1);
  assert.equal(parsedBlocked.cases[0].status,'BLOCKED');
  assert.notEqual(parsedBlocked.cases[0].status,'UNREPORTED');
});
check('its classification is retained as a code',()=>
  assert.equal(parsedBlocked.cases[0].code,'authenticationCapability'));
check('its reason is retained and not empty',()=>{
  assert.notEqual(parsedBlocked.cases[0].reason,'');
  assert.match(parsedBlocked.cases[0].reason,/missing admissible interaction-time identity evidence/);
});
check('the run id is still recovered',()=>assert.equal(parsedBlocked.runId,'2026-09-14T10-58-07-715Z-l54pbs'));
check('the run-level status reflects the blocked case',()=>
  assert.equal(deriveStatus(parsedBlocked.cases,0),'BLOCKED'));

// Verdicts that carry no qualifier must behave exactly as before.
const accepted=parseGenerationLog(log('=== TC_TWO (new) Something',
  '  ACCEPTED: Passed as written and failed with its assertions broken (expected text literal).'));
check('an unqualified ACCEPTED is unchanged',()=>{
  assert.equal(accepted.cases[0].status,'ACCEPTED');
  assert.equal(accepted.cases[0].code,undefined,'no qualifier means no invented code');
  assert.match(accepted.cases[0].reason,/^Passed as written/,'the reason is not prefixed when there is no code');
});
const quarantined=parseGenerationLog(log('=== TC_THREE (new) Something',
  '  QUARANTINED: Phase: EXECUTION | Reason: RUNTIME_FAILURE | Collected tests: 1.'));
check('an unqualified QUARANTINED is unchanged',()=>{
  assert.equal(quarantined.cases[0].status,'QUARANTINED');
  assert.match(quarantined.cases[0].reason,/RUNTIME_FAILURE/);
});
check('a row the generator never ruled on is still UNREPORTED',()=>{
  const silent=parseGenerationLog(log('=== TC_FOUR (new) Something','  writing a file'));
  assert.equal(silent.cases[0].status,'UNREPORTED');
  assert.equal(silent.cases[0].reason,'');
});
check('NOTE is still not a verdict',()=>{
  const noted=parseGenerationLog(log('=== TC_FIVE (new) Something','  NOTE: over the context budget'));
  assert.equal(noted.cases[0].status,'UNREPORTED','a remark never becomes a decision');
});
check('an indented framework line is not mistaken for a verdict',()=>{
  const noisy=parseGenerationLog(log('=== TC_SIX (new) Something',
    '      NEEDS REVIEW (2) - nothing was assembled, and no gate run was spent.',
    '  BLOCKED (navigationCausality): navigation requires review'));
  assert.equal(noisy.cases[0].status,'BLOCKED');
  assert.equal(noisy.cases[0].code,'navigationCausality');
});
check('no credential value can reach the reason - it carries only what the pipeline printed',()=>{
  const withLabel=parseGenerationLog(log('=== TC_SEVEN (new) Something',
    '  BLOCKED (authenticationCapability): authentication action 3 (fill Enter email): missing evidence'));
  assert.doesNotMatch(withLabel.cases[0].reason,/@/,'a field label is not an address');
});
console.log(`${checks} generation status contracts passed`);
