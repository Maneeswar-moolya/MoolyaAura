# Formatting decided whether a recorded step existed

**Measured 2026-09-15 against this working tree.** A framework correctness defect in a
shared capability. Nothing here is application-specific.

## The action that was dropped

```ts
await page.getByRole('textbox', { name: 'Password' }).click({
    modifiers: ['Alt']
  });
```

A click on the Password field, performed with Alt held. Codegen wrapped it because its
options object did not fit, and `parseRecording` then did not contain it. Not mislabelled —
absent.

## The old assumption

> one trimmed source line beginning `await ` = one candidate recorded action

`parseRecording` iterated `source.split('\n')`, and `splitCall` required the whole call on
that line: `/^(.*)\.([A-Za-z]+)\((.*)\)\s*;?\s*$/`. A wrapped statement's first line has no
closing paren, so `splitCall` returned `null` and the loop moved on.

Reproduced across every wrapping Codegen produces — **all of these were lost**, not only the
click: a wrapped locator chain, a wrapped `filter`, a wrapped `fill`, `press`, `selectOption`,
`dblclick`, `check`, `hover`, a wrapped `expect(...)`, and a wrapped `page.goto(...)` with its
navigation marker.

## The structural parser

> one complete TypeScript statement = one candidate recorded action

`recordedStatements(source)` uses the TypeScript parser already in this repository:
`ts.createSourceFile` builds the tree, every `ExpressionStatement` wrapping an
`AwaitExpression` is collected, and the result is sorted by source position so recording
order is the source's order, stated rather than assumed. The outermost call is decomposed
from the tree — `PropertyAccessExpression` gives the method, its `expression` the receiver,
`node.arguments` the arguments — instead of from a regex over a line. `splitCall` is gone.

The three strings the rest of the parser receives are the strings it always received, so
redaction, `describeLocator`, matcher lookup, toggle collapsing and the review are untouched.
`flattenExpression` normalises them to the single-line spelling: whitespace runs collapse, and
spaces are removed where Codegen never puts them — around `.`, after `(` and `[`, before `,`
— because `page\n  .getByRole(...)` naively collapsed reads `page .getByRole(...)`, which no
longer matches `^page\.` and would be refused by the authoring locator gate for a reason that
has nothing to do with the element. **String literals are copied out verbatim**, escapes
included, so no recorded value is reformatted.

Two counters had to stay the same counter. The picker records its assertion positions against
raw script lines, measured by `countRecordedActions` over the file the recorder is still
writing. `rawActions` is now **derived from the source** with that identical definition —
lines starting `await ` and not `await expect(` — rather than accumulated per statement, so a
wrapped call cannot make the two definitions drift.

## Existing recordings parse identically

The decisive check: the previous parser and the new one, run over every saved recording.

| | |
| --- | --- |
| saved recordings compared | **37** |
| byte-identical actions and assertions | **22** |
| changed | **15** |
| actions recovered | **15 — exactly one per changed recording** |

Every changed recording gained the same shape: the wrapped `click` on the Password field.
Nothing else moved: no action changed type, target, locator, value, redaction or navigation
provenance, and no assertion changed.

## The affected recordings, read-only

Source files were not modified.

| recording | `await` statements in source | parsed actions before | after | assertions | recovered |
| --- | --- | --- | --- | --- | --- |
| TC_SMOKE_037 | 11 | 10 | **11** | 1 → 1 | `click` on Password |
| TC_SMOKE_038 | 15 | 14 | **15** | 1 → 1 | `click` on Password |
| TC_SMOKE_039 | 13 | 12 | **13** | 1 → 1 | `click` on Password |

In all three, **source `await` statements now equals parsed actions exactly**. This is
deterministic recovery from the persisted source; no screenshot, navigation or evidence was
used to reconstruct anything.

The recording that reported `10 observed / 9 recorded` was the dashboard's **pending**
recording, which lives in memory. The dashboard now answers *"No recording is waiting for
review"*, so that specific one can no longer be re-measured — its saved siblings above stand
in its place, and they recover the same action.

## Screenshot attribution

Restored by the action, not by loosening the rule.

- 10 observations + 10 parsed actions → `paired: true`, ten captures, ten **distinct** step keys.
- 10 observations + 9 parsed actions → `paired: false`, **nothing attributed**, and the two
  counts reported as the reason.

The all-or-nothing pairing rule is unchanged, and a mutant that relaxes it to `<=` is killed.

## The consequence that had to be handled

Recovering an action **renumbers every step after it**. A persisted ownership sidecar is keyed
by `action:<n>`, so `SsoauthLoginPage.logInButton` saved at `action:5` would quietly re-attach
to the password field — the "wrong control bound" failure, arriving with no error at all.

`AuthoringOwners` now carries `revision`: the step stream the choices were made against
(`ownershipRevision`, a hash of actions and assertions), not just `recordingHash`, which only
says which script this is. `loadOwners` refuses when both sides know their stream and they
differ. Optional and additive: a sidecar written before the field reads as **unknown**, never
as "still current", and nothing infers a revision from a hash, a count or a date.

> **13 existing sidecars predate the field and now describe a different step stream:**
> TC_SMOKE_013, 015, 017, 021, 023, 027, 029, 030, 031, 035, 037, 038, 039.
> They were **not** modified. Their bindings should be re-reviewed before those recordings are
> generated from again. This is reported, not repaired: re-keying them would be guessing, and
> two steps in these recordings share a locator, so nothing here can tell them apart.

## Contracts

`ai/dashboard/recording-statements.fixture.ts` — **93 assertions**:

- fifteen single-line/wrapped **pairs** asserted *equal*, not merely both non-empty, covering
  click, click with modifiers, click with position/button/clickCount, filter chain, fill,
  press, dblclick, check, uncheck, selectOption, hover, goto, assertion, negated assertion and
  attribute assertion;
- a vanished statement and a split statement report **different** failures;
- source order preserved, the recovered click at its performed position, five reviewable
  steps, and the assertion still counting six actions before it;
- an options object keeps its click, keeps the single-line locator spelling and carries no value;
- a wrapped `goto` keeps cause, reason and counts; an unmarked one stays `unknown`;
- a wrapped credential fill is still redacted to the placeholder, still counted, and the typed
  value appears nowhere in the recording;
- literals byte-exact, wrapped chains canonical, single-line chains unchanged;
- 10/10 attributes with distinct keys; 10/9 refuses;
- the recovered positional chain is still `POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN`;
- an unsupported call is skipped and the action after it is still recorded;
- a saved sidecar records its step stream, and one from another stream is refused, not applied.

## Mutants

`ai/testing/recording-statement-mutations.ts` — **11 of 11 killed**: statements read a line at
a time; a wrapped chain split per call; whitespace collapsed inside literals; a call with an
options object no longer recognised; an options object read as the value; reverse source order;
the trailing navigation marker dropped; argument text lost moving to the tree; pairing tolerating
10 against 9; a sidecar re-applied to a renumbered stream; the stream never recorded.

## Other checks

- Green: `recorder` (54/54), `recording-mapping`, `authoring-locator-safety` (50),
  `recording-navigation`, `recording-pictures`, `assertion-picker`, `picker-transparency`,
  `authoring-precedence` (27), `explicit-authoring`, `recorded-flow`, `navigation-causality`.
- TypeScript **20 before / 20 after, identical identities**.
- **No application artifact was written.** No recording source, sidecar, Page Object, mapping
  or workbook was modified.
- No full regression; focused checks only, as instructed.

## Recording Review

Not observed live: the dashboard is still running the pre-change server and the pending
recording is gone. What is proven is everything the screen reads — the parsed action stream,
the step keys, and the attribution verdict. On restart, a recording of this flow will show the
recovered `click` on Password as its own step and, with ten observations against ten actions,
attribute each screenshot to its own step.

## Separate follow-up, deliberately not broadened

`page.locator('//div[1]')` still evades the XPath check, because that pattern was written for
a raw selector string rather than an expression. Recorded here only; changing locator-security
coverage deserves its own focused task.

## Does the affected recording need re-recording?

**No.** The source is the authoritative input and it always contained the action. Re-parsing
recovers it deterministically. What does need attention is the 13 ownership sidecars above.
