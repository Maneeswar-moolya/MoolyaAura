# Recording Review save failure: the refusal named the wrong rule

**Measured 2026-09-15 against the live dashboard and this working tree.** The gate was
right. The sentence it printed was not, and that is the whole defect.

## The exact rejection

Read from the running dashboard, read-only
(`GET /api/record/ownership?applicationId=ksp&environmentId=stg`), step `action:12`:

```
label       click div
locator     page.locator('div').filter({ hasText: 'Close1closeSELECTED ASSETS' }).nth(1)
route       null
documentId  null
evidence    missing
provenance  USER_BINDING_INCOMPLETE
```

The submitted locator is that string. With `+ Create method` on a **new** Page Object,
`saveRecordingMapping` takes `input.locatorOverride || step.locator`, finds no existing
method to reuse, and calls `validateAuthoringLocator(step.locator)`.

`ai/dashboard/authoring-catalog.ts` evaluated five independent conditions and threw one
sentence for all of them. Run against the exact string:

| condition | result |
| --- | --- |
| not a string | false |
| over 4000 characters | false |
| **does not start with `page.getBy…(` / `page.locator(`** | **false — it does start with `page.locator(`** |
| `forbiddenMechanisms(locator)` non-empty | **true → `["nth() - chosen by position, and nobody chose a position"]`** |
| contains a credential | false |

So the rule that refused it is the **forbidden-mechanism rule**, specifically the
positional one in `ai/autocode/abstraction/validate.ts` (`/\.nth\s*\(/`, and
`isPositionalLocator` behind it). The message named the prefix rule, which passed.

Everything else was ruled out by measurement, not by inference:

- **`.filter()` is supported.** The identical chain with only `.nth(1)` removed is
  accepted. `filter` is on the allowed call list alongside `getBy…`, `locator`, `and`, `or`.
- **Not malformed, not a quoting or serialization problem.** The expression parses as one
  TypeScript expression.
- **It is prefixed with `page`** in the submitted request, exactly as the screen showed.
- **`.nth(1)` is involved, and it is the whole of it.**

## Locator safety is unchanged

`.nth()` is still refused. The locator contract admits an index only where the browser
measured, at the interaction and in the interaction's own document, which of several
matches was the element acted on. That exception lives in `validateCandidate`
(`effectiveLocator(...).positionProven`) and is intact — a contract proves a measured
index is admitted there and an unmeasured one is not.

Authoring carries no such measurement: `validateAuthoringLocator` receives a bare string.
No evidence route was added to it. An authored `.nth()` is therefore always a position
nobody chose, and is refused — now by name.

## The refusal now says which rule spoke

`authoringLocatorProblem(locator)` returns a category and an actionable sentence;
`validateAuthoringLocator` throws `CODE: message`. Codes: `LOCATOR_NOT_TEXT`,
`LOCATOR_TOO_LONG`, `UNSUPPORTED_LOCATOR_ROOT`,
`POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN`, `FORBIDDEN_MECHANISM`, `CREDENTIAL_IN_LOCATOR`,
`MALFORMED_LOCATOR_EXPRESSION`, `EXECUTABLE_LOCATOR_EXPRESSION`, `UNSUPPORTED_LOCATOR_CALL`.

For this step:

> **POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN** — The recorded locator selects by position
> (`.nth()`), and this recording proves no measurement of that position. Choose a Page
> Object capability, or author a locator that names the element — a role and accessible
> name, a test id, or a stable attribute.

## Said before the transaction, not after it

`ReviewStep.locatorSafety` carries the verdict into the review payload, computed by the
same function the save uses — the browser is handed the answer, never the rule. The
review then:

- prints the code and reason beside the recorded locator in **Execution choice**;
- adds **Locator candidate** and **Validation** rows to the Mapping summary whenever the
  recorded locator is the one that would be authored;
- **disables Save Mapping** and repeats the reason, instead of spending a round trip on a
  refusal already known.

The browser decides only *when* the verdict applies, mirroring the server's condition: an
**existing** capability runs its own declared locator, so the recorded chain is neither
authored nor judged; a **new** method or **recorded-locator** execution authors it. A
typed locator override is judged by the server instead, so the recorded chain stops
blocking the save — the override itself is still validated, and still refused by name.

## Is there a safer locator in this recording?

**No, and none was invented.** For `action:12` the review reports `evidence: missing`,
`route: null` and `documentId: null` — the recorder captured nothing for that element, so
there is no measured candidate to offer: no role and name, no test id, no stable
attribute, no scoped semantic expression. The correct outcome is the one the framework
now produces: the step stays `USER_BINDING_INCOMPLETE` and a person decides.

The three routes that exist, none of which the framework may take on its own:

1. bind the step to an established capability that wraps that element — `ksp_Account-Settings`
   currently declares only `Notifications`, so there may be none yet;
2. **re-record that interaction** so the recorder measures it. The text
   `Close1closeSELECTED ASSETS` and the absent route are consistent with a dialog that had
   gone by capture time; this is the only route that produces evidence;
3. type a locator into **Locator override** in Advanced that names the element. It is
   user-authored, carries no automatic proof, and is validated by the same rule.

## Recorded-locator execution was already covered

`USER_CONFIRMED` never bypassed locator safety: with `RECORDED_LOCATOR` and no override,
`selectedMethod` is false and `validateAuthoringLocator` runs on the recorded chain. That
was verified rather than changed, and a contract plus a mutant now hold it there.

## Contracts and mutants

`ai/dashboard/authoring-locator-safety.fixture.ts` — **50 assertions**:

- an unsupported locator reports the rule that refused it, across seven categories;
- a locator that **visibly** starts at `page.` is never blamed on its root, and the thrown
  refusal leads with the same code the non-throwing form returns;
- an unproven `.nth()` stays refused; the same chain without it is accepted, proving
  `.filter()` was never the problem;
- a **browser-measured** index is still admitted in the generation path, and the same
  shape with the measurement removed is still refused;
- a role+name or test-id candidate is accepted and is written into the class;
- an invalid locator cannot create a capability and leaves the class byte-unchanged;
- a refused save creates no Page, no Page Object and no knowledge, leaves the fixtures file
  byte-unchanged, does not move `mappingVersion`, and writes no partial binding onto the
  step — so the unsaved choices remain valid to retry;
- recorded-locator execution is refused by the same rule;
- the screen refuses exactly what the server refuses, and nothing more.

`ai/testing/authoring-locator-mutations.ts` — **8 of 8 killed**: the collapsed message
restored; position reported as an unspecified mechanism; the measured-index exception
removed; the review claiming every locator authorable; recorded-locator execution exempted;
a capability written without judging its locator; the screen judging a chain it is not
authoring; the screen ignoring the verdict.

`.nth()` has no single-point acceptance mutant, and that is a property of the design rather
than a gap: three independent checks refuse it — the `FORBIDDEN` pattern, `isPositionalLocator`,
and the positional branch here. Defeating one changes the category, not the answer.

## Other checks

- Green: `review-selectors`, `authoring-browser`, `recording-mapping`, `explicit-authoring`,
  `authoring-precedence` (27), `authoring-workspace`, `locator-safety`, `locator-quality`,
  `recording-navigation`.
- TypeScript **20 before / 20 after, identical identities**.
- **No application artifact was written by this work.** `TC_SMOKE_039.spec.ts` and the
  17:01 recording session are the user's own concurrent dashboard activity.
- No full regression; focused checks only, as instructed.

## Separate finding: the 10-observed / 9-recorded screenshot mismatch

Not the locator failure, and not a screenshot defect. The live review reports
`{paired:false, observed:17, attributed:2, observedActions:10, recordedActions:9,
observedAssertions:2, recordedAssertions:2}`.

The extra observed action is **a click that Playwright's codegen wrote as a multi-line
call**, which `parseRecording` drops. Proven on the saved sibling recording
`TC_SMOKE_038.spec.ts`, which contains:

```ts
await page.getByRole('textbox', { name: 'Password' }).click({
    modifiers: ['Alt']
  });
```

`parseRecording` reads the script line by line and requires a complete `await …;` call on
one line, so `splitCall` fails and the action is skipped. Running the real parser over that
file: the source **has** the Password click and the parsed actions **do not**. The
resulting index sequence (`1,2,3,4,5,8,9,11,12,13`) matches that file's persisted review
keys exactly, which is what pins the drop to this line and not to another rule.

The recorder's picture hook observed the click — it was a genuine user action — so
observed exceeds recorded by one, and the all-or-nothing pairing then attributes no action
screenshot. **The screenshots are a symptom.** The finding is that a real click a person
performed is missing from the recording, which is the same family as the navigating-click
loss fixed earlier today and deserves its own reproduction and fix. Screenshot attribution
was not changed here.
