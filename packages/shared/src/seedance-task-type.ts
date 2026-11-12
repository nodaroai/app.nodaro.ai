/**
 * Seedance 2.5 reference task type — what a request's reference media is FOR.
 *
 * The provider takes an optional declaration of the job a run's references do:
 *   - `reference` — the media guides a new clip (look, subject, motion);
 *   - `edit`      — the clip is an edit of the reference video, in its own shape
 *                   and length;
 *   - `extend`    — the clip continues the reference video.
 * Without one the provider guesses from the prompt. `auto` is the platform's
 * spelling of "declare nothing": the provider keeps guessing.
 *
 * Which models take the declaration is a catalog capability
 * (`MODEL_CATALOG[id].referenceTaskTypes`), read through
 * `supportsReferenceTaskType`; whether a given request declares one, and the
 * aspect ratio and length that forces, is decided in one place by
 * `resolveSeedanceTaskType` (both in `model-constants.ts`). Never hand-list the
 * model.
 *
 * Import-free on purpose: the catalog (`model-catalog.ts`) and the constants
 * module (`model-constants.ts`, which imports the catalog) both read it. The
 * resolver itself lives in `model-constants.ts` because it needs
 * `videoDefaultDurationSec` from there.
 */

/** Every value a request may carry, `auto` (declare nothing) first. */
export const SEEDANCE_REFERENCE_TASK_TYPES = ["auto", "reference", "edit", "extend"] as const
export type SeedanceReferenceTaskType = typeof SEEDANCE_REFERENCE_TASK_TYPES[number]

/** A value that is actually sent to the provider. */
export type DeclaredSeedanceTaskType = Exclude<SeedanceReferenceTaskType, "auto">

/**
 * The reference-video length (seconds, inclusive) an `edit` declaration
 * accepts. Every reference video must be measured and inside it; otherwise
 * nothing is declared.
 */
export const SEEDANCE_EDIT_REF_VIDEO_SEC = { min: 4, max: 30 } as const
