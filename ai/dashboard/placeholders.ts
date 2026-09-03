/**
 * The literal wordings the recorder writes when it has nothing to state.
 *
 * They live in their own module for one reason: two very different places need the
 * SAME string. `recorder.ts` writes them into a draft; `ai/knowledge/requirements.ts`
 * has to recognise them so they never become requirements about a screen. A second
 * copy of the text in the classifier would drift the first time the wording changed,
 * and the failure would be silent - "Needs confirmation" would quietly go back to
 * meaning `needs` and `confirmation` are two things to look at.
 *
 * They cannot be imported from `recorder.ts` directly: that module loads `.env` at
 * import time (for the credential redaction guard), and pulling dotenv into the
 * knowledge layer - and therefore into `npm run excel:index` - is a side effect the
 * classifier has no business causing. So the constants sit here, with no imports at
 * all, and `recorder.ts` re-exports them to keep its own public API unchanged.
 */

/** Expected Result for a recording that contained no assertion. Never a guess. */
export const NEEDS_CONFIRMATION = 'Needs confirmation';

/** Scenario title for a recording with no click and no filled field to name. */
export const RECORDED_INTERACTION = 'Recorded interaction';

/**
 * Every placeholder wording, for the classifier to match against.
 *
 * Matched case-insensitively and as a whole trimmed clause. Deliberately not a
 * substring test: a person may legitimately edit the Expected Result to "Needs
 * confirmation from the product owner that the toast is correct", and the words they
 * added are real requirements.
 */
export const PLACEHOLDER_TEXTS = [NEEDS_CONFIRMATION, RECORDED_INTERACTION];
