# Navigation causality correction â€” 2026-09-13

## Proven cause and change

The former recorder joined Page.frameRequestedNavigation to Playwright requests using an
exact URL and arrival order. A real Chromium fixture reproduced a scripted fragment
navigation becoming unknown: the document/browser URL retained its fragment while the
network request omitted it. The allowlist also omitted meta-tag and HTTP-header refresh.
The saved TC_SMOKE_005 has an unknown marker without diagnostic provenance, so its exact
historical trigger cannot be reconstructed. A prior read-only live pre-login probe timed out;
no claim is made that the fragment mismatch alone explains that particular event.

The journal now observes main-frame Document requests, request/loader identity, redirects,
script initiators, browser-requested navigation, document commits and history API navigation.
It reconciles events after capture, requiring unique matches and retaining conflicts as
unknown. It binds fragment-bearing document URLs through request metadata or the same loader;
request-key normalization preserves queries. A protocol reply drains pending events before
finalization. No URL pattern grants causality. No cross-frame or cross-visit borrowing.

Persisted source markers contain only a recording-local navigation ID, cause and allowlisted
reason code and URL-free document/history/unresolved event counts. Transient destinations remain withheld. Parser/mapping retain the diagnostic;
needs-review navigation is labeled NEEDS REVIEW rather than ok. Existing markers remain
readable, but missing historical evidence is not invented.

## Scope

Changed: ai/dashboard/navigation.ts, recorder.ts, live-recorder.ts;
ai/autocode/from-recording.ts; expanded ai/dashboard/navigation-causality.fixture.ts;
new ai/testing/navigation-mutations.ts; newline-safe ai/autocode/semantic-candidates.fixture.ts;
current-state and handoff documents.
The semantic-candidates fixture source check now explicitly accepts LF and CRLF, preserving
its assertion-pick call-site check without depending on checkout line endings. The live
recorder source also retains its original LF format. Locator ranking, DOM identity, PO/knowledge ownership,
credentials and runtime AI behavior are unchanged. No application artifact was edited.

## Validation

Focused browser coverage: script and HTTP redirects, fragment destinations, meta refresh,
HTTP refresh, form POST and history navigation. Synthetic protocol cases cover both event
orders, each fragment transport, wrong-loader rejection, child-frame isolation, repeated
ambiguous destinations, persisted identity/reasons, privacy and review labels.
First correction: nine focused fixtures passed; eight navigation mutants and eleven
recorded-flow mutants were killed. The full sweep passed 84/84 in 989.89 seconds.
During that sweep, the user captured TC_SMOKE_007 with the corrected recorder; it still
reported ambiguous-destination. Therefore that green sweep did not close the live issue.

Follow-up reproduction: a proven document redirect followed by same-URL history.replaceState
incorrectly competed for the document cause. History API events are independently proven;
they now cannot consume the document's requested-navigation correlation. A negative test
retains unknown for a document with no initiator even when history is proven. Real Chromium
meta-refresh plus same-URL replaceState and synthetic event tests pass. A ninth source mutant
restores this defect and must fail. The nine navigation mutants were killed after strengthening persisted-marker coverage;
all 84 fixtures passed in 1029.38 seconds. This is an actual second validation run.
Concurrent TC_SMOKE_009 used the latest recorder and still blocked with 4 document visits,
2 history events and 1 unattributed visit at its return destination. Thus that sweep also
did not establish end-to-end application success.

A further real-browser reproduction proved the explicit initial document request remained
unknown and contaminated a proven return to the same URL. The journal now wraps the actual
framework entry command, binds only its first matching non-redirect document request, and
excludes that already represented entry visit from later-visit correlation. It never exempts
all visits to the entry URL. Unknown later returns, mismatched first requests and redirect
requests cannot claim the entry command. No historical recording is rewritten.
Focused browser/event checks and four integration fixtures pass. All twelve navigation
source mutants were killed in 301.03 seconds. Entry-correction broad regression stopped as premature: 43/84 completed results recorded, 43 passed. This is an incomplete run, not a final regression. Use focused ownership/reuse tests and verify TC_SMOKE_011 before one final settled-tree sweep.

TC_SMOKE_011 (run 2026-09-12T20-35-55-101Z-9cnssz) now passes navigation: every observed
navigation marker has zero unresolved visits. Generation is blocked by authenticationCapability.
Read-only mapping confirms identity-proven email, password and submit measurements. The
SsoauthLoginPage and UsEnHomePage declarations duplicate those locators; the full knowledge
lookup refuses ambiguity, whereas an in-memory filter to the measured /ssoauth/login route
resolves all three correctly. No filter or artifact repair was applied to production.
findMethod/disambiguateByProvenLocator/declaredMethodFor do not use the measured route to
settle these duplicate owners. resolveOwner also gives reconstructed route ownership priority
before its measured-route fallback; this is a demonstrated risk in the creation path, not proof
of exactly which historical invocation wrote the duplicated methods.
A second defect is visible: the header Log In link (no captured target/candidates) is reused
as the form Log In button by name. Correct reuse must require compatible measured identity
and ownership, not shared wording. Preserve saved evidence, prove and fix ownership/reuse
before repairing misplaced application capabilities. Authentication/heading re-recording is
not justified by this ambiguity; the header's missing evidence needs separate investigation.
No runtime AI or application-writing generation was invoked by these read-only checks.
The historical 83/84 and first-correction 84/84 runs are not relabeled.

## Existing application and next action

Read-only mapping of TC_SMOKE_005 retains five PO actions and the heading capability, with
only navigation event 3 blocked. Its original URL/cause diagnostic was discarded by the older
recorder and cannot be repaired safely. TC_SMOKE_007 contains reason/ID markers from the
first correction; restarting alone was not its solution. Its ambiguous marker predates the
new event-count diagnostics. The history collision is proven synthetically, but the exact
live site's browser cause is not established by that marker or by pasted codegen. Load the
latest correction, then capture once using live Chromium to validate the real flow. TC_SMOKE_009 also requires
new capture to bind the explicit entry request; its saved counts cannot supply that identity. The actual signed-in application flow has not
been re-recorded or executed by this task. Other transports without initiator evidence still
fail closed. Copilot remains not implemented.

External private baseline/logs:
C:\Users\MANEES~2\AppData\Local\Temp\aura-navigation-fix-8qud05j0
