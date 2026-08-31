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
 * That ordering is also why cap-aware shedding here takes a `frame` callback
 * rather than a provider id: the shed must run at the FOLD site (before the
 * resolver) but be decided on the RESOLVED length (after it), so the binding
 * text the resolver adds is inside the budget and can never be the thing that
 * gets dropped. See {@link VideoPromptCapOptions}. Both catalog channels —
 * SUBJECT and direction — fold into the one sheddable list that budget walks.
 *
 * THE VERBOSITY POLICY LIVES HERE, NOT IN THE CLIENT: motion dimensions render
 * their compact professional term, look dimensions their full clause
 * (`VIDEO_HINT_MODE_DEFAULT`, resolved per row's `family` by the registry). The
 * SUBJECT fold has its own policy — compact on video
 * (`SUBJECT_VIDEO_HINT_MODE_DEFAULT`), because a fully specified person at full
 * verbosity is ~30 paragraph clauses and the start frame already carries the
 * subject's identity into the clip.
 * It is a threaded PARAMETER with a pure default — never deployment state:
 * `__tests__/content-free-contract.test.ts` hard-fails any environment read
 * under `packages/prompts/src`, and this module has nothing to read anyway.
 *
 * EXACT NO-OP CONTRACT: with no subject, no direction and no structured fields
 * the caller's
 * `userPrompt` comes back VERBATIM AND UNTRIMMED — `undefined` included, since
 * a video prompt is optional on the route. That is what keeps every existing
 * caller byte-identical (the "backward-compatible: no connectedReferences →
 * prompt + flat refs pass through unchanged" oracle in
 * `backend/src/routes/__tests__/generate-video.test.ts`, restated locally in
 * `__tests__/assemble-video-input.test.ts`).
 *
 * WHAT IS DELIBERATELY NOT HERE: the dimension table, the fold order, the
 * dedupe and the surface filter all live in `direction-registry.ts` (and
 * `subject-registry.ts` for the subject channel) — ONE renderer per channel
 * serves both surfaces, so the image and video folds cannot drift.
 * Clients render their "will inject into prompt" preview by importing
 * `renderDirectionHints` + `joinPromptHints` directly.
 */
import {
  renderDirectionHints,
  VIDEO_HINT_MODE_DEFAULT,
  type DirectionFields,
  type DirectionHintMode,
} from "./direction-registry.js"
import {
  renderSubjectHints,
  SUBJECT_VIDEO_HINT_MODE_DEFAULT,
  type SubjectFields,
  type SubjectHintMode,
} from "./subject-registry.js"
import { joinPromptHints } from "./prompt-hint-join.js"
import { keepableDirectionHints } from "./hint-shedding.js"
import {
  renderStructuredFields,
  type StructuredPromptFields,
} from "./prompt-builder-structured-fields.js"

/**
 * Cap-aware shedding, opt-in. Absent → the composer is exactly what it always
 * was (every existing caller stays byte-identical, and the no-op path below is
 * never even reached differently).
 *
 * WHY A NUMBER AND A CALLBACK, NOT A PROVIDER ID — the two halves of the video
 * surface's problem, which the image half did not have:
 *
 *  - `cap` is the caller's EFFECTIVE ceiling, not `getMaxVideoPromptChars` read
 *    here. The routes compute it with `effectiveVideoPromptCeiling`, which
 *    mirrors `applyVideoNegativePrompt`'s reservation of the `"\nAvoid: …"`
 *    suffix for a provider with no native negative param. Re-deriving the cap
 *    inside this package would put a second copy of that reservation one
 *    refactor away from drifting from the clamp it is supposed to predict.
 *
 *  - `frame` is the REFERENCE RESOLVER, and it is what makes the shed correct
 *    end-to-end. The fold runs BEFORE `resolveVideoReferenceCore` (see the
 *    module header — folding afterwards strands the scene description past the
 *    identity directives). The resolver then ADDS binding text: legacy's
 *    "Use these characters:" block, hybrid's lock lines and the canonical role
 *    phrases it APPENDS. That added text is exactly what an order-blind tail cut
 *    destroys first, so it must be inside the budget — but it must never be
 *    shed. Measuring THROUGH the caller's framing gives both properties at once:
 *    the shed decision sees the final length, while the only thing it can drop
 *    is a hint clause it rendered itself.
 *
 * Re-framing a SUBSET of the hints is sound because a hint can never change how
 * the resolver reads the rest of the body: no registered catalog hint, term or
 * label contains a `{image:N}` / `{ref:` / `@slug:N` shape
 * (`__tests__/direction-hint-token-safety.test.ts` pins that for every catalog),
 * so dropping one cannot renumber or unbind a reference.
 */
export interface VideoPromptCapOptions {
  /**
   * The maximum length the FRAMED prompt may reach. Sheds only while the framed
   * body exceeds it; `undefined` (the default) disables shedding entirely.
   */
  readonly cap?: number
  /**
   * The downstream framing the cap is measured through — the caller's reference
   * assembly. Identity when omitted (a caller with a cap but no references).
   * Must be PURE: it is called once per shed iteration, and the caller re-runs
   * its own real assembly on the returned body afterwards.
   */
  readonly frame?: (body: string | undefined) => string | undefined
}

/**
 * Fold a video run's subject and cinematic-direction ids (and optional
 * structured fields) into its prompt body.
 *
 * The SUBJECT hints land first (who is in the shot — the noun phrase the
 * cinematography modifies), then the direction hints in the registry's
 * canonical table order (camera motion leads), and the structured fragment
 * lands LAST — the same ordering `composePromptText` uses for stills.
 *
 * `subject` rides `opts` rather than a fourth positional parameter on purpose:
 * every existing caller passes `(prompt, direction)` or
 * `(prompt, direction, structured)` positionally, and a new positional would
 * have made the two levers' order a memorization test.
 *
 * TRUNCATION ORDERING (opt-in via `opts.cap`): the provider clamp
 * (`applyVideoNegativePrompt`) slices the prompt TAIL, which is ORDER-BLIND —
 * on a low-cap provider (kling = 1000) a broad direction renders more than the
 * whole ceiling and the cut severs reference bindings and the end of the user's
 * prose while decorative clauses survive. With a cap the composer decides
 * instead: it knows which clauses are hints because it just rendered them, and
 * drops them LAST-FOLDED FIRST until the framed prompt fits. Everything else —
 * the user's prose, the structured fragment (user CONTENT, never a garnish) and
 * every byte the resolver's framing adds — outranks a hint.
 *
 * SUBJECT CLAUSES ARE SHED CANDIDATES TOO, and they shed AFTER the direction
 * clauses. Both folds are catalog decoration of the same class — ids the
 * platform rendered into wording — so exempting one would just move the
 * overflow into the order-blind clamp, which is the bug this machinery exists
 * to prevent. They ride the SAME `hintClauses` list the shed already walks
 * (subject first, direction second, tail-first shedding), so there is exactly
 * one shed arithmetic (`hint-shedding.ts`) across both channels and both
 * surfaces. Neither channel ever sheds before the prose, the references or the
 * structured fragment.
 *
 * WHAT THE BUDGET DELIBERATELY EXCLUDES: the route's later opt-in identity
 * injection (an async DB read that appends a canonical description) and any
 * registered `applyPromptPolicies` transform both run AFTER the reference
 * assembly and are not modelled here. Pricing them in would mean folding an
 * await into this pure composer; instead the provider clamp stays their last
 * resort, exactly as today. Same for a body that still overflows with ZERO
 * hints left — long prose, or many bound references on their own.
 *
 * UNDER-CAP PARITY: the first pass folds every hint, so a prompt that fits is
 * byte-identical to a capless call, and a caller with no
 * `subject`/`direction`/`structured` takes the same exact no-op path it always
 * did.
 *
 * @param userPrompt The user's prompt. Optional: an image-to-video run may
 *   legitimately have none, and it is returned as-is when nothing folds.
 * @param direction Flat catalog ids. Unknown keys, off-surface keys (an
 *   image-only dimension sent to a video run) and unknown ids all contribute
 *   nothing — never a throw.
 * @param structured Path-1 structured fields. Not a `/v1/generate-video` wire
 *   field today; the canvas orchestrator passes it directly.
 * @param opts.hintMode Override the direction verbosity policy (a whole-fold
 *   `PickerHintMode`, or a `{ look, motion }` split).
 * @param opts.subject Flat subject ids (Person / Styling / props), same
 *   inertness contract as `direction`.
 * @param opts.subjectHintMode Override the subject verbosity policy.
 * @param opts.cap / `opts.frame` See {@link VideoPromptCapOptions}.
 */
export function composeVideoPromptText(
  userPrompt: string | undefined,
  direction: DirectionFields | undefined,
  structured?: StructuredPromptFields,
  opts?: {
    readonly hintMode?: DirectionHintMode
    readonly subject?: SubjectFields
    readonly subjectHintMode?: SubjectHintMode
  } & VideoPromptCapOptions,
): string | undefined {
  // ONE sheddable list, subject FIRST then direction — because the shed walks it
  // from the TAIL, so this order IS the survival order: a direction clause
  // leaves before a subject clause. Deliberate, and the same order the image
  // side uses (`renderImageHintPieces`): the subject is the noun phrase the
  // cinematography modifies, so losing "who is in the shot" to keep a
  // decorative grade would be the wrong trade. With no `subject` the list IS
  // the direction fold, so every pre-subject caller is byte-identical.
  const hintClauses = [
    ...renderSubjectHints(opts?.subject, {
      surface: "video",
      mode: opts?.subjectHintMode ?? SUBJECT_VIDEO_HINT_MODE_DEFAULT,
    }),
    ...renderDirectionHints(direction, {
      surface: "video",
      mode: opts?.hintMode ?? VIDEO_HINT_MODE_DEFAULT,
    }),
  ].filter((p) => p.length > 0)
  // User CONTENT, not a garnish: never sheddable, always last.
  const structuredFragment = structured ? renderStructuredFields(structured) : ""

  const composeWith = (kept: number): string | undefined => {
    const hints = [...hintClauses.slice(0, kept), structuredFragment].filter(
      (p) => p.length > 0,
    )
    // Nothing to fold → the caller's value straight back, `undefined` included.
    // Do NOT collapse this into `joinPromptHints(userPrompt ?? "", hints)`: that
    // would turn an absent prompt into `""` and break the no-op contract above.
    // A FULL shed lands here too, which is what keeps the no-op contract intact
    // at `kept === 0` — the route's `composed !== prompt` guard then correctly
    // leaves `input_data.userPrompt` unpinned.
    if (hints.length === 0) return userPrompt
    return joinPromptHints(userPrompt ?? "", hints)
  }

  const cap = opts?.cap
  if (cap === undefined) return composeWith(hintClauses.length)

  // Fold everything first (the under-cap byte-parity pass), then shed from the
  // tail of the fold order while the FRAMED prompt overflows the ceiling.
  // `keepableDirectionHints` — the ONE shed arithmetic, shared with the image
  // assembler — strictly decreases `kept` whenever there is a deficit, so this
  // terminates at `kept === 0` in the worst case, at which point nothing
  // droppable is left and the provider clamp stands.
  const frame = opts?.frame ?? ((body: string | undefined) => body)
  let kept = hintClauses.length
  let body = composeWith(kept)
  let framedLength = frame(body)?.length ?? 0
  while (framedLength > cap && kept > 0) {
    kept = keepableDirectionHints(hintClauses, kept, framedLength - cap)
    body = composeWith(kept)
    framedLength = frame(body)?.length ?? 0
  }
  return body
}
