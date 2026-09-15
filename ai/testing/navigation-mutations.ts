/** Navigation mutants run only inside guarded synthetic checkouts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const navigation = 'ai/dashboard/navigation.ts';
const mutants = [
  { name: 'entry competes with return visit', file: navigation,
    edits: [["this.visits.filter(visit => !visit.entry)", 'this.visits']],
    gate: 'Explicit entry must not poison a proven return to the same URL' },
  { name: 'redirect consumed as explicit entry', file: navigation,
    edits: [["return !redirected && requestKey(url) === capture.url", "return requestKey(url) === capture.url"]],
    gate: 'A redirect cannot be consumed as the explicit entry request' },
  { name: 'entry command borrows a later matching request', file: navigation,
    edits: [["capture.awaiting = false;", "// corrupted: keep claiming document requests"]],
    gate: 'A later matching request cannot claim the entry command' },
  { name: 'history competes for document cause', file: navigation,
    edits: [["visits.filter(v => v.kind !== 'history-api')", 'visits']],
    gate: 'History rewrite cannot obscure a proven document redirect' },
  { name: 'lost fragment aliases', file: navigation,
    edits: [["if (event.request.urlFragment)", "if (false && event.request.urlFragment)"],
      ["if (event.documentURL &&", "if (false && event.documentURL &&"],
      ["if (matches.length === 1) matches[0].urls.add(commit.url);", "if (false) matches[0].urls.add(commit.url);"]],
    gate: 'Fragment document URL must retain its request cause' },
  { name: 'arrival-order-dependent correlation', file: navigation,
    edits: [['for (const requested of this.requested)', 'for (const requested of [])']],
    gate: 'Cause and request event order must not matter' },
  { name: 'refresh initiators omitted', file: navigation,
    edits: [["metaTagRefresh: 'meta-refresh', httpHeaderRefresh: 'http-refresh'", "unsupportedMeta: 'meta-refresh', unsupportedHttp: 'http-refresh'"]],
    gate: 'Browser refresh cause must be retained' },
  { name: 'foreign frame grants cause', file: navigation,
    edits: [['if (event.frameId !== mainFrameId) return;', ''],
      ["event.frameId !== mainFrameId || event.type !== 'Document'", "event.type !== 'Document'"]],
    gate: 'Child frame cannot grant top-level navigation causality' },
  { name: 'repeated destination borrows proof', file: navigation,
    edits: [["matches.some(v => v.cause === 'unknown') || offset >= matches.length", 'offset >= matches.length']],
    gate: 'Repeated URL cannot inherit another visit causality' },
  { name: 'foreign loader grants fragment cause', file: navigation,
    edits: [['v.loaderId && v.loaderId === commit.loaderId &&', '']],
    gate: 'A different loader cannot grant fragment causality' },
  { name: 'diagnostics disclose transient URL', file: navigation,
    edits: [["safe ? url : '[navigation withheld]'", 'url']],
    gate: 'Navigation diagnostic must not expose fragment values' },
  { name: 'review labeled ok', file: 'ai/autocode/from-recording.ts',
    edits: [["step.kind === 'needs-review' ? 'NEEDS REVIEW'", "step.kind === 'needs-review' ? 'ok'"]],
    gate: 'Navigation review must not be labeled ok' },
];
const choice = process.argv.find(arg => arg.startsWith('--mutant='));
if (!choice && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename, `--mutant=${i}`],
      { stdio: 'inherit', timeout: 300000, windowsHide: true });
    assert.equal(child.status, 0, `Mutation ${i}: ${child.error ?? ''}`);
  }
  console.log(`PASS all ${mutants.length} navigation source mutants killed`);
} else {
  require('./isolated-checkout');
  assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant = mutants[Number(choice?.split('=')[1])]; assert.ok(mutant);
  const before = fs.readFileSync(mutant.file, 'utf8'); let changed = before.replace(/\r\n/g, '\n');
  for (const [from, to] of mutant.edits) {
    assert.ok(changed.includes(from), `Mutation anchor: ${mutant.name}`);
    changed = changed.split(from).join(to);
  }
  try {
    fs.writeFileSync(mutant.file, changed);
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/dashboard/navigation-causality.fixture.ts', '--events-only'], {
      env: { ...process.env, AURA_SYNTHETIC_FIXTURE_ROOT: '' }, encoding: 'utf8',
      timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    const output = child.stdout + child.stderr;
    assert.notEqual(child.status, 0, `SURVIVED: ${mutant.name}`);
    assert.ok(output.includes(`FAIL ${mutant.gate}`) || output.includes(`[ERR_ASSERTION]: ${mutant.gate}`),
      `Wrong failure for ${mutant.name}: ${output}`);
    console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
  } finally { fs.writeFileSync(mutant.file, before); }
}
