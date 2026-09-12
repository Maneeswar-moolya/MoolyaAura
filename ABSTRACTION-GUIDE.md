# Page Object Abstraction — how a locator becomes a reusable method

The framework's long-term health depends on one thing: **one UI element, one locator, in
one place.** Without that, every recording adds its own copy of `page.locator('#proj_name')`
and a single UI change breaks twenty tests in twenty places.

This guide covers the machinery that prevents it — how a recorded locator becomes a Page
Object method, who decides, and why most candidates are refused.

**None of it uses AI.** Every decision below is a rule over measured evidence. The
framework works with no model available, and a model is never consulted about whether a
locator is safe, unique, reusable or owned.

---

## 1. What the engine does

After a recording is processed, every target that did **not** resolve to an existing Page
Object is analysed. The analysis produces a *proposal*, never a change:

```
recorded target
      ↓
existing Page Object method?          → REUSE
      ↓ no
existing parameterised method?        → REUSE_PARAMETERIZED
      ↓ no
deterministic analysis
      ↓
   ┌──┴────────────────────────────────────────────┐
   │ safe, reusable, owned, proven → PROPOSED       │
   │ same but takes an argument    → SAFE_NEW_PAGE_OBJECT
   │ evidence or ownership unclear → NEEDS_REVIEW   │
   │ generated id, recorder's own  → REFUSED        │
   └───────────────────────────────────────────────┘
      ↓                                ↓ NEEDS_REVIEW, SEMANTIC reason only
      │                          AI semantic resolver   ← one question, closed answers
      │                                ↓
      │                          deterministic re-validation
      │                                ↓ every other rule, again
      └────────────→ PROPOSED ←────────┘
      ↓
   Page Object method + knowledge entry written
      ↓
   future recordings REUSE it
```

A `PROPOSED` line means every deterministic gate passed: press-time proof against the
element that was pressed, one match, one document, no generated identifier, no positional
or forced mechanism, an owner knowledge declares, a name derived from the owner and the
element kind rather than from data, no collision on the class, and — where there is a
parameter — a template that round-trips to the measured expression. That is written
without anyone countersigning it; requiring a signature on arithmetic is why the loop
used to stop there.

What still needs a person is everything that did **not** reach `PROPOSED`.

---

## 2. Running it

```bash
npx tsx ai/autocode/abstraction/propose.ts          # analyse, write the ledger
npx tsx ai/autocode/abstraction/propose.ts --dry    # analyse, write nothing

npx tsx ai/autocode/abstraction/writer.ts --dry     # show what would be created
npx tsx ai/autocode/abstraction/writer.ts           # apply APPROVED proposals only
```

Or as part of a generation run — **off by default**:

```bash
npm run excel:autocode -- excel/<applicationId>-test-cases.xlsx --create-page-objects
```

Without that flag, generation behaves exactly as it always has: no ledger, no Page Object,
no model asked a semantic question, nothing written.

### The ledger

`ai/reports/abstraction-proposals.jsonl` — one line per distinct abstraction, sorted, with
a stable fingerprint. Re-running over an unchanged corpus rewrites it **byte for byte**, so
a diff shows only what genuinely changed. It is a report: safe to delete, regenerated on
demand, and it carries **counts of values, never the values themselves** (an issue summary
or a project name is test data and does not belong in a report).

---

## 3. When a model is asked, and what it may decide

The engine is deterministic. One narrow exception exists: a proposal that reached
`NEEDS_REVIEW` for a **semantic** reason and nothing else may have that one question put to
a resolver (`ai/autocode/abstraction/semantic.ts`).

Every refusal carries a **code**, and the code — never its wording — decides who may clear it:

| Class | Examples | Clearable by a resolver? |
| --- | --- | --- |
| `SAFETY` | `NO_PRESS_TIME_PROOF`, `IDENTITY_NOT_PROVEN`, `DYNAMIC_IDENTIFIER`, `FORBIDDEN_MECHANISM`, `GROUP_MEMBER_UNPROVEN` | **Never** |
| `STRUCTURAL` | `TEMPLATE_NOT_DERIVABLE`, `PARAMETER_SOURCE_MISSING`, `METHOD_EXISTS` | Never — a fact, not a judgement |
| `SEMANTIC` | `AMBIGUOUS_OWNERSHIP`, `NO_METHOD_NAME`, `CONSTANT_PARAMETER_VALUE` | Yes, one at a time |

**A resolver is asked only when there are zero safety refusals and exactly one semantic
one.** A dynamic id with a naming question is a dynamic id. Two open questions are a review,
because one answer cannot clear both and nothing could say which cleared which.

Three semantic codes are deliberately **not** enabled:

- `TEXT_ONLY_IDENTITY` — the element's only identity is its own text, so a "yes, reusable"
  changes nothing; answering would need a locator, and inventing one is forbidden.
- `SINGLE_TARGET` — one sighting. Parameterising it extrapolates from a sample of one.
- `AMBIGUOUS_NAME` — **measured, not reasoned about.** It was enabled, a real resolver was
  asked about the notification panel's Close control, and it answered sensibly:
  `closeButton`. The entry that would have been written declared `accessible_name: Close`
  beside a panel-scoped locator — and `findMethod` matches accessible names *page-wide*, so
  all five Close buttons in the corpus would have bound to the panel's locator. That exact
  entry was written and rolled back in an earlier phase. The ambiguity is in the **binding**,
  not the name, so no name a resolver returns can fix it.

### What a recommendation cannot do

It arrives as JSON and is re-validated against every rule as though nothing had been said:

- **It cannot choose a locator.** The template comes from the recorder's measurement. If the
  response carries a `locatorTemplate` that differs, the whole recommendation is rejected.
- **It cannot invent an owner.** The prompt lists the classes knowledge declares for that
  screen; anything else is rejected.
- **It cannot rename what the framework already derived.** Where a name was derivable, the
  framework's stands. A name volunteered on a question that was *not* about naming is
  disregarded rather than treated as a conflict.
- **It cannot clear a second refusal.** Only the code it was asked about is removed;
  everything else refuses exactly as before.
- **Confidence is recorded, never obeyed.** A 1.0 does not rescue an invalid answer and a
  0.01 does not block a valid one.
- **It has no tools.** No Bash, no file reads, no browser, no MCP. It decides from the
  evidence in the prompt or it declines — and declining is a correct answer.

Every exchange is appended to `ai/reports/abstraction-semantic.jsonl`: the fingerprint, the
semantic code, the evidence summary, the allowed owners, the model, the decision, the
confidence, the outcome and the rejection reason. No recorded value ever reaches it.

| Status | Written? |
| --- | --- |
| `PROPOSED` (deterministic **or** resolver-accepted then re-validated) | **Yes** |
| `NEEDS_REVIEW` | Never |
| `REFUSED` | Never |
| `REUSE` / `REUSE_PARAMETERIZED` | Never — the method already exists |

There is no input to `applyProposals` that can move a proposal between those rows. An
approvals-file override was tried and removed: an approved fingerprint would have carried a
`REFUSED` proposal — a generated identifier — straight past the gate that exists to stop it.

---

## 4. What gets written

Two files, together or not at all — a method the matcher cannot find is not half a feature,
it is a defect with a passing test suite.

**A searched-for element** takes the `resolve()` form every other method here uses:

```ts
closeButton(): Promise<Locator> {
  return this.resolve('notifications.closeButton', [
    { strategy: '#ap_notifications_panel .ap-notif-settings-close',
      build: page => page.locator('#ap_notifications_panel .ap-notif-settings-close') },
  ]);
}
```

**A row-scoped member** takes the synchronous `Locator` form, like the existing
`resultRows()` and `rowStatus(row)` — the locator is composed from a container the caller
names, not searched for:

```ts
issueCheckboxState(description: string): Locator {
  return this.page.locator('.tabulator-row')
      .filter({ hasText: description })
      .locator('.bugChecked');
}
```

And the knowledge entry that makes it findable:

```yaml
  issue_checkbox_state:
    usage: assertion
    description: The state of the control in one issue row, addressed by its description.
    page_object: IssuesPage
    page_object_method: issueCheckboxState
    locator_strategy: "page.locator('.tabulator-row').filter({ hasText: description }).locator('.bugChecked')"
    parameter: description - the text identifying one row, supplied by the caller
```

`locator_strategy` doubles as the **parameter template** — it is what a future recording is
matched against, so no second schema was invented for it.

---

## 5. Why most candidates are refused

This is the part worth understanding, because a healthy corpus produces **few** proposals.
A refusal is the framework declining to guess.

| Refused because | What it means |
| --- | --- |
| No press-time proof | The browser never measured this element as the person pressed it |
| `identityMatched` not true | Something matched once, but nothing proves it is the element clicked |
| Generated identifier | `#tr_637446` names one issue, not one element |
| `.first()` / `.nth()` | Codegen found several and took the first; position is not identity |
| Identified only by its own text | That is data (`Faclon labs`), not an element |
| Ambiguous ownership | The route declares several owning classes; nothing says which |
| Name shared by several elements | `Close` names five different buttons in this corpus |
| Values do not differ | One value is not a parameter |

**A blocked case is an acceptable outcome.** The goal is not to maximise generated tests; it
is that every locator that *is* written is one the evidence proves.

---

## 6. Parameterised reuse

The mechanism that lets one method serve many tests rests on **round-trip equality**.

The knowledge entry declares the template with the parameter in it. The recorder measured,
at the press, an expression for the element somebody touched. Matching one against the other
yields the argument — and substituting it back must reproduce the proven expression
**exactly**:

```
template   page.locator('.tabulator-row').filter({ hasText: description }).locator('.bugChecked')
proven     page.locator('.tabulator-row').filter({ hasText: 'Line Chart : …' }).locator('.bugChecked')
                                                             ↑ the argument
```

When the round trip holds, the locator a generated call builds is not *similar* to the one
that was proven — it **is** that string. So `matchCount === 1`, `identityMatched`,
`sameDocument` and `measuredAt: 'press'` all carry over untouched. No gate is re-derived and
none is relaxed.

When it does not hold, the answer is `NEEDS_REVIEW`. Refusing costs a raw locator, which is
honest. Guessing costs a call that reads correctly in review and addresses the wrong row.

**This is not a general text-to-parameter mechanism.** A value becomes an argument only
where a method already declares that parameter in a template the element's own proven
expression matches. `getByText('Faclon labs')` does **not** become `openProject('Faclon
labs')` here — no template proves that relationship.

---

## 7. Action and assertion are different methods

The clickable element and the element carrying state are routinely different nodes:

```
div.tabulator-row
└ label.rounded-checkbox-cont
  ├ input.bugChecked          ← state; 0×0; assertable, not clickable
  └ span.rounded-checkbox-ui  ← clickable; carries no state
```

So they get separate methods — `issueCheckbox(description)` and
`issueCheckboxState(description)` — and the knowledge entry's `usage: action | assertion`
stops one being reused for the other. Naming is deliberately asymmetric so a call site
cannot confuse them.

---

## 8. Positional selectors: two different rules

| Where | Allowed? |
| --- | --- |
| **Generated test code** | **Never.** A position is not an identity |
| **Inside a Page Object method** | **Yes, when the method already provides the context** |

The second is not a loophole. `resolveLocator` narrows every candidate with `.first()`
internally, and `LoginPage`/`ProjectsPage` use it deliberately for the toast, the language
toggle and the team option. The method's name and scope carry the identity; the position
only picks within an already-identified context.

A recorded `.first()` is never *stripped* to make a locator pass. Either an independently
measured contextual candidate identifies the element, or a person decides.

---

## 9. Files

| Path | Role |
| --- | --- |
| `ai/autocode/abstraction/classify.ts` | The ten classification rules |
| `ai/autocode/abstraction/validate.ts` | Safety gates and the parameterisation conditions |
| `ai/autocode/abstraction/naming.ts` | Deterministic method names |
| `ai/autocode/abstraction/propose.ts` | Corpus analysis, ownership, the ledger |
| `ai/autocode/abstraction/parameter.ts` | Round-trip extraction and reuse |
| `ai/autocode/abstraction/writer.ts` | Rendering, validation, atomic apply |
| `ai/autocode/abstraction/semantic.ts` | The one sanctioned model call, and the re-validation of its answer |
| `ai/reports/abstraction-proposals.jsonl` | The ledger (a report) |
| `ai/reports/abstraction-semantic.jsonl` | Audit of every model exchange (append-only) |

Fixtures: `abstraction-engine`, `abstraction-writer`, `semantic`,
`parameter-reuse`, `locator-safety` — all offline, no browser, no model.

---

## 10. Related

| Document | For |
| --- | --- |
| [RECORDING-GUIDE.md](RECORDING-GUIDE.md) | Recording in a browser, the assertion picker |
| [FRAMEWORK-GUIDE.md](FRAMEWORK-GUIDE.md) | Setup, authoring, running, maintenance |
| [ai/CLAUDE.md](ai/CLAUDE.md) | Why the generation pipeline is built the way it is |
