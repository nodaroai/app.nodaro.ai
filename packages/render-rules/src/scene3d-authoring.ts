/**
 * Generate 3D Scene's authoring rules that the server and the editor both
 * apply: how long its brief may be, and the `validation.warnings[]` codes its
 * plan check (`backend/src/services/scene3d/scene3d-plan-check.ts`) publishes
 * on a delivered scene — here so the editor reads them by the same string the
 * server writes.
 */

/**
 * The longest brief (`prompt` on the API, `scenePrompt` on the canvas) a
 * scene is authored from, in characters, after trimming. The route refuses a
 * longer one before any reservation; both engines refuse a node whose brief
 * comes out longer (typed text with its wired text appended) before running it.
 */
export const SCENE3D_BRIEF_MAX_CHARS = 8000

/** A group carries motion but nothing is parented to it (or its parts are named after it and left loose). Blocking: never delivered. */
export const SCENE3D_PARTS_DETACHED_CODE = "SCENE_PARTS_DETACHED"

/** A camera shot whose sampled frames show no subject, only scenery or nothing. Advisory: delivered with this warning once the revisions are spent. */
export const SCENE3D_SHOT_WITHOUT_SUBJECT_CODE = "SCENE_SHOT_WITHOUT_SUBJECT"
