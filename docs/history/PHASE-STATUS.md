# Moolya AURA — phase status and open decisions

State as of **2026-08-14**. This file is the *history and the open questions*: what has been
optimised, what it measured, and which loose ends are deliberate. It does not describe the
architecture — [CLAUDE.md](CLAUDE.md) does that, [FRAMEWORK-GUIDE.md](FRAMEWORK-GUIDE.md) is
the end-to-end walkthrough, and [EXCEL-AUTOMATION.md](EXCEL-AUTOMATION.md) is the command
reference.

It exists because several things in this repo look like oversights and are not. Anyone who
"fixes" the items in [Open decisions](#open-decisions) without asking will be undoing a choice
that was made on purpose.

---

## Completed phases

| Phase | Date | What changed | Measured |
| --- | --- | --- | --- |
| 4 | 2026-08-12 | One browser per compatible group of rows (`ai/autocode/session.ts`) instead of a launch and a sign-in per row | 4 rows: 96.9 s → 32.1 s |
| 4B | 2026-08-12 | `assessBrowserNeed` — a second, deterministic look at a `partial` verdict, so a gap made only of prepositions and manners opens no browser | Fires on 0 of 34 real rows, 3 of 3 benchmark rows |
| 5 | 2026-08-13 | `ai/knowledge/requirements.ts` — a requirement is a phrase that names something, replacing the 69-word stop-list whose 20 UI words were the signal it was discarding | Requirement terms 354 → 128; rows opening a browser 31 → 7; 0 rows gained one. One live row (TC_LOGIN_028) 46.6 s → 36.4 s with `agentMs` unchanged |
| 5B | 2026-08-14 | Two recording-review defects (below) | 54/54 offline checks |

### Phase 5, in one paragraph

The old extractor took every word longer than three characters that was not in a stop-list —
and twenty of those stop-words were the UI and action vocabulary (`button`, `field`, `click`,
`displayed`). So "Check the Create Project button is displayed" contributed `create` and
`project` and threw away the two words that made it a claim about a screen. Any unaccounted-for
"requirement" opened a browser, and **three of the five historical browser launches were caused
by prose this toolkit generates itself** — the recorder's own "Needs confirmation" and "Recorded
interaction" placeholders, read back as facts to verify about the application.

The safety property is the one worth remembering: **a phrase can only be a gap if one of its
words was already a gap**, so the set of rows opening a browser is a strict subset of the old
set. `ai/knowledge/requirements.fixture.ts` asserts it per row and recomputes the old decision
with the *real* old extractor rather than an approximation of it.

The `31 → 7` in the table is the count on the day it was measured. The fixture recomputes it
against whatever the workbook holds now, so a workbook that has gained rows since reports
larger numbers — it read `32 → 8` on 2026-08-14, one row having been added in between. The
invariant (`0 rows gained one`) is the part that must hold at every size.

### Phase 5B, in one paragraph

Two bugs in the Record Test review screen, both of which looked fine from every angle except
the one that mattered.

1. **The "Needs confirmation" warning was permanently visible**, even beside three recorded
   assertions. The element was `class="note show" hidden`, and the stylesheet has
   `.note { display: none }` / `.note.show { display: block }`. The `hidden` attribute is only
   the user agent's `[hidden] { display: none }`, and **any author `display` rule beats the UA
   sheet** — so `.hidden = true` set the property and changed nothing on screen. The recorder,
   the parser and the saved row were all correct. The same defect hid on `recAuthNote`, which
   rendered "Authentication detected — ." for recordings that contained no sign-in.
2. **A recorded sign-in could not be saved at all.** The recorder redacts a password to the
   marker `[type=password]` and `testDataFrom` wrote `Password = [type=password]`. `parseToken`
   reads anything outside angle brackets as a literal, so the workbook's own credential check
   reported "password has a literal value" — about the redaction marker, which is not a
   password. `validateDraft` problems are thrown, not warned, so the save was refused.

Both notes are now toggled with the `show` class (the pattern `recProblem` already used), and
Test Data carries `<valid-password>` while the steps table keeps showing `[type=password]`.

---

## Open decisions

Each of these is a choice waiting on a person, not work waiting on time. Raise them; do not
quietly resolve them.

- **The recorded email is written verbatim into the workbook** (`Email = someone@moolya.com`),
  and the workbook is git-tracked. `<registered-email>` exists in the token parser, but the
  recorder has no path to choose it and switching unconditionally would break cases where the
  specific address *is* the point of the test.
- **A redacted fill in a recording with no _detected_ sign-in still writes `[type=password]`,
  and is still refused at save.** A change-password form, or a field somebody clicked into and
  left. The fix needs either a token selector in the review screen or a rule in
  `ai/dashboard/authoring.ts`.
- **Valid versus invalid password is not inferred.** `detectAuthentication` proves a sign-in
  form was filled in and submitted; it never proves the sign-in succeeded. A negative-login
  recording therefore gets `<valid-password>`. Harmless today, because a spec-backed row never
  resolves the token — it would matter only if someone later filled in that row's
  `Assert Outcome`.
- **`TC_LOGIN_027` and `TC_LOGIN_028` carry `tags: ["undefined"]`** instead of `recorded`, from
  a dashboard defect since fixed. They are treated as ordinary cases and have lost the recorded
  pipeline. Their recording artifacts no longer exist.
- **Seven or eight rows still open a browser during generation**, and `valid creds` among them
  is a known surviving false positive. The others look genuine — the forgot-password screen has
  no knowledge file, and `Project name cannot be empty.` really is absent from
  `bugasura__apps.yaml`.
- **`CLAUDE.md` does not yet record the two Phase 5B invariants**: the review notes are
  class-toggled and never `hidden`, and the redaction marker belongs in Steps while the token
  belongs in Test Data.

---

## Credential rule

Standing, and it outranks convenience. The real password must never be logged, returned by an
API, stored in a recording artifact, written to the workbook, put in `state.json` /
`mapping.json` / metrics, displayed in the dashboard, sent to AI, written into generated source,
or committed.

Two further rules that are easy to break with good intentions:

- **Never disclose which secret matched.** A redaction check that reports "your real password
  was the thing that matched" is itself a disclosure.
- **Never solve a credential problem by asking for the credential.** No password input in the
  dashboard, no password column in the workbook, no prompt during recording review. A selector,
  if one is ever needed, may offer only `<valid-password>`, `<invalid-password>`, `<blank>`.

The sanctioned flow is: recorded password → redacted at capture → the workbook token
`<valid-password>` → the existing `.env` and fixture mechanism → resolved at run time.

**Two strings, two meanings, never merged.** `[type=password]` is the redaction marker — steps
table and kept artifact — and says *a value was captured and thrown away*. `<valid-password>`
is a workbook token and says *fetch it from the environment*. Collapsing them would make the
marker executable.

---

## How the work is done here

- **Read-only investigation first, then approval, then a scoped implementation, then a report.**
  Verify the current code rather than the conversation: a phase is not complete because it was
  discussed.
- **Validate offline before anything live.** There is no typecheck in this repo — no
  `tsconfig.json`, and `tsx` strips types without checking them — so loading and running a
  module is the only check that exists. Phase 5's fixture caught four defects before anything
  reached a browser or a model.
- **Baseline the protected files before the first edit** (md5 or mtime), so "unchanged" is a
  measurement and not a claim.
- **Say what was not run, and why.** Re-running the falsification gate writes
  `ai/autocode/state.json` and `ai/test-mapping/mapping.json` and drives Playwright against a
  live product, which most phases forbid — so the honest report names the gap instead of
  implying coverage.
- **Nothing here is committed.** `ai/`, `excel/` and `tests-e2e/` are untracked by choice.

### The gates, and how to run them

```bash
npx tsx ai/knowledge/requirements.fixture.ts   # Phase 5: 23 checks, incl. the subset invariant
npx tsx ai/dashboard/recorder.fixture.ts       # Phase 5B: 54 checks, recording review
npm run excel:independence                     # generated specs authenticate for themselves
npm run excel:verify                           # the falsification gate over hand-written specs
npm run excel:list -- excel/login-test-cases.xlsx
```

The first two are deterministic and offline: no browser, no model, no network, and nothing is
written. `recorder.fixture.ts` compares against the real secret in `.env` and never prints it —
a failure reports the surface that leaked, not the value.
