/**
 * `composeVideoPromptText` — the video twin of `assemble-image-input.ts`'s
 * `composePromptText`: fold cinematic-direction picker IDS into the prompt BODY,
 * server-side, at the model call.
 *
 * WHY THIS EXISTS: `/v1/generate-video` had no structured direction channel, so
 * every client baked the hint TEXT itself. A copied scene then carried stale
 * catalog wording forever, a re-generate double-baked it, and each client
 * re-implemented the fold with its own separator and its own order. The wire
 * now carries ids; the platform renders the clauses.
 *
 * WHERE IT RUNS (load-bearing): on the prompt BODY, BEFORE
 * `resolveVideoReferenceCore`. That resolver FRAMES the body — legacy prepends
 * its `Use these characters:` block, hybrid prepends the lock lines and APPENDS
 * the canonical role phrases and extras. Folding afterwards would push the
 * scene/look description PAST the identity directives, a worse version of the
 * bug this channel exists to fix. The image side is structurally identical
 * (`assembleImageInput` = `composePromptText` → `buildImagePrompt`).
 *
 * THE VERBOSITY POLICY LIVES HERE, NOT IN THE CLIENT: motion dimensions render
 * their compact professional term, look dimensions their full clause
 * (`VIDEO_HINT_MODE_DEFAULT`, resolved per row's `family` by the registry).
 * It is a threaded PARAMETER with a pure default — never deployment state:
 * `__tests__/content-free-contract.test.ts` hard-fails any environment read
 * under `packages/prompts/src`, and this module has nothing to read anyway.
 *
 * EXACT NO-OP CONTRACT: with no direction and no structured fields the caller's
 * `userPrompt` comes back VERBATIM AND UNTRIMMED — `undefined` included, since
 * a video prompt is optional on the route. That is what keeps every existing
 * caller byte-identical (the "backward-compatible: no connectedReferences →
 * prompt + flat refs pass through unchanged" oracle in
 * `backend/src/routes/__tests__/generate-video.test.ts`, restated locally in
 * `__tests__/assemble-video-input.test.ts`).
 *
 * WHAT IS DELIBERATELY NOT HERE: the dimension table, the fold order, the
 * dedupe and the surface filter all live in `direction-registry.ts` — ONE
 * renderer serves both surfaces, so the image and video folds cannot drift.
 * Clients render their "will inject into prompt" preview by importing
 * `renderDirectionHints` + `joinPromptHints` directly.
 */
import {
  renderDirectionHints,
  VIDEO_HINT_MODE_DEFAULT,
  type DirectionFields,
  type DirectionHintMode,
} from "./direction-registry.js"
import { joinPromptHints } from "./prompt-hint-join.js"
import {
  renderStructuredFields,
  type StructuredPromptFields,
} from "./prompt-builder-structured-fields.js"

/**
 * Fold a video run's cinematic-direction ids (and optional structured fields)
 * into its prompt body.
 *
 * The direction hints land first, in the registry's canonical table order
 * (camera motion leads), and the structured fragment lands LAST — the same
 * ordering `composePromptText` uses for stills.
 *
 * @param userPrompt The user's prompt. Optional: an image-to-video run may
 *   legitimately have none, and it is returned as-is when nothing folds.
 * @param direction Flat catalog ids. Unknown keys, off-surface keys (an
 *   image-only dimension sent to a video run) and unknown ids all contribute
 *   nothing — never a throw.
 * @param structured Path-1 structured fields. Not a `/v1/generate-video` wire
 *   field today; the canvas orchestrator passes it directly.
 * @param opts.hintMode Override the verbosity policy (a whole-fold
 *   `PickerHintMode`, or a `{ look, motion }` split).
 */
export function composeVideoPromptText(
  userPrompt: string | undefined,
  direction: DirectionFields | undefined,
  structured?: StructuredPromptFields,
  opts?: { readonly hintMode?: DirectionHintMode },
): string | undefined {
  const hints = [
    ...renderDirectionHints(direction, {
      surface: "video",
      mode: opts?.hintMode ?? VIDEO_HINT_MODE_DEFAULT,
    }),
    structured ? renderStructuredFields(structured) : "",
  ].filter((p) => p.length > 0)
  // Nothing to fold → the caller's value straight back, `undefined` included.
  // Do NOT collapse this into `joinPromptHints(userPrompt ?? "", hints)`: that
  // would turn an absent prompt into `""` and break the no-op contract above.
  if (hints.length === 0) return userPrompt
  return joinPromptHints(userPrompt ?? "", hints)
}
