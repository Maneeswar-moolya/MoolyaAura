/**
 * What would this recording produce TODAY? - a fresh generation, in isolation.
 *
 *   npx tsx ai/autocode/fresh-generation.ts TC_LOGIN_112              # deterministic only
 *   npx tsx ai/autocode/fresh-generation.ts TC_LOGIN_112 --resolve    # allow the AI resolver
 *   npx tsx ai/autocode/fresh-generation.ts TC_LOGIN_112 --apply      # write the Page Objects
 *   npx tsx ai/autocode/fresh-generation.ts TC_LOGIN_112 --out <file> # where the spec goes
 *
 * WHY THIS IS NOT `excel:run`. A normal run is driven by the workbook and writes the
 * spec a case OWNS - `tests-e2e/generated/TC_LOGIN_112.spec.ts`. That spec is an
 * accepted, validated artefact, and re-running the generator over an accepted case in
 * order to inspect the new architecture would rewrite it. Existing generated specs are
 * out of scope for this phase and must stay byte-identical, so this harness exists to
 * ask the question WITHOUT answering it into the file.
 *
 * It therefore:
 *   - reads the recording from the ARCHIVE when it is not in the live queue
 *     (`analyseCorpus({ includeArchived: true })`), which nothing else does;
 *   - writes the assembled spec to a path the caller names, defaulting to a `.fresh`
 *     sibling that no accepted case owns;
 *   - never touches the workbook, mapping.json or state.json.
 *
 * Page Object CREATION is a real, shared side effect and is opt-in behind `--apply`:
 * a method written for this recording is written for the repository, and doing that
 * silently from an inspection command would be a surprise.
 */

import * as fs from 'fs';
import * as path from 'path';

import { analyseCorpus, writeLedger } from './abstraction/propose';
import { resolveSemanticReviews } from './abstraction/semantic';
import { applyProposals } from './abstraction/writer';
import {
  appendLifecycleLog, decideLifecycle, describeLifecycle, summarise,
} from './abstraction/lifecycle';
import {
  assembleSpec, mapRecording, readAssertions, readEvidence,
} from './from-recording';
import { parseRecording, readArchivedArtifact, readArtifact } from '../dashboard/recorder';
import { parseWorkbook } from '../excel/parser';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();
const WORKBOOK = path.join(ROOT, 'excel', 'login-test-cases.xlsx');

interface Options {
  testCaseId: string;
  resolve: boolean;
  apply: boolean;
  out: string;
}

function parseArgs(argv: string[]): Options {
  const positional = argv.filter(value => !value.startsWith('--'));
  const testCaseId = (positional[0] ?? '').toUpperCase();
  const outFlag = argv.indexOf('--out');
  return {
    testCaseId,
    resolve: argv.includes('--resolve'),
    apply: argv.includes('--apply'),
    out: outFlag >= 0 && argv[outFlag + 1]
      ? argv[outFlag + 1]
      : path.join('tests-e2e', 'generated', `${testCaseId}.fresh.spec.ts`),
  };
}

/** The workbook row, because the spec's traceability block is built from it. */
async function testCaseFor(testCaseId: string): Promise<TestCase | null> {
  const parsed = await parseWorkbook(WORKBOOK);
  return parsed.testCases.find(entry => entry.testCaseId.toUpperCase() === testCaseId) ?? null;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const write = (text: string) => process.stdout.write(text);

  if (!options.testCaseId) {
    write('usage: npx tsx ai/autocode/fresh-generation.ts <TC_ID> [--resolve] [--apply] [--out <file>]\n');
    process.exit(2);
  }

  // 1. THE RECORDING. Live first, archive second - the same precedence the analyser
  //    uses, so the two cannot disagree about which recording is being generated from.
  const live = readArtifact(options.testCaseId);
  const source = live ?? readArchivedArtifact(options.testCaseId);
  const archived = !live && Boolean(source);
  if (!source) {
    write(`no recording found for ${options.testCaseId}, live or archived\n`);
    process.exit(1);
  }

  const testCase = await testCaseFor(options.testCaseId);
  if (!testCase) {
    write(`${options.testCaseId} is not in ${path.basename(WORKBOOK)}\n`);
    process.exit(1);
  }

  write(`\nfresh generation of ${options.testCaseId}`
    + ` (${archived ? 'archived' : 'live'} recording)\n`);
  write(`  resolver: ${options.resolve ? 'enabled' : 'disabled (deterministic only)'}`
    + `   page objects: ${options.apply ? 'WILL BE WRITTEN' : 'proposed only'}\n`);
  write(`  authored scenario: ${testCase.scenario}\n\n`);

  // 2. THE PAGE OBJECT PASS, over a corpus that can see the archive.
  const corpus = analyseCorpus({ includeArchived: true });
  const mine = corpus.proposals.filter(proposal =>
    proposal.testCaseId.split(',').includes(options.testCaseId)
    || proposal.sightings.some(sighting => sighting.testCaseId === options.testCaseId));
  const unmeasured = corpus.unmeasured.filter(entry => entry.testCaseId === options.testCaseId);

  write(`  ${mine.length} proposal(s), ${unmeasured.length} unmeasured element(s)\n`);
  for (const proposal of mine) {
    write(`    ${proposal.status.padEnd(13)} ${proposal.owner ?? '?'}.`
      + `${proposal.method ?? proposal.derivedMethod ?? '?'}`
      + `${proposal.parameterName ? `(${proposal.parameterName})` : '()'}`
      + `  [${proposal.locatorStrategy}]`
      + `${proposal.refusalCodes.length ? `  ${proposal.refusalCodes.map(code => code.code).join(',')}` : ''}\n`);
  }

  if (options.resolve && mine.length) {
    write('\n  semantic resolver:\n');
    const outcome = await resolveSemanticReviews({ ...corpus, proposals: mine }, {
      onLog: text => write(`  ${text}`),
    });
    write(`  asked ${outcome.asked}, accepted ${outcome.accepted} `
      + `(${outcome.repaired} after repair), rejected ${outcome.rejected}, `
      + `${outcome.calls} transport call(s)\n`);
  }

  let writes: ReturnType<typeof applyProposals>['results'] = [];
  if (options.apply && mine.length) {
    const outcome = applyProposals(mine);
    writes = outcome.results;
    const created = outcome.results.filter(entry => entry.written);
    write(`\n  writer: ${outcome.reason}\n`);
    for (const entry of outcome.results) {
      write(`    ${entry.outcome.padEnd(15)} ${entry.proposal.owner}.${entry.proposal.method}()`
        + `${entry.problems.length ? ` - ${entry.problems.join('; ')}` : ''}\n`);
    }
    if (created.length)
      write(`  ${created.length} method(s) written and verified\n`);
    writeLedger(corpus);
  }

  // 3. THE SPEC. Mapped and assembled exactly as the generator would, then written to
  //    a path the accepted case does not own.
  const recording = parseRecording(source, {
    startUrl: '', browser: '', durationMs: 0,
    evidence: readEvidence(options.testCaseId, { archived }),
    stateAssertions: readAssertions(options.testCaseId, { archived }),
  });
  const mapping = mapRecording(recording);
  const spec = assembleSpec(testCase, mapping, WORKBOOK);

  const outPath = path.resolve(ROOT, options.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, spec, 'utf8');

  // 4. THE LIFECYCLE, for every element the mapping says needed a Page Object.
  const decisions = decideLifecycle({
    testCaseId: options.testCaseId,
    generationId: `fresh-${options.testCaseId}`,
    timestamp: new Date().toISOString(),
    mapping, proposals: mine, unmeasured, writes,
  });
  appendLifecycleLog(decisions);

  write('\n');
  write(describeLifecycle(decisions));

  const totals = summarise(decisions);
  const title = /test\(\s*'([^']*)'/.exec(spec)?.[1] ?? '(none)';
  write('\n  ---- fresh generation summary ----\n');
  write(`  spec written : ${path.relative(ROOT, outPath).replace(/\\/g, '/')}\n`);
  write(`  title        : ${title}\n`);
  write(`  elements     : ${totals.total}\n`);
  for (const [disposition, count] of Object.entries(totals.byDisposition)) {
    if (count)
      write(`    ${count.toString().padStart(3)}  ${disposition}\n`);
  }
  write(`  raw locators : ${mapping.codegenLocators}\n`);
  write(`  reused       : ${mapping.reused.length}\n`);
}

void main();
