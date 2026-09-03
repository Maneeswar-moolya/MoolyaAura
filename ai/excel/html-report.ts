/**
 * Local HTML execution report — reports/excel-execution-report.html
 *
 * Written alongside the .xlsx from the same row data, so the two can never
 * disagree. Deliberately self-contained: inline CSS, no scripts, no network
 * requests, no build step. Open it with a double-click, attach it to a CI run,
 * or print it to PDF.
 *
 * Two things matter more than the styling here:
 *   1. Everything from the workbook is HTML-escaped. Spreadsheet cells are
 *      arbitrary text from outside this codebase; a scenario named
 *      `<img onerror=...>` must render as characters, not markup.
 *   2. Status is encoded in shape and text, not colour alone, so the report
 *      survives greyscale printing and colour-blind readers.
 */

import type { Mapping } from './mapping';
import type { ReportRow, ReportSummary } from './execution-report';
import type { HealingRecord } from './results';
import type { ParseResult } from './types';

/** Escape for both text and attribute contexts. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `2026-08-10T07:36:37.921Z` -> `2026-08-10 07:36 UTC`, safely. */
function humanTime(iso: string): string {
  if (!iso)
    return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime()))
    return esc(iso);
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

type Tone = 'pass' | 'fail' | 'review' | 'skip' | 'idle';

function executionTone(row: ReportRow): Tone {
  if (row.automationStatus === 'Needs Review')
    return 'review';
  switch (row.executionStatus) {
    case 'Passed': return 'pass';
    case 'Failed': return 'fail';
    case 'Skipped': return 'skip';
    case 'Blocked': return 'fail';
    default: return 'idle';
  }
}

function automationTone(row: ReportRow): Tone {
  switch (row.automationStatus) {
    case 'Automated': return 'pass';
    case 'Needs Review': return 'review';
    case 'Generated': return 'skip';
    default: return 'idle';
  }
}

interface Segment { label: string; count: number; tone: Tone }

function distribution(rows: ReportRow[]): Segment[] {
  const review = rows.filter(row => row.automationStatus === 'Needs Review').length;
  const rest = rows.filter(row => row.automationStatus !== 'Needs Review');
  const count = (status: string) => rest.filter(row => row.executionStatus === status).length;
  const segments: Segment[] = [
    { label: 'Passed', count: count('Passed'), tone: 'pass' },
    { label: 'Failed', count: count('Failed') + count('Blocked'), tone: 'fail' },
    { label: 'Skipped', count: count('Skipped'), tone: 'skip' },
    { label: 'Needs review', count: review, tone: 'review' },
    { label: 'Not run', count: count('Not Run'), tone: 'idle' },
  ];
  return segments.filter(segment => segment.count > 0);
}

const STYLES = `
:root {
  --ground:#f4f6f8; --surface:#fff; --sunk:#edf0f4;
  --rule:#d8dde5; --rule-strong:#bec6d2;
  --ink:#161a21; --ink-soft:#4a5361; --ink-faint:#79828f;
  --accent:#3f4fc0; --accent-soft:#e6e9fa;
  --pass:#16785a; --pass-soft:#ddf0e8;
  --fail:#b33526; --fail-soft:#fae2de;
  --review:#8c6103; --review-soft:#f8ecd3;
  --skip:#3f4fc0; --skip-soft:#e6e9fa;
  --idle:#6e7684; --idle-soft:#e7eaef;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground:#0e1116; --surface:#161a21; --sunk:#1d222b;
    --rule:#2a313c; --rule-strong:#3b4450;
    --ink:#e8ebf0; --ink-soft:#a7b0bd; --ink-faint:#79828f;
    --accent:#8b97f2; --accent-soft:#232a47;
    --pass:#52c293; --pass-soft:#14312a;
    --fail:#f07a69; --fail-soft:#38201d;
    --review:#e0a83f; --review-soft:#33280f;
    --skip:#8b97f2; --skip-soft:#232a47;
    --idle:#8b93a1; --idle-soft:#232935;
  }
}
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body {
  margin:0; background:var(--ground); color:var(--ink);
  font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing:antialiased;
}
.mono { font-family:ui-monospace,"Cascadia Mono","SF Mono",Consolas,monospace; font-variant-numeric:tabular-nums; }
.wrap { max-width:1140px; margin:0 auto; padding:40px 24px 72px; display:flex; flex-direction:column; gap:32px; }
.visually-hidden {
  position:absolute; width:1px; height:1px; margin:-1px; padding:0;
  overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0;
}
a { color:var(--accent); }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }

.eyebrow {
  font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;
  font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint);
}
h1 { margin:.35em 0 0; font-size:clamp(26px,4vw,36px); line-height:1.1; letter-spacing:-.022em; font-weight:640; text-wrap:balance; }
h2 {
  margin:0 0 12px; font-size:13px; letter-spacing:.1em; text-transform:uppercase;
  font-weight:620; color:var(--ink-soft); padding-bottom:8px; border-bottom:1px solid var(--rule-strong);
}

.grid-strip { display:flex; flex-wrap:wrap; border:1px solid var(--rule); background:var(--surface); }
.cell { flex:1 1 190px; padding:12px 16px; border-right:1px solid var(--rule); display:flex; flex-direction:column; gap:3px; min-width:0; }
.cell:last-child { border-right:0; }
.cell dt { font-size:10.5px; letter-spacing:.11em; text-transform:uppercase; color:var(--ink-faint); }
.cell dd { margin:0; font-size:13px; overflow-wrap:anywhere; }
.ok { color:var(--pass); font-weight:600; display:inline-flex; align-items:center; gap:6px; }
.ok::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--pass); flex:none; }

.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(126px,1fr)); gap:1px; background:var(--rule); border:1px solid var(--rule); }
.tile { background:var(--surface); padding:15px 18px 13px; display:flex; flex-direction:column; gap:2px; }
.tile b { font-size:29px; line-height:1.05; font-weight:620; letter-spacing:-.02em; }
.tile span { font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink-faint); }
.tile i { height:2px; width:24px; margin-top:8px; background:var(--rule-strong); display:block; }
.tile.pass b{color:var(--pass)} .tile.pass i{background:var(--pass)}
.tile.fail b{color:var(--fail)} .tile.fail i{background:var(--fail)}
.tile.review b{color:var(--review)} .tile.review i{background:var(--review)}

.bar { display:flex; height:12px; border:1px solid var(--rule); background:var(--surface); overflow:hidden; }
.bar div { height:100%; }
.legend { display:flex; flex-wrap:wrap; gap:18px; font-size:12.5px; color:var(--ink-soft); margin-top:10px; }
.legend span { display:inline-flex; align-items:center; gap:7px; }
.legend i { width:10px; height:10px; flex:none; }
.t-pass{background:var(--pass)} .t-fail{background:var(--fail)} .t-review{background:var(--review)}
.t-skip{background:var(--skip)} .t-idle{background:var(--idle)}

.scroll { overflow-x:auto; border:1px solid var(--rule); background:var(--surface); }
table { border-collapse:collapse; width:100%; min-width:900px; }
caption { text-align:left; padding:0 0 10px; color:var(--ink-faint); font-size:12px; }
th { text-align:left; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint);
     font-weight:600; padding:11px 14px; background:var(--sunk); border-bottom:1px solid var(--rule-strong); white-space:nowrap; }
td { padding:12px 14px; border-bottom:1px solid var(--rule); vertical-align:top; font-size:13.5px; }
tbody tr:last-child td { border-bottom:0; }
td.id { white-space:nowrap; font-weight:600; font-size:13px; }
/* Arrived at via #TC_ID from the workbook - make the row obvious. */
tr:target td { background:var(--accent-soft); }
tr:target td.id { box-shadow:inset 3px 0 0 var(--accent); }
tr:target { scroll-margin-top:60px; }
td.num { text-align:right; white-space:nowrap; color:var(--ink-soft); }
td.path { color:var(--ink-faint); font-size:12px; }
.note { display:block; font-size:12px; color:var(--ink-soft); border-left:2px solid var(--rule-strong); padding-left:9px; margin-top:5px; }
.note.review { border-left-color:var(--review); }
.note.fail { border-left-color:var(--fail); }

.lamp { display:inline-flex; align-items:center; gap:7px; white-space:nowrap; font-size:12.5px; }
.lamp::before { content:""; width:8px; height:8px; border-radius:50%; flex:none; background:currentColor; }
.pill { display:inline-block; padding:2px 8px; font-size:11px; letter-spacing:.04em; white-space:nowrap; border:1px solid currentColor; }
.c-pass{color:var(--pass)} .c-fail{color:var(--fail)} .c-review{color:var(--review)}
.c-skip{color:var(--skip)} .c-idle{color:var(--idle)}
.pill.c-pass{background:var(--pass-soft)} .pill.c-fail{background:var(--fail-soft)}
.pill.c-review{background:var(--review-soft)} .pill.c-skip{background:var(--skip-soft)} .pill.c-idle{background:var(--idle-soft)}

.stack { display:flex; flex-direction:column; gap:1px; background:var(--rule); border:1px solid var(--rule); }
.item { background:var(--surface); padding:14px 16px; display:grid; grid-template-columns:minmax(118px,auto) 1fr; gap:4px 18px; }
.item > .k { font-size:13px; font-weight:600; color:var(--review); }
.item > div > p { margin:0 0 4px; }
.item > div > p:last-child { margin:0; font-size:12.5px; color:var(--ink-soft); }

ul.plain { margin:0; padding-left:18px; color:var(--ink-soft); font-size:13px; display:flex; flex-direction:column; gap:6px; }

footer { border-top:1px solid var(--rule); padding-top:16px; color:var(--ink-faint); font-size:12px; display:flex; flex-direction:column; gap:5px; }

@media (max-width:620px) { .item { grid-template-columns:1fr; } .wrap { padding:26px 16px 52px; } }
@media print {
  :root { --ground:#fff; --surface:#fff; --sunk:#f2f2f2; --ink:#000; --ink-soft:#333; --ink-faint:#555; --rule:#bbb; --rule-strong:#888; }
  body { font-size:11pt; }
  .wrap { max-width:none; padding:0; gap:20px; }
  .scroll { overflow:visible; }
  table { min-width:0; }
  tr, .item, .tile { break-inside:avoid; }
}
`;

function tile(count: number, label: string, tone?: Tone): string {
  const cls = tone && ['pass', 'fail', 'review'].includes(tone) ? ` class="tile ${tone}"` : ' class="tile"';
  return `<div${cls}><b class="mono">${count}</b><span>${esc(label)}</span><i></i></div>`;
}

function renderRow(row: ReportRow, healing: HealingRecord | undefined): string {
  const execTone = executionTone(row);
  const autoTone = automationTone(row);
  const reason = row.failureReason.trim();
  const cause = row.rootCause.trim();

  const notes: string[] = [];
  if (reason) {
    notes.push(`<span class="note ${execTone === 'fail' ? 'fail' : 'review'}">${esc(reason)}</span>`);
  }
  if (cause && cause !== reason)
    notes.push(`<span class="note">${esc(cause)}</span>`);
  if (healing?.healed) {
    const swapped = healing.attempts.filter(attempt => attempt.applied)
        .map(attempt => `${attempt.locatorName}: “${attempt.from}” → “${attempt.to}”`).join('; ');
    notes.push(`<span class="note">Healed — ${esc(swapped)}. Update the Page Object; the primary strategy is stale.</span>`);
  }

  // The id makes each row addressable, so the workbook can link straight to it:
  // excel-execution-report.html#TC_LOGIN_001
  return `<tr id="${esc(row.testCaseId)}">
    <td class="id mono">${esc(row.testCaseId)}</td>
    <td>${esc(row.scenario) || '<em>—</em>'}${notes.join('')}</td>
    <td>${esc(row.module) || '—'}</td>
    <td class="mono">${esc(row.priority) || '—'}</td>
    <td><span class="pill c-${autoTone} mono">${esc(row.automationStatus)}</span></td>
    <td><span class="lamp c-${execTone}">${esc(row.executionStatus)}</span></td>
    <td class="num mono">${row.durationSeconds === '' ? '—' : `${row.durationSeconds}s`}</td>
    <td class="path mono">${esc(row.testFile) || '—'}</td>
  </tr>`;
}

export interface HtmlReportInput {
  parsed: ParseResult;
  mapping: Mapping;
  rows: ReportRow[];
  summary: ReportSummary;
  healingLog: Record<string, HealingRecord>;
  generatedAt: string;
  resultsPath: string | null;
  xlsxPath: string;
}

export function renderHtmlReport(input: HtmlReportInput): string {
  const { parsed, mapping, rows, summary, healingLog, generatedAt, resultsPath, xlsxPath } = input;

  const segments = distribution(rows);
  const total = rows.length || 1;
  const bar = segments
      .map(segment => `<div class="t-${segment.tone}" style="width:${((segment.count / total) * 100).toFixed(3)}%"></div>`)
      .join('');
  const legend = segments
      .map(segment => `<span><i class="t-${segment.tone}"></i>${esc(segment.label)} · ${segment.count}</span>`)
      .join('');
  const barLabel = segments.map(segment => `${segment.count} ${segment.label.toLowerCase()}`).join(', ');

  const review = rows.filter(row => row.automationStatus === 'Needs Review');
  const failed = rows.filter(row => row.executionStatus === 'Failed' || row.executionStatus === 'Blocked');
  const skippedSheets = parsed.worksheets.filter(sheet => !sheet.recognized);

  const sections: string[] = [];

  if (failed.length) {
    sections.push(`<section aria-labelledby="h-failed">
      <h2 id="h-failed">Failures — ${failed.length}</h2>
      <div class="stack">${failed.map(row => `<div class="item">
        <span class="k mono c-fail">${esc(row.testCaseId)}</span>
        <div>
          <p>${esc(row.failureReason) || 'No failure message captured.'}</p>
          <p>${esc(row.rootCause) || 'Root cause not classified — read the trace.'}</p>
        </div>
      </div>`).join('')}</div>
    </section>`);
  }

  if (review.length) {
    sections.push(`<section aria-labelledby="h-review">
      <h2 id="h-review">Needs review — returned to the author</h2>
      <div class="stack">${review.map(row => `<div class="item">
        <span class="k mono">${esc(row.testCaseId)}</span>
        <div>
          <p>${esc(row.failureReason) || esc(mapping[row.testCaseId]?.reviewReason) || 'Flagged as not automatable as written.'}</p>
          <p>Not automated by design — automating an ambiguous case produces coverage that proves nothing.</p>
        </div>
      </div>`).join('')}</div>
    </section>`);
  }

  const parserNotes: string[] = [];
  if (parsed.malformed.length) {
    parserNotes.push(`<li><strong>${parsed.malformed.length} malformed row(s) skipped.</strong> ` +
      parsed.malformed.slice(0, 5).map(item => esc(`${item.worksheet} row ${item.row}: ${item.message}`)).join('; ') + '</li>');
  }
  if (skippedSheets.length) {
    parserNotes.push(`<li><strong>${skippedSheets.length} worksheet(s) skipped.</strong> ` +
      skippedSheets.map(sheet => `“${esc(sheet.worksheet)}” — ${esc(sheet.skipReason ?? '')}`).join('; ') + '</li>');
  }
  const mappedColumns = parsed.worksheets.find(sheet => sheet.recognized)?.bindings.filter(binding => binding.field).length;
  if (mappedColumns) {
    parserNotes.push(`<li><strong>${mappedColumns} column(s) mapped</strong> to canonical fields. ` +
      'Full interpretation table in <span class="mono">ai/reports/test-case-quality-report.md</span>.</li>');
  }
  if (parserNotes.length) {
    sections.push(`<section aria-labelledby="h-parser">
      <h2 id="h-parser">Parser notes</h2>
      <ul class="plain">${parserNotes.join('')}</ul>
    </section>`);
  }

  const healedCount = Object.values(healingLog).filter(record => record.healed).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Execution report — ${esc(parsed.workbook)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">

<header>
  <p class="eyebrow">Excel Test Case Integration · Execution Report</p>
  <h1>${esc(parsed.workbook)}</h1>
</header>

<dl class="grid-strip">
  <div class="cell"><dt>Source workbook</dt><dd class="mono">${esc(parsed.workbook)}</dd></div>
  <div class="cell"><dt>Worksheets read</dt><dd>${esc(parsed.worksheets.filter(s => s.recognized).map(s => s.worksheet).join(', ')) || '—'}</dd></div>
  <div class="cell"><dt>Playwright results</dt><dd class="mono">${esc(resultsPath ?? 'not supplied')}</dd></div>
  <div class="cell"><dt>Generated</dt><dd class="mono">${humanTime(generatedAt)}</dd></div>
  <div class="cell"><dt>Source integrity</dt><dd><span class="ok">Read-only — unmodified</span></dd></div>
</dl>

<section class="tiles" aria-label="Totals">
  ${tile(summary.total, 'Test cases')}
  ${tile(summary.automated, 'Automated', 'pass')}
  ${tile(summary.passed, 'Passed', 'pass')}
  ${tile(summary.failed, 'Failed', 'fail')}
  ${tile(summary.needsReview, 'Needs review', 'review')}
  ${tile(healedCount, 'Healed')}
</section>

<section aria-label="Status distribution">
  <div class="bar" role="img" aria-label="Final status: ${esc(barLabel)}">${bar}</div>
  <div class="legend">${legend}</div>
</section>

<section aria-labelledby="h-ledger">
  <h2 id="h-ledger">Results</h2>
  <div class="scroll" tabindex="0" role="region" aria-labelledby="h-ledger">
    <table>
      <caption class="visually-hidden">Execution results for every test case in ${esc(parsed.workbook)}</caption>
      <thead><tr>
        <th scope="col">Test case</th><th scope="col">Scenario</th><th scope="col">Module</th>
        <th scope="col">Pri</th><th scope="col">Automation</th><th scope="col">Execution</th>
        <th scope="col" style="text-align:right">Duration</th><th scope="col">Test file</th>
      </tr></thead>
      <tbody>${rows.map(row => renderRow(row, healingLog[row.testCaseId])).join('')}</tbody>
    </table>
  </div>
</section>

${sections.join('\n')}

<footer>
  <p>Spreadsheet edition of this report: <span class="mono">${esc(xlsxPath)}</span></p>
  <p>Automation status is earned — a case becomes <span class="mono">Automated</span> only after a green run, and reverts to <span class="mono">Generated</span> if it starts failing.</p>
</footer>

</div>
</body>
</html>
`;
}
