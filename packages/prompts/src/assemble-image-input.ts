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
 * a node that carries NO stored `direction` / `structured` (every workflow
 * authored before the canvas honored them) still reaches here with both absent,
 * and `composePromptText` MUST return the caller's `userPrompt` byte-for-byte
 * unchanged, so the wrapper degenerates to exactly the `buildImagePrompt(...)`
 * call those sites made before. The platform callers (`execute-node` /
 * `payload-builder`) compose their prompt from the canvas GRAPH themselves and
 * ALSO forward a node's STORED `direction` / `structured` when it carries them
 * (`readDirectionFields` / `readStructuredFields`); those nodes get the id-hint
 * composition on top, ADDITIVE to the graph-wired cinematography hints the
 * caller already folded into `userPrompt`. Studio and the MCP route supply the
 * same two levers directly.
 *
 * THE EMPTY-CHECK FLAG (also load-bearing for parity): `execute-node` rejects a
 * truly-empty assembled prompt (its "type one, mention a character, or connect
 * a cinematography source" guard); `payload-builder` does NOT (it never threw
 * there). So the post-assembly throw is OPT-IN via `throwOnEmpty` — defaulting
 * to `false` preserves the backend's no-throw behavior. Callers that want the
 * guard (frontend, Studio, route) pass `throwOnEmpty: true`.
 */
import {
  buildImagePromptWithOverflow,
  type BuildImagePromptResult,
} from "./prompt-builder.js"
import {
  renderStructuredFields,
  type StructuredPromptFields,
} from "./prompt-builder-structured-fields.js"
import {
  renderDirectionHints,
  IMAGE_HINT_MODE_DEFAULT,
  type DirectionFields,
} from "./direction-registry.js"
import { joinPromptHints, PROMPT_HINT_SEPARATOR } from "./prompt-hint-join.js"
import type { CharacterDef, ConnectedReference, IdentityMeta } from "@nodaro/shared"

/**
 * Flat cinematic-direction ids the Studio framing UI, the MCP route and the
 * canvas node data expose — all optional. The dimensions, their canonical fold
 * ORDER and their per-catalog rendering live in `direction-registry.ts`; this
 * re-export keeps the import path stable for existing consumers. The platform
 * callers fold their GRAPH-WIRED hints into `userPrompt` themselves and pass
 * these only when the node carries them as stored data (Studio-emitted graphs,
 * spec D3).
 */
export type { DirectionFields }

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
   * MCP-route use, and the platform callers' narrow-read of a node's STORED
   * `data.direction`; absent on a node that carries none (so `composePromptText`
   * is a no-op for it and the result is byte-identical to today).
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
  /**
   * Reference-prompt assembly format for the `{image:N:label}` path. Forwarded
   * verbatim to `buildImagePrompt` (default legacy). "hybrid" = images-only
   * reference-lock snippet + lettered inline scene.
   */
  referenceFormat?: "legacy" | "hybrid"
  /** Override the hybrid reference-lock snippet (forwarded to buildImagePrompt). */
  referenceLockSnippet?: string
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
 * The hint pieces a fold contributes, split by whether the assembler may SHED
 * them under a provider prompt cap.
 *
 * `directionHints` are the catalog-rendered cinematic clauses — decorative
 * garnish next to a reference directive or the user's own prose, and the only
 * thing this assembler drops when the prompt won't fit. `structuredFragment` is
 * user CONTENT (a Path-1 structured field the caller populated), so it is
 * sticky and always lands LAST, exactly as before.
 */
interface ImageHintPieces {
  /** Rendered direction clauses in the registry's canonical fold order. */
  readonly directionHints: readonly string[]
  /** The structured-field fragment ("" when nothing is populated). */
  readonly structuredFragment: string
}

/**
 * Render the fold's hint pieces once, so the cap-aware retry can re-join a
 * SUBSET of them without re-rendering the catalogs. `renderDirectionHints`
 * folds the `direction` ids in the registry's canonical table order (unknown
 * keys and unknown ids contribute nothing), and `renderStructuredFields`
 * returns "" when nothing is populated. Never mutates inputs.
 */
function renderImageHintPieces(
  direction: DirectionFields | undefined,
  structured: StructuredPromptFields | undefined,
): ImageHintPieces {
  return {
    directionHints: renderDirectionHints(direction, {
      surface: "image",
      mode: IMAGE_HINT_MODE_DEFAULT,
    }).filter((p) => p.length > 0),
    structuredFragment: structured ? renderStructuredFields(structured) : "",
  }
}

/**
 * Compose the cinematic-direction hints + structured-field fragment with the
 * user's prompt, keeping the FIRST `keptDirectionHints` direction clauses (the
 * full count on the first pass; fewer only when the provider cap forced a
 * shed). The structured fragment always lands LAST.
 *
 * EXACT NO-OP CONTRACT: when there are no cinematic/structured hint pieces (the
 * platform-caller case for a node that carries no stored `direction`/
 * `structured` — every workflow authored before the canvas honored them), the
 * user's prompt is returned **verbatim, untrimmed** by `joinPromptHints`. This
 * is load-bearing for parity: the old platform path passed the prompt straight
 * to `buildImagePrompt`, which never trims, so trimming here would change the
 * assembled prompt (and the recorded `jobs.input_data`) byte-for-byte. Never
 * mutates inputs.
 *
 * A node that DOES carry `direction`/`structured` takes the join branch and is
 * therefore trimmed + `". "`-joined — intended, and asserted at the caller
 * level by the payload-builder before/after test.
 */
function composePromptText(
  userPrompt: string,
  pieces: ImageHintPieces,
  keptDirectionHints: number,
): string {
  const hints = [
    ...pieces.directionHints.slice(0, keptDirectionHints),
    pieces.structuredFragment,
  ].filter((p) => p.length > 0)
  return joinPromptHints(userPrompt, hints)
}

/**
 * How many of the first `kept` direction clauses may STAY if `overflowChars`
 * characters have to leave the body. Walks the fold order from the TAIL,
 * subtracting each clause plus the separator it brought, and stops as soon as
 * enough has been reclaimed.
 *
 * The shed order is therefore `DIRECTION_FIELDS` order REVERSED. Note what that
 * is and is not: the table's order is a COMPATIBILITY order (grouped by family,
 * with the legacy `DirectionFields` block pinned last so every pre-registry
 * caller's fold stays byte-identical) — it is NOT a ranking of how load-bearing
 * a dimension is, and this function does not claim one. Tail-first is chosen
 * because it is deterministic, matches the fold order the API documents, and
 * needs no second ordering to drift out of sync with the table. A caller mixing
 * legacy keys with the newer ones can therefore lose e.g. `lightingId` before a
 * decorative `isoValue` clause; if that ever matters, the fix is an explicit
 * priority column on `DIRECTION_FIELDS`, not a second hand-kept list here.
 *
 * Deliberately approximate (assembly is not perfectly additive); the caller
 * re-assembles and re-checks, and this function strictly decreases `kept`
 * whenever `overflowChars > 0`, so that loop terminates.
 */
function keepableDirectionHints(
  directionHints: readonly string[],
  kept: number,
  overflowChars: number,
): number {
  let deficit = overflowChars
  let next = kept
  while (next > 0 && deficit > 0) {
    next -= 1
    deficit -= directionHints[next]!.length + PROMPT_HINT_SEPARATOR.length
  }
  return next
}

/**
 * Assemble a node's image-generation inputs into a `BuildImagePromptResult`
 * (`{ prompt, nativeNegativePrompt, referenceImageUrls }`).
 *
 * Order: (1) compose the prompt text (no-op when no direction/structured),
 * (2) `buildImagePrompt(...)` — exactly the call the three sites make today,
 * (3) shed direction hints and re-assemble while the provider cap overflows,
 * (4) optional post-assembly empty-prompt throw (gated by `throwOnEmpty`).
 *
 * TRUNCATION ORDERING (step 3): `buildImagePrompt`'s cap clamp cuts the TAIL,
 * which is ORDER-BLIND — on a low-cap provider (seedream = 3000) a maximal
 * direction fold renders ~3.3K characters of clauses and the cut can sever a
 * reference directive, mention-resolved text or the user's own prose while a
 * decorative clause survives. So the ASSEMBLER decides instead: it knows which
 * clauses are hints because it just built them, and drops them last-folded
 * first until the prompt fits. Everything else — references, prose, the
 * structured fragment, the Style/Avoid suffixes — outranks a hint. A body that
 * still overflows with ZERO hints (long prose or many directives on its own)
 * falls back to the builder's clamp, unchanged.
 *
 * UNDER-CAP PARITY: the first pass folds every hint, so a prompt that fits is
 * byte-identical to before — the retry only ever runs on an over-cap assembly.
 */
export function assembleImageInput(
  input: AssembleImageInput,
): BuildImagePromptResult {
  const pieces = renderImageHintPieces(input.direction, input.structured)

  const assembleWith = (keptDirectionHints: number) => buildImagePromptWithOverflow({
    prompt: composePromptText(input.userPrompt, pieces, keptDirectionHints),
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
    ...(input.referenceFormat !== undefined ? { referenceFormat: input.referenceFormat } : {}),
    ...(input.referenceLockSnippet !== undefined ? { referenceLockSnippet: input.referenceLockSnippet } : {}),
    ...(input.characterDefs !== undefined ? { characterDefs: input.characterDefs } : {}),
    ...(input.userTemplates !== undefined ? { userTemplates: input.userTemplates } : {}),
    ...(input.flowTemplates !== undefined ? { flowTemplates: input.flowTemplates } : {}),
    ...(input.ancestorRefs !== undefined ? { ancestorRefs: input.ancestorRefs } : {}),
    ...(input.sourceNodeIdById !== undefined ? { sourceNodeIdById: input.sourceNodeIdById } : {}),
    ...(input.skipCharacterMentions !== undefined
      ? { skipCharacterMentions: input.skipCharacterMentions }
      : {}),
  })

  // Fold everything first (the under-cap byte-parity pass), then shed hints
  // from the tail of the fold order while the assembled prompt overflows the
  // provider cap. `keepableDirectionHints` strictly decreases `kept` whenever
  // there IS an overflow, so this terminates at `kept === 0` in the worst case —
  // at which point the body overflows on its own and the builder's clamp stands.
  let kept = pieces.directionHints.length
  let fitted = assembleWith(kept)
  while (fitted.overflowChars > 0 && kept > 0) {
    kept = keepableDirectionHints(pieces.directionHints, kept, fitted.overflowChars)
    fitted = assembleWith(kept)
  }
  // `overflowChars` is assembly bookkeeping, not part of the callers' contract.
  const { overflowChars, ...result } = fitted

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
