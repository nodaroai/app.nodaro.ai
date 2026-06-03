/**
 * `assembleImageInput` — the single source of truth for turning a node's
 * image-generation inputs (a prompt + cinematic direction + connected
 * references + the per-provider levers) into the flat `{ prompt,
 * nativeNegativePrompt, referenceImageUrls }` the `generate-image` route
 * expects.
 *
 * WHY THIS EXISTS (WI-1a): the same three-step assembly —
 *   1. compose the prompt text (fold cinematic id-hints + structured fields),
 *   2. call `buildImagePrompt(...)` (the pure core; the per-provider reference
 *      gate lives INSIDE it),
 *   3. (optionally) reject a truly-empty FINAL prompt,
 * — was duplicated in THREE places kept in lockstep by hand: the frontend
 * `execute-node.ts` `generate-image` branch, the backend
 * `payload-builder.ts` `generate-image` case, and Studio's `assembly.ts`.
 * This wrapper collapses them into one.
 *
 * THE NO-OP CONTRACT (load-bearing — the platform-caller parity relies on it):
 * the two platform callers (`execute-node` / `payload-builder`) compose their
 * prompt from the canvas graph themselves and pass NO cinematic `direction`
 * ids and NO `structured` fields. In that case `composePromptText` MUST return
 * the caller's `userPrompt` byte-for-byte unchanged, so the wrapper degenerates
 * to exactly the `buildImagePrompt(...)` call those sites make today. Studio
 * (and the MCP route) supply `direction` / `structured` and get the id-hint
 * composition on top.
 *
 * THE EMPTY-CHECK FLAG (also load-bearing for parity): `execute-node` rejects a
 * truly-empty assembled prompt (its "type one, mention a character, or connect
 * a cinematography source" guard); `payload-builder` does NOT (it never threw
 * there). So the post-assembly throw is OPT-IN via `throwOnEmpty` — defaulting
 * to `false` preserves the backend's no-throw behavior. Callers that want the
 * guard (frontend, Studio, route) pass `throwOnEmpty: true`.
 */
import {
  buildImagePrompt,
  type BuildImagePromptResult,
} from "./prompt-builder.js"
import { getFramingPromptHint } from "./framing.js"
import { getLightingPromptHint } from "./lighting.js"
import { getLensPromptHint } from "./lens.js"
import { getCameraFormatPromptHint } from "./camera-format.js"
import {
  renderStructuredFields,
  type StructuredPromptFields,
} from "./prompt-builder-structured-fields.js"
import type { CharacterDef, ConnectedReference, IdentityMeta } from "./types.js"

/**
 * Flat cinematic-direction ids the Studio framing UI (and the MCP route)
 * expose — all optional. Promoted here from Studio's `assembly.ts` so the
 * id → hint composition lives in one place. The platform callers pass none of
 * these (they fold their hints from the graph into `userPrompt` themselves).
 */
export interface DirectionFields {
  /** Shot Type — the FRAMINGS shot-size/coverage/composition/vantage dimensions. */
  framingId?: string
  /** Angle — the FRAMINGS angle dimension (separate pill, so it can coexist with Shot Type). */
  framingAngleId?: string
  lightingId?: string
  lensId?: string
  cameraFormatId?: string
}

/**
 * Input to `assembleImageInput`. A faithful SUPERSET of what the two platform
 * callers pass to `buildImagePrompt` today (so they can route through this
 * wrapper with byte-identical output), plus the id-based `direction` /
 * `structured` composition levers that Studio + the MCP route use.
 */
export interface AssembleImageInput {
  /** Pre-composed (caller's graph) or raw user prompt text. */
  userPrompt: string
  /** Image model id / provider key (the catalog enum value, e.g. "flux-2-max"). */
  provider: string
  /**
   * Connected references with URLs ALREADY resolved by the caller. Become
   * `referenceImageUrls` + identity directives inside `buildImagePrompt`
   * (gated per provider there). Omit when the caller wires only raw URLs.
   */
  connectedReferences?: ConnectedReference[]
  /**
   * Flat cinematic-direction ids → folded into the prompt as hints. Studio /
   * MCP-route use; the platform callers pass none (so `composePromptText` is a
   * no-op for them and the result is byte-identical to today).
   */
  direction?: DirectionFields
  /** Path-1 structured fields → composed fragment appended to the prompt. */
  structured?: StructuredPromptFields
  /**
   * Reference image URLs from direct connections / manual uploads — ride
   * `buildImagePrompt`'s reference-URL channel so they pass through the SAME
   * per-provider reference-image gate + ordering as `connectedReferences`.
   * (This is `buildImagePrompt`'s `referenceImageUrls` config field, named
   * `extra…` here to reflect that bound entities already carry their URLs.)
   */
  extraReferenceImageUrls?: string[]
  /** Negative prompt text (routed to native vs. "Avoid:" by `buildImagePrompt`). */
  negativePrompt?: string
  /** Style text to append (e.g. "cinematic"). */
  style?: string
  /** User-defined reorder of the injected reference list (stable tile ids). */
  referenceOrder?: readonly string[]
  /** Per-identity (imageIndex+label) user overrides for fidelity / custom text. */
  identityMeta?: readonly IdentityMeta[]
  /** Character slugs whose canonical-fallback the user explicitly hid. */
  suppressedCanonicalCharacterIds?: readonly string[]
  /** Location slugs whose canonical-fallback the user explicitly hid. */
  suppressedCanonicalLocationIds?: readonly string[]
  /** Character definitions selected for this node (legacy `buildImagePrompt` path). */
  characterDefs?: CharacterDef[]
  /** User-level prompt template overrides. */
  userTemplates?: Record<string, string>
  /** Flow-level prompt template overrides. */
  flowTemplates?: Record<string, string>
  /** Ancestor reference image URLs (fallback when no direct refs exist). */
  ancestorRefs?: string[]
  /** Map of `connectedReferences[i].id → sourceNodeId` for wired-raw tile ids. */
  sourceNodeIdById?: ReadonlyMap<string, string>
  /**
   * LoRA inference path: strip `@`-mention tokens + skip the connected-reference
   * machinery (the trigger word + LoRA carry identity).
   */
  skipCharacterMentions?: boolean
  /**
   * Reject a truly-empty FINAL (post-assembly) prompt with `throw`. OFF by
   * default to match the backend `payload-builder`, which never threw. The
   * frontend / Studio / route pass `true` to keep their "type one, bind a
   * character, or pick a cinematography direction" guard. Checked POST-assembly
   * so a bound entity / `@`-mention / direction chip that filled an otherwise-
   * empty prompt still runs.
   */
  throwOnEmpty?: boolean
}

/**
 * Compose the cinematic-direction hints + structured-field fragment with the
 * user's prompt. Each `get*PromptHint` returns "" on a miss, and
 * `renderStructuredFields` returns "" when nothing is populated.
 *
 * EXACT NO-OP CONTRACT: when there are no cinematic/structured hint pieces (the
 * platform-caller case — execute-node / payload-builder never pass `direction`/
 * `structured`), the user's prompt is returned **verbatim, untrimmed**. This is
 * load-bearing for parity: the old platform path passed the prompt straight to
 * `buildImagePrompt`, which never trims, so trimming here would change the
 * assembled prompt (and the recorded `jobs.input_data`) byte-for-byte. We only
 * trim the user prompt when joining it WITH hints, so it reads cleanly
 * ("prompt. hint", not "prompt . hint"). Never mutates inputs.
 */
function composePromptText(
  userPrompt: string,
  direction: DirectionFields | undefined,
  structured: StructuredPromptFields | undefined,
): string {
  const hints = [
    getFramingPromptHint(direction?.framingId),
    getFramingPromptHint(direction?.framingAngleId),
    getLightingPromptHint(direction?.lightingId),
    getLensPromptHint(direction?.lensId),
    getCameraFormatPromptHint(direction?.cameraFormatId),
    structured ? renderStructuredFields(structured) : "",
  ].filter((p) => p.length > 0)
  // No hints → verbatim (exact no-op = platform parity). With hints → trim the
  // user prompt so the ". " join is clean. The trailing filter drops a blank
  // user prompt so the join never starts with ". " (parity-critical — don't
  // remove it as "redundant": `hints` is pre-filtered but `userPrompt` is not).
  if (hints.length === 0) return userPrompt
  return [userPrompt.trim(), ...hints].filter((p) => p.length > 0).join(". ")
}

/**
 * Assemble a node's image-generation inputs into a `BuildImagePromptResult`
 * (`{ prompt, nativeNegativePrompt, referenceImageUrls }`).
 *
 * Order: (1) compose the prompt text (no-op when no direction/structured),
 * (2) `buildImagePrompt(...)` — exactly the call the three sites make today,
 * (3) optional post-assembly empty-prompt throw (gated by `throwOnEmpty`).
 */
export function assembleImageInput(
  input: AssembleImageInput,
): BuildImagePromptResult {
  const prompt = composePromptText(input.userPrompt, input.direction, input.structured)

  const result = buildImagePrompt({
    prompt,
    provider: input.provider,
    ...(input.connectedReferences !== undefined
      ? { connectedReferences: input.connectedReferences }
      : {}),
    // Manual uploads / direct refs ride the builder's reference-URL channel so
    // the per-provider reference gate filters them alongside bound entities.
    // Omit the field entirely when absent so the builder's default ([]) kicks
    // in — byte-identical to a caller that didn't set it.
    ...(input.extraReferenceImageUrls !== undefined
      ? { referenceImageUrls: input.extraReferenceImageUrls }
      : {}),
    ...(input.negativePrompt !== undefined ? { negativePrompt: input.negativePrompt } : {}),
    ...(input.style !== undefined ? { style: input.style } : {}),
    ...(input.referenceOrder !== undefined ? { referenceOrder: input.referenceOrder } : {}),
    ...(input.identityMeta !== undefined ? { identityMeta: input.identityMeta } : {}),
    ...(input.suppressedCanonicalCharacterIds !== undefined
      ? { suppressedCanonicalCharacterIds: input.suppressedCanonicalCharacterIds }
      : {}),
    ...(input.suppressedCanonicalLocationIds !== undefined
      ? { suppressedCanonicalLocationIds: input.suppressedCanonicalLocationIds }
      : {}),
    ...(input.characterDefs !== undefined ? { characterDefs: input.characterDefs } : {}),
    ...(input.userTemplates !== undefined ? { userTemplates: input.userTemplates } : {}),
    ...(input.flowTemplates !== undefined ? { flowTemplates: input.flowTemplates } : {}),
    ...(input.ancestorRefs !== undefined ? { ancestorRefs: input.ancestorRefs } : {}),
    ...(input.sourceNodeIdById !== undefined ? { sourceNodeIdById: input.sourceNodeIdById } : {}),
    ...(input.skipCharacterMentions !== undefined
      ? { skipCharacterMentions: input.skipCharacterMentions }
      : {}),
  })

  // Post-assembly empty-prompt check (opt-in): a bound entity / `@`-mention /
  // direction chip could have filled the assembled prompt even if the user
  // typed nothing — so only reject when the FINAL prompt is truly empty.
  if (input.throwOnEmpty && !result.prompt.trim()) {
    throw new Error(
      "No prompt — type one, bind a character, or pick a cinematography direction",
    )
  }

  return result
}
