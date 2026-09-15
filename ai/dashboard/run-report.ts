/**
 * The run's own downloadable report.
 *
 * WHY THIS EXISTS BESIDE THE PLAYWRIGHT REPORT RATHER THAN INSTEAD OF IT
 *
 * `/api/.../runs/<id>/report/` already served this run's kept copy of Playwright's HTML
 * report, and `hasReport` already controlled the link. Two things were wrong with that as
 * the whole answer. The link was hidden for every run started from an execution selection
 * - `record.executionSelection ? false : keepPlaywrightReport(...)` - so the artifact was
 * never produced and the control correctly hid something that did not exist. And
 * Playwright's report cannot carry what a MoolyaAura execution report has to carry: the
 * application and environment, the credential profile by NAME, the attempt, the recorded
 * step key, the per-step duration and the evidence this framework captured.
 *
 * So the route keeps its meaning and gains its missing artifact. Playwright's copy is
 * still retained where it was before and is still reachable, one level down.
 *
 * SELF-CONTAINED, like the workbook report this repository already writes: inline CSS, no
 * scripts, no network requests, screenshots embedded. A downloaded report that needs the
 * dashboard running to show its own evidence is not a report anybody can send anywhere.
 *
 * NOTHING SENSITIVE LEAVES WITH IT. Every string goes through `diagnosticText`, the same
 * redaction the run diagnostics already use - secrets, emails, bearer tokens, query
 * strings - and then through HTML escaping. Paths are run-relative. The credential profile
 * appears as a name and never as a value.
 */
import fs from 'node:fs';
import path from 'node:path';
import { diagnosticText } from '../diagnostics/artifacts';

/** Escape for both text and attribute contexts. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/**
 * A local path that names a person is not evidence anybody outside this machine needs.
 *
 * `diagnosticText` covers secrets, accounts, tokens and query strings; it does not cover a
 * user's home directory, and a report is the one artifact that leaves the machine it was
 * produced on. Removed HERE rather than in the shared redactor, whose reach is every run
 * diagnostic and whose behaviour is not this task's to change.
 */
function withoutLocalPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'<>]+/gi, '[PATH REDACTED]')
    .replace(/\/(?:home|Users)\/[^/\s"'<>]+/g, '[PATH REDACTED]');
}
/** Redact first, then escape. Order matters: escaping a secret still ships the secret. */
const safe = (value: unknown): string => esc(withoutLocalPaths(diagnosticText(value)));

export interface RunReportStep {
  index: number; title: string; status: string; durationMs: number;
  error?: string; captureTiming?: string; captureUnavailable?: string;
  attemptId?: string; attemptNumber?: number;
  diagnostic?: { recordingStepKey?: string };
  captures?: Array<{ captureRef: string; captureType: string; capturedAt?: string; url: string }>;
}
export interface RunReportInput {
  id: string;
  applicationId?: string;
  environmentId?: string;
  environmentDisplayName?: string;
  startedAt?: string;
  finishedAt?: string;
  status?: string;
  exitCode?: number | null;
  /** A NAME, never an account or a secret. */
  executionProfileName?: string;
  sourceEnvironmentId?: string;
  results?: Array<{ testCaseId?: string; scenario?: string; executionStatus?: string; durationMs?: number; failureReason?: string }>;
  steps?: Record<string, RunReportStep[]>;
}

/** An embedded picture, or nothing. A missing file is never linked to. */
function embed(evidenceRoot: string, url: string): string | null {
  const marker = '/evidence/';
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const relative = decodeURIComponent(url.slice(at + marker.length));
  if (relative.includes('..') || path.isAbsolute(relative)) return null;
  const file = path.join(evidenceRoot, relative);
  if (path.relative(evidenceRoot, file).startsWith('..')) return null;
  try {
    const bytes = fs.readFileSync(file);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch { return null; }
}

const TIMING: Record<string, string> = {
  POST_STEP: 'Captured after the step completed',
  FAILURE: 'Captured on failure',
  PRE_STEP: 'Captured before the step ran',
};

export function renderRunReport(run: RunReportInput, evidenceRoot: string): string {
  const duration = run.startedAt && run.finishedAt
    ? `${((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000).toFixed(2)}s` : 'Not recorded';
  const cases = Object.keys(run.steps ?? {});
  const overall = run.results?.length
    ? (run.results.every(result => result.executionStatus === 'Passed') ? 'Passed' : 'Failed')
    : run.exitCode === 0 ? 'Passed' : 'Not recorded';
  const facts: Array<[string, string]> = [
    ['Application', safe(run.applicationId)],
    ['Environment', safe(run.environmentDisplayName || run.environmentId)],
    ['Source environment', safe(run.sourceEnvironmentId || 'Not recorded')],
    ['Execution profile', safe(run.executionProfileName || 'Not recorded')],
    ['Run', safe(run.id)],
    ['Started', safe(run.startedAt || 'Not recorded')],
    ['Finished', safe(run.finishedAt || 'Not recorded')],
    ['Duration', safe(duration)],
    ['Overall status', safe(overall)],
  ];
  const body = cases.map(testCaseId => {
    const steps = (run.steps?.[testCaseId] ?? []).slice().sort((a, b) => a.index - b.index);
    const outcome = run.results?.find(result => result.testCaseId === testCaseId);
    const attempts = [...new Set(steps.map(step => step.attemptId ?? 'unknown'))];
    const rows = steps.map(step => {
      const shot = (step.captures ?? []).slice()
        .sort((a, b) => ['POST_STEP', 'FAILURE', 'PRE_STEP'].indexOf(a.captureType)
          - ['POST_STEP', 'FAILURE', 'PRE_STEP'].indexOf(b.captureType))[0];
      const data = shot ? embed(evidenceRoot, shot.url) : null;
      const picture = data
        ? `<figure><img alt="${safe(`Step ${step.index}: ${step.title}`)}" src="${data}"><figcaption>${safe(TIMING[shot!.captureType] ?? shot!.captureType)}${shot!.capturedAt ? ` · ${safe(shot!.capturedAt)}` : ''}</figcaption></figure>`
        : `<p class="none">No screenshot retained${step.captureUnavailable ? ` — ${safe(step.captureUnavailable)}` : ''}.</p>`;
      return `<tr class="${step.status === 'failed' ? 'bad' : 'good'}">
  <td class="num">${safe(step.index)}</td>
  <td>${safe(step.title)}<small>${safe(step.diagnostic?.recordingStepKey ?? '')}</small></td>
  <td>${step.status === 'failed' ? '× ' : '✓ '}${safe(step.status)}</td>
  <td class="num">${safe((step.durationMs / 1000).toFixed(2))}s</td>
  <td>${picture}</td>
  <td>${step.error ? `<pre>${safe(step.error)}</pre>` : '<span class="none">—</span>'}</td>
</tr>`;
    }).join('\n');
    return `<section>
<h2>${safe(testCaseId)}</h2>
<p class="case-facts">${safe(outcome?.scenario ?? '')}</p>
<p class="case-facts">Status <strong>${safe(outcome?.executionStatus ?? 'Not recorded')}</strong> · Attempt(s) ${safe(attempts.join(', '))}${outcome?.failureReason ? ` · Failure: ${safe(outcome.failureReason)}` : ''}</p>
<table><thead><tr><th class="num">Step</th><th>Label</th><th>Status</th><th class="num">Duration</th><th>Evidence</th><th>Failure reason</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="6" class="none">No step records for this test case.</td></tr>'}
</tbody></table>
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>MoolyaAura execution report — ${safe(run.id)}</title>
<style>
:root{color-scheme:light}
body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;color:#111827;background:#f9fafb}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 6px}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:12px 0 0;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px}
dl.facts dt{font-weight:600}dl.facts dd{margin:0}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
th,td{border-bottom:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f3f4f6;font-weight:600}
td.num,th.num{text-align:right;white-space:nowrap}
tr.bad td{background:#fef2f2}tr.good td{background:#fff}
small{display:block;color:#6b7280;font-size:12px}
figure{margin:0}figure img{max-width:420px;width:100%;border:1px solid #d1d5db;border-radius:4px;display:block}
figcaption{color:#6b7280;font-size:12px;margin-top:4px}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px}
.none{color:#6b7280}
.case-facts{margin:2px 0}
footer{margin-top:28px;color:#6b7280;font-size:12px}
</style></head>
<body>
<h1>MoolyaAura execution report</h1>
<dl class="facts">${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${value}</dd>`).join('')}</dl>
${body || '<p class="none">This run recorded no steps.</p>'}
<footer>Credential profiles appear by name only. Secrets, account values and query strings are redacted; screenshots are masked at capture.</footer>
</body></html>
`;
}

/** Write the report into this run's own directory. Returns whether one now exists. */
export function writeRunReport(runDir: string, run: RunReportInput): boolean {
  try {
    const target = path.join(runDir, 'report');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'index.html'),
      renderRunReport(run, path.join(runDir, 'evidence')), 'utf8');
    return true;
  } catch { return false; }
}
