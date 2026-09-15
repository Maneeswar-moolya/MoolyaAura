/** Retention boundary for verification attempts. Raw scratch data is never served. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { diagnosticData, diagnosticText, diagnosticRoot, writeDiagnostic } from './artifacts';
import type { ApplicationScope } from '../projects/scope';
import { LOCATOR_TIMEOUT_MS } from '../../tests-e2e/support/locator-policy';
import type { ExecutionContext } from '../projects/execution-context';

/**
 * The generated step list, joined to WHAT HAPPENED to each step.
 *
 * `generated-steps.json` is a static read of the spec: labels, keys and line ranges. On
 * its own it describes a test nobody ran, and the manifest carried exactly that - a step
 * list with no status, no duration and no picture - so reconstructing
 * run -> test case -> step -> screenshot from the manifest was impossible and anything
 * downstream had to go looking for files by name. The executed record is written beside it
 * by the step recorder, keyed by the same `recordingStepKey`, so the join is by identity
 * and never by ordinal or filename.
 *
 * A step the run never reached keeps its generated entry and gains nothing: absent is the
 * honest answer for a step that did not execute.
 */
function executedSteps(scratch: string): unknown[] {
  const generated = JSON.parse(fs.readFileSync(path.join(scratch,'generated-steps.json'),'utf8')).steps as any[];
  const executed = new Map<string, any>();
  const stepsDir = path.join(scratch,'steps');
  if (fs.existsSync(stepsDir)) for (const name of fs.readdirSync(stepsDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      for (const step of JSON.parse(fs.readFileSync(path.join(stepsDir,name),'utf8')).steps ?? []) {
        const key = step?.diagnostic?.recordingStepKey;
        if (typeof key === 'string' && !executed.has(key)) executed.set(key,step);
      }
    } catch { /* An unreadable step log leaves the generated list as it stands. */ }
  }
  return generated.map(step => {
    const ran = executed.get(step?.recordingStepKey);
    return ran ? { ...step, result: ran.status, durationMs: ran.durationMs,
      attemptId: ran.attemptId, attemptNumber: ran.attemptNumber,
      captures: ran.captures ?? [], ...(ran.error ? { error: ran.error } : {}),
      ...(ran.captureTiming ? { captureTiming: ran.captureTiming } : {}),
      ...(ran.captureUnavailable ? { captureUnavailable: ran.captureUnavailable } : {}) } : step;
  });
}

export function retainAttempt(scope: ApplicationScope, scratch: string, spec: string, testCaseId: string,
    kind: 'clean'|'mutation', stdout: string, stderr: string, runId?: string, executedSource?:string, executionContext?:ExecutionContext): string {
  const attemptId = randomUUID(), folder = path.join(diagnosticRoot(scope),'runs',attemptId);
  fs.mkdirSync(folder,{recursive:true});
  const artifacts: string[] = [];
  const unavailable:string[]=[];
  const attachmentReferences=(value:any):void=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value.attachments))value.attachments=value.attachments.flatMap((attachment:any)=>{
      if(typeof attachment.path!=='string')return [];
      const relative=path.relative(scratch,attachment.path).replace(/\\/g,'/');
      if(relative.startsWith('..')||path.isAbsolute(relative)||!/^aura-[a-f0-9-]+\.png$/.test(path.basename(relative)))return [];
      return [{name:diagnosticText(attachment.name),contentType:'image/png',path:relative}];
    });
    for(const child of Object.values(value))if(typeof child==='object')Array.isArray(child)?child.forEach(attachmentReferences):attachmentReferences(child);
  };
  const copy = (directory: string) => {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const source = path.join(directory,entry.name), relative = path.relative(scratch,source).replace(/\\/g,'/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { copy(source); continue; }
      // Only masked framework captures may cross the retention boundary. Native trace,
      // video and screenshots may contain typed credentials and require separate sanitization.
      if (!/\.json$/.test(entry.name) && !/^aura-[a-f0-9-]+\.png$/.test(entry.name) && entry.name!=='trace.zip') continue;
      const destination = path.join(folder,relative);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      if (entry.name.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(source,'utf8'));
          attachmentReferences(data);
          if(entry.name==='executed-dependencies.json')for(const [file,text]of Object.entries(data.files??{})){
            if(typeof text!=='string'||diagnosticText(text)!==text){delete data.files[file];unavailable.push('A dependency source required redaction and was not retained as an exact source snapshot.');}
          }
          // Attachment paths must refer to retained artifacts, not deleted scratch files.
          writeDiagnostic(destination,diagnosticData(data));
        } catch { continue; }
      } else if(entry.name==='trace.zip') {
        const sanitized=spawnSync(process.execPath,[require.resolve('tsx/cli'),path.join(__dirname,'trace.ts'),source,destination],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:30_000,windowsHide:true});
        if(sanitized.status!==0){if(fs.existsSync(destination))fs.unlinkSync(destination);unavailable.push('Trace sanitization failed; raw trace was not retained.');continue;}
      } else fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
      artifacts.push(relative);
    }
  };
  copy(scratch);
  const source = executedSource??fs.readFileSync(spec,'utf8');
  // Generated specs must already be redacted. Retained originals are exact bytes.
  fs.writeFileSync(path.join(folder,'executed.spec.ts.txt'),source,{flag:'wx'});
  fs.writeFileSync(path.join(folder,'stdout.txt'),diagnosticText(stdout),{flag:'wx'});
  fs.writeFileSync(path.join(folder,'stderr.txt'),diagnosticText(stderr),{flag:'wx'});
  writeDiagnostic(path.join(folder,'manifest.json'),{schemaVersion:1,applicationId:scope.applicationId,
    environmentId:scope.environmentId,testCaseId,runId,attemptId,kind,createdAt:new Date().toISOString(),locatorTimeoutMs:LOCATOR_TIMEOUT_MS,
    executionContext,sourceEnvironmentId:executionContext?.sourceEnvironmentId,
    generatedFile:path.relative(process.cwd(),spec).replace(/\\/g,'/'),steps:executedSteps(scratch),artifacts,
    trace:artifacts.find(file=>file.endsWith('/trace.zip'))??null,
    tracePolicy:'Sanitized action timeline. Native DOM snapshots, response bodies, video and unmasked screenshots are excluded.',unavailable});
  return path.relative(diagnosticRoot(scope),folder).replace(/\\/g,'/');
}
