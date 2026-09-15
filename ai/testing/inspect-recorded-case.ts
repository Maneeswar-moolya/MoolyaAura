/** Read-only mapping validation. Does not generate specs or change case artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import { pinActiveScope } from '../projects/scope';
import { parseRecording } from '../dashboard/recorder';
import { readEvidence, readAssertions, mapRecording } from '../autocode/from-recording';
import { loadOwners } from '../knowledge/authoring-owners';
const [applicationId, testCaseId] = process.argv.slice(2);
if (!applicationId || !/^[A-Za-z0-9_-]+$/.test(testCaseId ?? '')) throw Error('Provide applicationId and testCaseId.');
const scope = pinActiveScope({ applicationId });
const file = path.join(scope.paths.recordingsDir, testCaseId + '.spec.ts'), source = fs.readFileSync(file, 'utf8');
const recording = parseRecording(source, { startUrl: '', browser: '', durationMs: 0, evidence: readEvidence(testCaseId), stateAssertions: readAssertions(testCaseId) });
recording.authoringOwners = loadOwners(scope, file, source);
const mapping = mapRecording(recording);
console.log(JSON.stringify({ applicationId, testCaseId, actions: recording.actions.length, assertions: recording.assertions.length,
  confirmedBindings: recording.authoringOwners?.choices.filter(choice => choice.confirmed || choice.userSelection).length ?? 0,
  reused: mapping.reused, needsReview: mapping.needsReview.map(step => ({ failure: step.failure ?? 'locatorReview', kind: step.kind })),
  unresolved: mapping.unresolved.map(step => ({ failure: step.failure ?? 'unresolved', kind: step.kind, reason: step.why })),
  // Credential calls reference configuration; never print the recording's fill values or URLs.
  authenticationCalls: mapping.steps.filter(step => step.why.startsWith('authentication composed from scoped controls:') || step.kind === 'authenticate').flatMap(step => step.code),
  validation: 'read-only mapping; no live clean or assertion-mutated execution' }, null, 2));
if (mapping.needsReview.length || mapping.unresolved.length) process.exitCode = 2;
