import '../testing/isolated-checkout';
/**
 * Two fixes the Phase 3 audit measured: attribute ordering, and redaction precision.
 *
 *   npx tsx ai/autocode/attribute-order-redaction.fixture.ts
 *
 * Offline: no browser, no model, no network. It writes nothing anywhere.
 *
 * WHY THESE TWO
 *
 * 1. The attribute family is budgeted at three and emitted its SCOPED variants last, so
 *    an element carrying `name` plus two of {aria-label, href} spent every slot on
 *    unscoped shapes and lost the scoped one. Measured on FixturePortal's sign-in page, where
 *    three sign-in-shaped forms are mounted at once: `[name="email"]` matches THREE
 *    elements and `#loginForm input[name="email"]` matches one. The family was spending
 *    its whole budget on the ambiguous half.
 *
 * 2. `redactNode` dropped a node's text whenever its id CONTAINED a credential word, so
 *    `#password_field-error` - a `<label>` reading "Not too short! enter min 5
 *    characters." - lost its text for mentioning a password. It is a validation message
 *    and can hold no value at all.
 *
 * Neither change relaxes anything: the budget, the ceiling and the ranking are untouched,
 * and the redaction rule is strictly MORE protective in one direction (it now reads the
 * text itself) while being precise in the other.
 */

import {
  candidateSelectorsFor, holdsCredentialText, redactNode, semanticCandidatesFor,
  FAMILY_BUDGET, MAX_CANDIDATES, MAX_TOTAL_CANDIDATES,
  type DomNode,
} from './dom-evidence';
import { analyseIdentifier } from './locator-quality';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;

/* ============================================ A - the attribute family order */

const ANCESTORS = [
  { tag: 'form', id: 'loginForm', relationship: 'ancestor', depth: 1 },
  { tag: 'div', id: 'login_area', relationship: 'ancestor', depth: 3 },
];

function attributeFamily(target: any) {
  const graph = { target, ancestors: ANCESTORS, descendants: [], previousSiblings: [], nextSiblings: [] };
  const raw = semanticCandidatesFor(graph as never, isGenerated, ANCESTORS as never)
      .filter(entry => entry.family === 'attribute');
  const kept = candidateSelectorsFor(graph as never, isGenerated)
      .filter(entry => entry.family === 'attribute');
  return {
    raw, kept,
    keptScoped: kept.filter(entry => entry.strategy === 'scoped-attribute'),
    keptUnscoped: kept.filter(entry => entry.strategy !== 'scoped-attribute'),
    expressions: kept.map(entry => entry.expression),
  };
}

function checkOrdering(): void {
  section('A - scoped attribute candidates come first, inside the same budget');

  check('A: the attribute budget is unchanged', FAMILY_BUDGET.attribute === 3,
      String(FAMILY_BUDGET.attribute));
  check('A: the structural cap is unchanged', MAX_CANDIDATES === 16, String(MAX_CANDIDATES));
  check('A: the total ceiling is unchanged', MAX_TOTAL_CANDIDATES === 28, String(MAX_TOTAL_CANDIDATES));

  // THE CONSTRAINED CASE. Three attribute signals compete for three slots. Before this
  // change all three went to unscoped shapes and every scoped candidate was dropped.
  const crowded = attributeFamily({
    tag: 'a', name: 'go', href: '/store', hrefAbsolute: false, aria: { 'aria-label': 'Store' },
  });
  check('A: with name + aria-label + href, a scoped candidate SURVIVES',
      crowded.keptScoped.length > 0, crowded.kept.map(e => e.strategy).join(', '));
  check('A: and it is the NEAREST scope, not the outer one',
      crowded.keptScoped[0]?.expression.includes('#loginForm'),
      String(crowded.keptScoped[0]?.expression));
  check('A: the budget is still exactly three',
      crowded.kept.length === FAMILY_BUDGET.attribute, String(crowded.kept.length));
  check('A: and an unscoped candidate still survives beside them',
      crowded.keptUnscoped.length > 0, crowded.keptUnscoped.map(e => e.expression).join(' | '));

  // AT MOST TWO SCOPES ARE EVER OFFERED, so a budget of three can never be spent
  // entirely on scoped shapes - which is what guarantees the line above rather than
  // leaving it to luck.
  check('A: scoped candidates can never take every slot',
      crowded.raw.filter(e => e.strategy === 'scoped-attribute').length <= 2,
      String(crowded.raw.filter(e => e.strategy === 'scoped-attribute').length));

  // THE CASE THE WHOLE CORPUS HAS TODAY must not regress: `name` alone, where the old
  // order already kept a scoped candidate.
  const nameOnly = attributeFamily({ tag: 'input', name: 'email', type: 'email' });
  // The quotes are escaped inside the emitted expression, so this matches on the prefix
  // rather than on a string that would only look right in a comment.
  check('A: with `name` alone the nearest scoped candidate is still kept',
      nameOnly.keptScoped.some(e => e.expression.startsWith('page.locator("#loginForm input[name=')),
      nameOnly.expressions.join(' | '));
  check('A: both scopes fit when nothing else competes',
      nameOnly.keptScoped.length === 2, String(nameOnly.keptScoped.length));

  // The authored scoped-form shape: the scoped candidate is the one that resolves to one
  // element, so losing it was losing the only unambiguous member of the family.
  check('A: the scoped expression is the synthetic scoped form measured at one element',
      nameOnly.expressions.includes('page.locator("#loginForm input[name=\\"email\\"]")'),
      nameOnly.expressions.join(' | '));

  // An element with no id-bearing ancestor is unaffected - there is nothing to scope to.
  const unscopable = semanticCandidatesFor(
      { target: { tag: 'a', name: 'go', href: '/x', hrefAbsolute: false }, ancestors: [], descendants: [] } as never,
      isGenerated, [] as never).filter(entry => entry.family === 'attribute');
  check('A: with no scope available the unscoped candidates are unaffected',
      unscopable.length > 0 && unscopable.every(e => e.strategy !== 'scoped-attribute'),
      unscopable.map(e => e.strategy).join(', '));
}

/* ============================================= B - redaction precision */

const node = (over: Partial<DomNode>): DomNode => ({ tag: 'div', ...over } as DomNode);

function checkRedaction(): void {
  section('B - credential redaction: precise, and strictly no weaker');

  // ---- STILL REDACTED. Every one of these can hold, or is showing, a secret.
  const redacted: Array<[string, DomNode]> = [
    ['a real password input', node({ tag: 'input', type: 'password', id: 'password_field', text: 'hunter2' })],
    ['a password-like field by name', node({ tag: 'input', type: 'text', name: 'user_password', text: 'hunter2' })],
    ['a password-like field by id', node({ tag: 'input', type: 'text', id: 'login_pwd', text: 'hunter2' })],
    ['a token field', node({ tag: 'input', name: 'api_token', text: 'abc' })],
    ['a textarea named secret', node({ tag: 'textarea', name: 'client_secret', text: 'x' })],
    ['a select named otp', node({ tag: 'select', name: 'otp', text: 'x' })],
    ['a JWT shown in a div', node({ tag: 'div', id: 'output',
      text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r' })],
    ['a long opaque token in a code block', node({ tag: 'code',
      text: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6' })],
    ['a custom element with a credential name', node({ tag: 'x-secret-field', name: 'password', text: 'hunter2' })],
    ['a node with no tag at all', node({ tag: '', id: 'password', text: 'hunter2' })],
  ];
  for (const [label, value] of redacted) {
    check(`B: REDACTED - ${label}`, holdsCredentialText(value) === true);
    check(`B:   ...and redactNode drops its text`, redactNode(value).text === undefined);
  }

  // ---- NO LONGER REDACTED. None of these can hold a value, and none is showing a secret.
  const kept: Array<[string, DomNode]> = [
    ['#password_field-error, a validation label', node({
      tag: 'label', id: 'password_field-error', stableClasses: ['error'],
      text: 'Not too short! enter min 5 characters.',
    })],
    ['a heading that mentions a password', node({
      tag: 'h2', id: 'password-help', text: 'Choose a strong password',
    })],
    ['a paragraph of password advice', node({
      tag: 'p', id: 'password_hint', text: 'Your password must contain a number',
    })],
    ['a link to password reset', node({ tag: 'a', id: 'forgot_password_link', text: 'Forgot Password?' })],
    ['a button that submits a password form', node({
      tag: 'button', name: 'password_submit', text: 'Change password',
    })],
    ['an ordinary field with an ordinary name', node({ tag: 'input', name: 'email', text: '' })],
  ];
  for (const [label, value] of kept) {
    check(`B: KEPT - ${label}`, holdsCredentialText(value) === false);
  }
  const errorLabel = kept[0][1];
  check('B:   ...and redactNode keeps the validation text verbatim',
      redactNode(errorLabel).text === 'Not too short! enter min 5 characters.',
      String(redactNode(errorLabel).text));

  // ---- THE NEW PROTECTION. The old rule read only type/name/id, so a secret displayed
  // in an element with innocent attributes was kept in full. This is strictly stronger.
  const leaked = node({ tag: 'div', id: 'result', text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB' });
  check('B: a secret-shaped value is redacted whatever the element is called',
      holdsCredentialText(leaked) === true && redactNode(leaked).text === undefined);

  // ---- AMBIGUITY FAILS CLOSED.
  check('B: an unknown tag with a credential name is redacted',
      holdsCredentialText(node({ tag: 'wc-thing', id: 'user_password', text: 'x' })) === true);
  check('B: a text-only tag with a credential name is not',
      holdsCredentialText(node({ tag: 'span', id: 'user_password', text: 'Password' })) === false);

  // ---- EVERYTHING ELSE ABOUT REDACTION IS UNCHANGED.
  const credentialField = node({ tag: 'input', type: 'password', id: 'password_field', name: 'password' });
  const safe = redactNode(credentialField);
  check('B: a password field still keeps its SHAPE - tag, type, name, id',
      safe.tag === 'input' && safe.type === 'password' && safe.name === 'password'
      && safe.id === 'password_field');
  check('B: a forbidden attribute key is still dropped',
      redactNode(node({ tag: 'div', data: { 'data-auth-token': 'x' } } as never)).data === undefined);
  check('B: a secret-shaped attribute value is still dropped',
      redactNode(node({
        tag: 'div', data: { 'data-x': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB' },
      } as never)).data === undefined);
}

/* ------------------------------------------------------------------- main */

function main(): void {
  checkOrdering();
  checkRedaction();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
