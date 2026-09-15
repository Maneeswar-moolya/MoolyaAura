/** Diagnostic artifacts describe observations; they never confer locator or ownership proof. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { artefactRoot, type ApplicationScope } from '../projects/scope';
import { readRegistry } from '../projects/registry';
import { credentialSecrets } from '../test-data/secrets';

export type CaptureType = 'BEFORE_ACTION' | 'AFTER_ACTION' | 'ASSERTION_STATE' | 'PRE_STEP' | 'POST_STEP' | 'FAILURE';
export interface DiagnosticCapture {
  captureRef: string;
  captureType: CaptureType;
  recordingStepKey: string;
  capturedAt: string;
  route: string;
  artifact: string;
  documentId?: string;
  trigger?: 'PRE_INTERACTION_BUFFER';
}
/**
 * Could recording-time pictures be attributed to the steps they describe?
 *
 * Pairing is all-or-nothing on purpose: a picture reaches a step because the observed
 * stream and the recorded stream are the same stream, never because a name or a file
 * looked right. What was missing is the ANSWER when they are not - a reader saw
 * "no screenshot was captured for this step" and had no way to tell that apart from
 * screenshots that were taken and could not be placed. Counted, so the difference is
 * a fact rather than an impression.
 */
export interface CaptureAttribution {
  /** True when every picture carries the step key of the step it describes. */
  paired: boolean;
  /** Pictures taken during the recording, whether or not they reached a step. */
  observed: number;
  /** Pictures that reached a step. Equal to `observed` only when `paired`. */
  attributed: number;
  observedActions: number;
  recordedActions: number;
  observedAssertions: number;
  recordedAssertions: number;
}
export interface DiagnosticStep {
  recordingStepKey: string;
  label: string;
  generatedFile?: string;
  generatedLineStart?: number;
  generatedLineEnd?: number;
  statement?: string;
  page?: string;
  pageObject?: string;
  method?: string;
  locator?: string;
  executionMode?: string;
  provenance?: string;
  validationStatus?: string;
  result?: string;
  error?: string;
  captures?: DiagnosticCapture[];
}

/** Variable names come from the existing registry, never from an application's URL. */
function secretValues(): string[] {
  const names = new Set(Object.keys(process.env).filter(name => /(?:PASSWORD|TOKEN|SECRET|API_KEY|EMAIL|USERNAME)/i.test(name)));
  try {
    for (const app of readRegistry().applications) for (const environment of Object.values(app.environments))
      for (const name of Object.values(environment.credentials ?? {})) if (name) names.add(name);
  } catch { /* Empty dashboard/configuration errors must remain diagnosable. */ }
  return [...credentialSecrets(), ...[...names].map(name => process.env[name]).filter((value): value is string => !!value && value.length >= 3)]
    .sort((a,b) => b.length-a.length);
}
export function diagnosticText(input: unknown): string {
  let text = String(input ?? '');
  for (const value of secretValues()) for (const variant of [value, encodeURIComponent(value), JSON.stringify(value).slice(1,-1)])
    text = text.split(variant).join('[REDACTED]');
  return text.replace(/https?:\/\/[^\s<>"'`]+/gi, value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return '[URL REDACTED]'; }
  }).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi,'[AUTHORIZATION REDACTED]')
    .replace(/(["']?(?:password|secret|token|SAMLResponse|saml_request_id|OCIS_REQ|cookie|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1[REDACTED]');
}
export function diagnosticData<T>(input: T): T {
  const visit = (value: any, key = ''): any => {
    if (/^(?:password|secret|token|cookie|cookies|authorization|headers|postData|storageState|value)$/i.test(key)) return '[REDACTED]';
    if (typeof value === 'string') return diagnosticText(value);
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name,item]) => [name,visit(item,name)]));
    return value;
  };
  return visit(input);
}
export function diagnosticRoute(value: string): string {
  try { return diagnosticText(new URL(value).pathname); } catch { return ''; }
}
export function diagnosticRoot(scope: ApplicationScope): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(scope.applicationId)) throw Error('Invalid diagnostic application scope.');
  return path.join(artefactRoot(),'ai','diagnostics','artifacts',scope.applicationId);
}
export function containedFile(root: string, reference: string): string {
  const file = path.resolve(root,reference), relative = path.relative(path.resolve(root),file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Diagnostic artifact is outside this application.');
  let cursor = file;
  while (cursor !== path.dirname(cursor)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('Diagnostic symlinks are not permitted.');
    if (cursor === path.resolve(root)) break;
    cursor = path.dirname(cursor);
  }
  return file;
}
export function writeDiagnostic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary,JSON.stringify(diagnosticData(data),null,2)+'\n',{flag:'wx'}); fs.renameSync(temporary,file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
/** No title, URL, account or typed value enters the filename. Inputs are masked at capture. */
export async function captureDiagnostic(page: Page, directory: string, recordingStepKey: string, captureType: CaptureType, documentId?: string): Promise<DiagnosticCapture | undefined> {
  if (page.isClosed()) return undefined;
  const captureRef = randomUUID(), artifact = `aura-${captureRef}.png`;
  try {
    fs.mkdirSync(directory,{recursive:true});
    const values=secretValues();
    const mask = page.frames().flatMap(frame=>[frame.locator('input, textarea, [contenteditable], [data-sensitive]'),
      ...values.map(value => frame.getByText(value,{exact:false}))]);
    await page.screenshot({path:path.join(directory,artifact),mask,timeout:1500});
    return {captureRef,captureType,recordingStepKey,capturedAt:new Date().toISOString(),route:diagnosticRoute(page.url()),artifact,documentId};
  } catch { return undefined; } // Observational failure cannot alter the recorded/runtime action.
}
