# Live recorder: navigating actions lost, and every action screenshot with them

**Measured 2026-09-15 against this working tree.** Two defects, one cause and one
consequence. Both are framework correctness defects in shared capabilities (the live
recorder transport and the recording picture layer). Neither is application-specific and
nothing here is a KSP patch.

## What the user saw

A live recording of: landing page → **Log In** → email → password → **Log In** →
redirects → **Product Help** → **My Support Cases** → assert heading.

Recording Review showed five steps. The draft ownership sidecar written at 14:26 local
(`ai/dashboard/recordings/ksp/.draft-c2487497…owners.json`, left untouched) holds exactly:

| key | step |
| --- | --- |
| `action:3` | click Enter email |
| `action:4` | fill Enter email |
| `action:5` | fill Password |
| `action:9` | click Product Help |
| `assertion:0` | Assert contains heading |

Missing: **click Log In** (landing), **click Log In** (submit), **click My Support Cases**.
Retained: every action that did **not** navigate. The gaps at `action:0-2` and `6-8` are
`navigate` actions, which `ownershipReview` deliberately does not offer as steps.

Separately, only the assertion step showed a screenshot; every action step said
*"No recording screenshot was captured for this step."* Twelve screenshots from that
session were on disk the whole time
(`ai/diagnostics/artifacts/ksp/recordings/558aeb69-…`, 14:22:50–14:23:51 local).

## First layer where each action disappeared

Both disappeared at the **same layer, before the action was ever allocated**: the in-page
recording picture hook, `recordingPictureHook` in `ai/diagnostics/recording.ts`.

The hook wraps Playwright's recorder bindings to take a screenshot around each action:

```
win.__pw_recorderRecordAction = async function (action, ...rest) {
  try { id = await win.__auraPictureBefore({...}); } catch {}   // out-of-process round trip
  return await original.call(this, action, ...rest);            // ← the recorder is told HERE
}
```

`RecordActionTool.onClick` in `playwright-core` records an ordinary click **after the
browser has dispatched it** — the click is not consumed, so for a link or a submit button
the navigation is already underway when the wrapper is entered. The wrapper then waits for
a screenshot (`page.screenshot`, `timeout: 1500`, plus mask locators) that is taken against
a document being torn down. The awaited binding never returns, `original.call` is never
reached, and `__pw_recorderRecordAction` is never called. The action is not degraded; it
never exists.

Playwright's generator then sees a navigation that no recorded action caused and writes
`await page.goto(...)` in its place. **The consequence replaced its cause** — the one
substitution the navigation model must never make.

### Reproduction, measured both ways

Synthetic scenario: Page A → `Continue` (navigates) → Page B → `Open Cases` (navigates) →
Page C → `Product Help` (stays put). Real `context._enableRecorder`, real hook.

Hook **not** installed:

```
await page.goto('http://127.0.0.1:…/a');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('button', { name: 'Open Cases' }).click();
await page.getByRole('button', { name: 'Product Help' }).click();
```

Hook installed (before the fix):

```
await page.goto('http://127.0.0.1:…/a');
await page.goto('http://127.0.0.1:…/b');     ← the Continue click, replaced by its navigation
await page.goto('http://127.0.0.1:…/c');     ← the Open Cases click, replaced by its navigation
await page.getByRole('button', { name: 'Product Help' }).click();
```

The hook's own observation list held all three clicks, each with a `BEFORE_ACTION` picture.
It watched the actions it was deleting.

**Navigation-triggering actions are the common boundary.** Every lost action navigated;
every retained action did not.

## The screenshots

They were **captured, written to disk, and then not attributed**. Nothing was overwritten,
nothing pointed at a global latest picture, and the UI was applying the right rule to the
data it was given.

`RecordingPictures.finish` pairs pictures with steps only when the observed stream and the
recorded stream are the same stream — length and kind, in order. That all-or-nothing rule is
correct and is kept: a picture reaches a step because the streams are one stream, never
because a name or a filename looked right. But one lost action makes the streams different
lengths, so **every action picture in the recording is discarded**. Assertion pictures live
in their own list with their own length check, which still matched — which is exactly why
`ASSERTION_STATE` survived alone.

A second, independent divergence was measured in the same run. The assertion picker's
overlay is namespaced `ba-aura-assert` with a closed shadow root, so a selection click
records as `page.locator('ba-aura-assert').click()` and `parseRecording` drops it. The
picture layer did **not** drop it, so any recording made with the picker had one observation
more than it had actions — enough on its own to discard every action picture.

## The generalized rule

> **Observation must never sit between a user action and the recorder's record of it.**
> A picture describes a step; it may not decide whether the step exists. After the browser
> has dispatched an action, the recorder is told first and the picture is reported without
> being waited for. Before dispatch — where nothing is navigating and a true before-action
> picture is the only one obtainable — waiting is safe and is kept.

Its corollaries, all implemented:

- The picture layer drops recorder-owned interactions using the **same rule** the parser
  drops them with (`isRecorderOwnAction`, injected, not restated), so the two streams cannot
  drift apart by construction.
- Because the page no longer waits, observation work is chained in the order the page
  reported it, and `settle(page)` is a protocol barrier — a round trip on the same
  connection, the pattern `NavigationJournal.settle` already uses — rather than a delay.
- When the streams genuinely cannot be paired, that is **said**: `CaptureAttribution`
  records `paired` plus the four counts, travels on the evidence, reaches Recording Review
  and replaces "No recording screenshot was captured for this step" with the truth.
  Showing none is still right; calling it *captured nothing* was not.

## Files changed

| file | change |
| --- | --- |
| `ai/diagnostics/recording.ts` | hook no longer gates the recorded action; ordering queue; `settle(page)` barrier; recorder-own-action refusal; attribution verdict |
| `ai/diagnostics/artifacts.ts` | `CaptureAttribution` |
| `ai/autocode/dom-evidence.ts` | optional `captureAttribution` on `RecordingEvidence` |
| `ai/dashboard/live-recorder.ts` | injects `isRecorderOwnAction`; settles before closing; records attribution |
| `ai/dashboard/recording-mapping.ts` | attribution reaches the review |
| `ai/dashboard/public/recording-review.js` | honest unavailable message |
| `ai/diagnostics/recording-pictures.fixture.ts` | **harness correction** — settles reports before pairing them |

## Contracts

`ai/diagnostics/recording-navigation.fixture.ts` — 24 assertions in six groups, the scenario above through the real
recorder and the real hook, with a picker-shaped overlay click and a picked assertion:

- both navigating clicks retained, the entry navigation retained, the overlay dropped;
- `action:1` / `action:2` / `action:3` each keep exactly one `BEFORE_ACTION`, on routes
  `/a`, `/b`, `/c` — the routes are what prove the two navigations happened *between* the
  actions rather than instead of them, and they are read off the capture;
- `assertion:0` keeps its own `ASSERTION_STATE` on `/c`;
- the action that stays on its page keeps its `AFTER_ACTION`; a navigating one is allowed
  not to, because the document it would have photographed is gone;
- unique `captureRef`s, unique artifact files, four distinct step keys, and byte-different
  screens;
- Recording Review resolves a distinct capture set for every step;
- a stream that does **not** align attributes no action picture, is never reported as
  paired, and has its unattributed pictures counted rather than forgotten.

## Mutants

`ai/testing/recording-navigation-mutations.ts` — **5 of 5 killed**.

| mutant | dies on |
| --- | --- |
| observation awaited before the recorder is told about the action | a navigating click must survive as an action |
| the recorder's own overlay observed as an application action | observed and recorded streams must be one stream |
| attribution claims every picture was placed | a stream that does not align is never reported as paired |
| a stream that does not align paired anyway | attributes no action picture, rather than guessing one |
| every action picture pointed at one step | must keep exactly one before-action picture |

Two verdicts are asserted in a deliberate order — what is **shown** first, what is **said**
about it second — so the loosened-pairing mutant and the hardened-verdict mutant die on
different assertions instead of sharing one.

## Other checks

- Adjacent contracts re-run green: `recording-pictures`, `runtime-pictures`, `security`,
  `recording-mapping`, `review-selectors`, `recording-evidence`, `picker-transparency`,
  `recorder` (54/54), `assertion-picker`, `explicit-authoring`, `authoring-precedence`
  (27), `preaction-claim`, `evidence-sidecar`, `credential-redaction` (13),
  `dashboard-experience`.
- TypeScript: **20 diagnostics before, 20 after, identical identities**, measured by
  typechecking a pre-change copy of the tree. None is in a file changed here.
- Application artifacts: **nothing under `ai/dashboard/recordings`, `ai/knowledge/page`,
  `ai/test-mapping`, `ai/test-data`, `ai/reports`, `ai/projects/registry.json`,
  `tests-e2e/pages`, `tests-e2e/generated`, `excel` or `ai/diagnostics/artifacts` was
  written.** The user's 14:22 session artefacts and its draft ownership sidecar are
  untouched.
- No full framework regression was run; the user asked for focused checks only.

## Not claimed

- No live recording was made against a real application, and no credential was used.
- `startLiveRecording` launches headed by design, so the contract drives the same
  `_enableRecorder` + `RecordingPictures` + `NavigationJournal` composition headlessly.
  The single line that injects `isRecorderOwnAction` into the picture layer is therefore
  proven by behaviour in the contract and by inspection at the call site, not by a mutant.
- `settle(page)` is a barrier for reports the page has already sent. It cannot wait for a
  report the page has not made yet, and does not claim to.

## Does the user's recording need re-recording?

**Yes.** The three clicks were never recorded by Playwright, so they are absent from the
recording itself — not mislabelled, not unattributed, absent. Reconstructing them from the
navigations they caused is exactly the fabrication the contracts forbid. Re-record after
restarting the dashboard: the running process predates every file changed here.
