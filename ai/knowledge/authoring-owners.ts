/** Human ownership guidance, bound to an application's immutable recording bytes.
 * This module never supplies locator measurements or promotes capabilities. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ApplicationScope } from '../projects/scope';
import type { Recording } from '../dashboard/recorder';
import type { PageKnowledge } from './page-knowledge';

export interface AuthoringPage { name: string; route: string; description: string }
/**
 * WHAT DECIDED THIS STEP, and whether that decision can actually execute.
 *
 * `USER_CONFIRMED` used to mean "a Page Object is associated with this step", which is not
 * the same thing as "the user chose how to run it". Page/Page Object context INHERITS down a
 * screen - correctly, since the next control is usually on the same screen - and the method
 * is cleared as it inherits, because the method that finds the email box must never silently
 * become the method that finds the password box. What was wrong is what the inherited,
 * method-less context was then called: USER_CONFIRMED, with `explicit: false`, an execution
 * mode of AUTO and no method. Generation reasonably found no binding there, fell to AUTO, and
 * refused for missing interaction-time evidence - reporting an evidence problem for a step
 * whose real problem was that nobody had ever chosen how to run it.
 *
 * So there are three states, and the middle one is new:
 *
 *   AUTO                      nothing is associated; automatic inference decides, under the
 *                             full evidence gate, which is unchanged.
 *   USER_BINDING_INCOMPLETE   a Page/Page Object is associated but no executable mode was
 *                             chosen. Not a completed mapping, and never treated as one.
 *   USER_CONFIRMED            resolves to exactly one executable mode: PAGE_OBJECT_METHOD
 *                             with a method, or RECORDED_LOCATOR.
 */
export type OwnerProvenance = 'AUTO' | 'USER_BINDING_INCOMPLETE' | 'USER_CONFIRMED';
export interface OwnerChoice {
  key: string; recommended: string | null; confirmed: string | null;
  route: string | null; explicit: boolean;
  provenance?: OwnerProvenance;
  userSelection?: import('../dashboard/authoring-catalog').AuthoringBinding | null;
  frameworkRecommendation?: { pageObject: string | null };
}
/**
 * Can this binding actually run? The one definition, so the review, the save and generation
 * cannot disagree about what a completed mapping is.
 *
 * A binding is executable when it names a method to call under PAGE_OBJECT_METHOD, or when it
 * elects RECORDED_LOCATOR. Page and Page Object alone are context, never execution.
 */
export function executableBinding(
  binding: import('../dashboard/authoring-catalog').AuthoringBinding | null | undefined,
): false | 'PAGE_OBJECT_METHOD' | 'RECORDED_LOCATOR' {
  if (!binding) return false;
  if (binding.executionMode === 'RECORDED_LOCATOR') return 'RECORDED_LOCATOR';
  if (binding.method) return 'PAGE_OBJECT_METHOD';
  return false;
}
export interface AuthoringOwners {
  version: 1; applicationId: string; recordingHash: string; choices: OwnerChoice[];
  pages: AuthoringPage[];
  /**
   * The STEP STREAM these choices were made against, not just the source they came from.
   *
   * `recordingHash` says which script this is. That was enough while one script could only
   * ever parse one way. It is not: a parser correction can read the same bytes and find an
   * action the previous one dropped, and every `action:<n>` after it then means a different
   * step. A sidecar carrying `SsoauthLoginPage.logInButton` at `action:5` would quietly
   * re-attach it to the password field - the exact "wrong control bound" failure the rest
   * of this subsystem exists to prevent, arriving with no error at all.
   *
   * Optional and additive. A sidecar written before this field reads as UNKNOWN, never as
   * "still current": nothing here infers a revision from a hash, a count or a date.
   */
  revision?: string;
}
export const hashContent = (text: string) => createHash('sha256').update(text).digest('hex');
export function atomicText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, text, { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function ownersPath(recordingFile: string): string { return recordingFile.replace(/\.spec\.ts$/, '.owners.json'); }
export function loadOwners(scope: ApplicationScope, recordingFile: string, source: string,
    /** The step stream the caller is about to apply these choices to, where it knows one. */
    revision?: string): AuthoringOwners | undefined {
  const file = ownersPath(recordingFile);
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as AuthoringOwners;
  if (value.version !== 1 || value.applicationId !== scope.applicationId || value.recordingHash !== hashContent(source))
    throw Error('Page ownership metadata does not belong to this application and recording revision. Review ownership again.');
  // Both sides have to KNOW their stream for this to mean anything. A sidecar written before
  // the field, or a caller that has no recording in hand, is unknown - and unknown is left
  // exactly as it was rather than being failed or being trusted.
  if (value.revision && revision && value.revision !== revision)
    throw Error('Page ownership metadata was written against a different recorded step stream. '
      + 'Review each step again before saving; nothing was changed.');
  return value;
}
export function confirmedOwner(recording: Recording, key: string): string | undefined {
  const choice = recording.authoringOwners?.choices.find(row => row.key === key);
  return choice?.userSelection?.pageObject || choice?.confirmed || undefined;
}
export function guidedKnowledge(recording: Recording, key: string, knowledge: PageKnowledge[]): PageKnowledge[] {
  const owner = confirmedOwner(recording, key);
  if (!owner) return knowledge;
  // Narrow declarations only. The caller still performs all runtime identity checks.
  return knowledge.map(page => ({ ...page, elements: page.elements.filter(element => element.page_object === owner) }));
}

export function declaredAuthoringPage(scope: ApplicationScope, testCaseId: string, owner: string, route: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(testCaseId)) return false;
  for (const dir of [scope.paths.recordingsDir, path.join(scope.paths.recordingsDir, 'accepted')]) {
    const file = path.join(dir, `${testCaseId}.spec.ts`);
    if (!fs.existsSync(file)) continue;
    const metadata = loadOwners(scope, file, fs.readFileSync(file, 'utf8'));
    return Boolean(metadata?.pages.some(page => page.name === owner && page.route === route)
      && metadata.choices.some(choice => choice.confirmed === owner && choice.route === route));
  }
  return false;
}
/** All contents are validated before this commit. Restore bytes if a rename fails. */
export function commitTexts(changes: Map<string, string>, verify?: () => void): void {
  const before = new Map([...changes.keys()].map(file => [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null]));
  const committed: string[] = [];
  try { for (const [file, text] of changes) { atomicText(file, text); committed.push(file); } verify?.(); }
  catch (error) { for (const file of committed.reverse()) { const original = before.get(file); if (original === null) fs.unlinkSync(file); else atomicText(file, original!); } throw error; }
}
