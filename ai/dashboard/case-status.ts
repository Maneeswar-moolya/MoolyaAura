/**
 * Does the recording still show what the row says?
 *
 * A recording is evidence: a person did those steps, with that data, on that
 * screen, as that user. Editing the row's business wording does not change what
 * they did - but editing the STEPS does, and reassembling a spec from a
 * recording that no longer matches the row is how a test comes to assert
 * something nobody asked for while looking perfectly green.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It never touches `.spec.ts` or `.evidence.json`. Not to move them, not to
 * rename them, not to mark them. They are the evidence; a bookkeeping file
 * beside them records what the row said WHEN they were saved, and comparing the
 * two is the whole mechanism. Nothing in the recorder or the recorded pipeline
 * is modified, and a recording made before this existed has no sidecar - which
 * reads as "unknown", never as "stale", because an absent record is not a
 * finding.
 */

import fs from 'node:fs';
import path from 'node:path';

import { recordingFingerprint } from '../autocode/work';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();
export const RECORDINGS_DIR = path.resolve(ROOT, 'ai', 'dashboard', 'recordings');

/** The bookkeeping file. Never the recording itself. */
export function authoringSidecarPath(testCaseId: string, dir = RECORDINGS_DIR): string {
  return path.join(dir, `${testCaseId}.authoring.json`);
}

export function recordingArtifactPath(testCaseId: string, dir = RECORDINGS_DIR): string {
  return path.join(dir, `${testCaseId}.spec.ts`);
}

export function evidenceArtifactPath(testCaseId: string, dir = RECORDINGS_DIR): string {
  return path.join(dir, `${testCaseId}.evidence.json`);
}

export interface RecordingStatus {
  /** A recording artifact exists for this case. */
  exists: boolean;
  /** DOM evidence was captured alongside it. */
  hasEvidence: boolean;
  /**
   * The authored row has changed in a way the recording cannot still be
   * evidence for. `undefined` when there is nothing to compare against - a
   * recording saved before this bookkeeping existed.
   */
  stale?: boolean;
  /** What the row said when the recording was saved, for the report. */
  recordedFingerprint?: string;
  /** What it says now. */
  currentFingerprint: string;
  recordedAt?: string;
}

/**
 * Compare the row against the recording that was saved for it.
 *
 * Pure apart from two `readFileSync`s. Returns `exists: false` for every case
 * nobody recorded, which is most of them.
 */
export function recordingStatus(testCase: TestCase, dir = RECORDINGS_DIR): RecordingStatus {
  const current = recordingFingerprint(testCase);
  const exists = fs.existsSync(recordingArtifactPath(testCase.testCaseId, dir));
  const status: RecordingStatus = {
    exists,
    hasEvidence: exists && fs.existsSync(evidenceArtifactPath(testCase.testCaseId, dir)),
    currentFingerprint: current,
  };
  if (!exists)
    return status;

  try {
    const sidecar = JSON.parse(fs.readFileSync(authoringSidecarPath(testCase.testCaseId, dir), 'utf8')) as {
      recordingFingerprint?: string; at?: string;
    };
    if (typeof sidecar.recordingFingerprint === 'string' && sidecar.recordingFingerprint) {
      status.recordedFingerprint = sidecar.recordingFingerprint;
      status.recordedAt = sidecar.at;
      status.stale = sidecar.recordingFingerprint !== current;
    }
  } catch {
    // No sidecar, or an unreadable one. Unknown, and unknown is not stale: a
    // recording made before P1 must not start demanding to be re-made.
  }
  return status;
}

/**
 * Record what the row said at the moment a recording was kept for it.
 *
 * Called by the save path immediately after the artifact is retained, so the
 * next edit has something to compare against. Failure is swallowed: losing this
 * file costs a staleness check, and must never cost somebody their recording.
 */
export function rememberRecordingFingerprint(testCase: TestCase, dir = RECORDINGS_DIR): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(authoringSidecarPath(testCase.testCaseId, dir),
        `${JSON.stringify({
          testCaseId: testCase.testCaseId,
          recordingFingerprint: recordingFingerprint(testCase),
          at: new Date().toISOString(),
        }, null, 2)}\n`, 'utf8');
  } catch {
    // Deliberately silent - see above.
  }
}

/** Human-readable, for the System Information panel. */
export function describeRecording(status: RecordingStatus): string {
  if (!status.exists)
    return 'No recording - this case is authored in plain English.';
  if (status.stale === true) {
    return 'The recording no longer matches this row. Re-record it, or undo the edit to the steps; '
      + 'the old recording is never reused after an incompatible change.';
  }
  if (status.stale === false)
    return 'Recording matches the authored row.';
  return 'Recording present. It predates change tracking, so whether it still matches is unknown.';
}
