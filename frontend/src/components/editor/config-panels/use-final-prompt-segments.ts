"use client"

import { useMemo } from "react"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { collectCinematographyHints, hasConnectedStyleNode } from "@/lib/cinematography-hints"
import { buildNodeRefMap, resolveTextRefs, resolveTextRefsSegments } from "@/lib/node-refs"
import { matchSnippetRanges } from "@/lib/snippet-matching"
import type { SnippetPoolItem } from "@/lib/snippet-pool"
import { getStylePromptHint } from "@nodaro/shared"
import { buildImagePromptSegments, buildIdentityDirectives } from "@nodaro/shared"
import { collectIdentityLockClause } from "@nodaro/shared"
import type {
  CharacterDef,
  ConnectedReference,
  IdentityMeta,
  PromptSegment,
} from "@nodaro/shared"
import type { DisplaySegment } from "./prompt-field-final-view"

/**
 * Split `user`-origin segments on snippet texts (exact substring match via
 * {@link matchSnippetRanges}), tagging matched spans `origin: "snippet"`.
 * Non-user segments pass through untouched (snippets only live in user-typed
 * prose). Each user segment is scanned independently, so `occupied` is `[]`.
 * Text is only partitioned, never altered → the join is preserved exactly.
 */
function splitUserSegmentsBySnippets(
  segments: readonly DisplaySegment[],
  snippets: readonly SnippetPoolItem[],
): DisplaySegment[] {
  if (snippets.length === 0) return [...segments]
  const out: DisplaySegment[] = []
  for (const seg of segments) {
    if (seg.origin !== "user" || !seg.text) {
      out.push(seg)
      continue
    }
    const ranges = matchSnippetRanges(seg.text, snippets, [])
    if (ranges.length === 0) {
      out.push(seg)
      continue
    }
    let cursor = 0
    for (const r of ranges) {
      if (r.start > cursor) out.push({ text: seg.text.slice(cursor, r.start), origin: "user" })
      out.push({ text: seg.text.slice(r.start, r.end), origin: "snippet" })
      cursor = r.end
    }
    if (cursor < seg.text.length) out.push({ text: seg.text.slice(cursor), origin: "user" })
  }
  return out
}

/**
 * Build origin-tagged display segments for a negative-prompt field. Resolves
 * {Label} variables, splits snippets, then GUARDS the join: if the tinted
 * segments don't reconstruct the displayed text (e.g. the provider rewrote the
 * native negative prompt), collapse to a single plain `user` segment so the
 * rendered text always equals the plain text byte-for-byte.
 */
function buildNegativeSegments(
  displayedNegative: string,
  rawNeg: string,
  refMap: ReadonlyMap<string, string>,
  snippets: readonly SnippetPoolItem[],
): DisplaySegment[] {
  if (!displayedNegative) return []
  const resolved = resolveTextRefsSegments(rawNeg, refMap) as DisplaySegment[]
  const split = splitUserSegmentsBySnippets(resolved, snippets)
  if (split.map((s) => s.text).join("") === displayedNegative) return split
  return [{ text: displayedNegative, origin: "user" }]
}

/** Where the resolved negative prompt is routed for this surface:
 *  - `null`    — no negative text (or a provider-less surface, which has no routing concept)
 *  - `native`  — the provider takes `negative_prompt` natively (builder returned `nativeNegativePrompt`)
 *  - `appended`— folded into the prompt as a trailing `Avoid: …` suffix */
export type NegativeRouting = "native" | "appended" | null

/** One-line caption for a negative field's final-view, explaining how the
 *  resolved negative is routed for the selected provider. Derived from
 *  {@link NegativeRouting} (read back from the builder — never a re-derivation
 *  of the provider list). `null` (no negative / provider-less) → no caption.
 *  Shared by every surface that renders the inline negative final-view. */
export function negativeRoutingCaption(routing: NegativeRouting): string | undefined {
  switch (routing) {
    case "native":
      return "Sent natively as the provider's negative prompt"
    case "appended":
      return 'Appended to the prompt as "Avoid: …"'
    default:
      return undefined
  }
}

export interface UseFinalPromptSegmentsArgs {
  /** User's prompt text (from `data.prompt` or equivalent). */
  readonly userPrompt: string | undefined
  /** Style text appended to the prompt (e.g. "cinematic, film grain"). */
  readonly style?: string
  /** Negative prompt. */
  readonly negativePrompt?: string
  /** The consumer node's id; used to walk incoming cinematography edges. */
  readonly consumerNodeId: string | undefined
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  /**
   * Provider key. When provided, the result is computed by calling
   * `buildImagePromptSegments` so the rendered text is byte-identical to what
   * the runtime sends to the model AND carries origin tags for the colored
   * provenance rendering. Absent → the flat provider-less fallback path.
   */
  readonly provider?: string
  /**
   * Connected references in display order. When provided alongside `provider`,
   * per-identity directives appear in the final string, `{image:N:label}` tokens
   * expand to "the {label} from image N", and URLs are sent in this order.
   */
  readonly connectedReferences?: ReadonlyArray<ConnectedReference>
  readonly identityMeta?: ReadonlyArray<IdentityMeta>
  /**
   * Legacy character definitions (only used when `connectedReferences` is
   * NOT provided).
   */
  readonly characterDefs?: ReadonlyArray<CharacterDef>
  /** Prompt-field snippet pool — highlights snippet fragments inside user prose. */
  readonly snippets?: readonly SnippetPoolItem[]
  /** Negative-field snippet pool. */
  readonly negativeSnippets?: readonly SnippetPoolItem[]
}

export interface UseFinalPromptSegmentsResult {
  /** Origin-tagged prompt segments. `[]` on the provider-less path (flat text). */
  readonly promptSegments: DisplaySegment[]
  /** Origin-tagged negative segments. `[]` when no native negative is shown. */
  readonly negativeSegments: DisplaySegment[]
  /** Plain assembled prompt (byte-identical to the runtime when `provider` set). */
  readonly promptText: string
  /** The resolved negative input ({variables} expanded), shown in the negative
   *  field's final view in BOTH routings (native AND appended) and on the
   *  provider-less path. The routing caption (see {@link negativeRouting})
   *  explains where it actually goes. */
  readonly negativeText: string
  /** Clipboard payload: prompt + "Negative prompt: …" joined by a blank line. */
  readonly copyText: string
  /** How the negative is routed — see {@link NegativeRouting}. */
  readonly negativeRouting: NegativeRouting
  /** Connected cinematography hint fragments (raw, for the per-hint bullet list). */
  readonly cineHints: string[]
  /** The identity/reference directive intro block, when references are wired. */
  readonly refBlock: string
}

/**
 * Single source of assembly truth for the inline final-prompt views. Same
 * provider-aware (`buildImagePromptSegments`) and provider-less (flat manual
 * composition) branches, same `bodySegs` construction with the dev-invariant,
 * same snippet post-pass over user segments, same negative-segment join
 * guards. Returns structured fields every prompt/negative field's final view
 * consumes.
 */
export function useFinalPromptSegments(args: UseFinalPromptSegmentsArgs): UseFinalPromptSegmentsResult {
  const {
    userPrompt,
    style,
    negativePrompt,
    consumerNodeId,
    nodes,
    edges,
    provider,
    connectedReferences,
    identityMeta,
    characterDefs,
    snippets,
    negativeSnippets,
  } = args

  // Stabilize the optional pools so an undefined prop doesn't churn a new []
  // identity every render and re-run the memo. (Callers already memoize the
  // pools via useSnippetPool, so the prop identity is stable when provided.)
  const promptSnippets = useMemo<readonly SnippetPoolItem[]>(() => snippets ?? [], [snippets])
  const negSnippets = useMemo<readonly SnippetPoolItem[]>(() => negativeSnippets ?? [], [negativeSnippets])

  return useMemo<UseFinalPromptSegmentsResult>(() => {
    // Resolve {Node Label} variable refs first — this mirrors the runtime
    // step in execute-node.ts before the prompt enters buildImagePrompt.
    const refMap = consumerNodeId ? buildNodeRefMap(consumerNodeId, nodes, edges) : new Map<string, string>()
    const rawUser = (userPrompt ?? "").trim()
    const resolvedUser = (resolveTextRefs(rawUser, refMap) ?? rawUser).trim()
    const rawNeg = (negativePrompt ?? "").trim()
    const resolvedNeg = (resolveTextRefs(rawNeg, refMap) ?? rawNeg).trim()
    const styleBypass = hasConnectedStyleNode(consumerNodeId, nodes, edges)

    const hints = consumerNodeId
      ? collectCinematographyHints(consumerNodeId, nodes, edges)
      : []
    const identityClause = consumerNodeId
      ? collectIdentityLockClause(consumerNodeId, nodes, edges)
      : ""

    // Replicate the cinematography + identity-clause prefix that execute-node.ts
    // performs before invoking buildImagePrompt.
    let preBuildPrompt = resolvedUser
    if (hints.length > 0) {
      const joined = hints.join(", ")
      preBuildPrompt = preBuildPrompt ? `${preBuildPrompt}. ${joined}` : joined
    }
    if (identityClause) {
      preBuildPrompt = preBuildPrompt ? `${preBuildPrompt} ${identityClause}` : identityClause
    }

    const refs = connectedReferences ?? []
    const meta = identityMeta ?? []
    const refIntro = refs.length > 0 ? buildIdentityDirectives(preBuildPrompt, refs, meta) : ""

    // Provider-aware path: invoke buildImagePromptSegments for byte-identical
    // preview AND origin-tagged spans.
    if (provider) {
      // Body segments mirroring the preBuildPrompt composition above EXACTLY
      // (same ". " / ", " / " " joiners), so their join matches preBuildPrompt
      // and buildImagePromptSegments keeps them instead of collapsing.
      const userSegs = resolveTextRefsSegments(rawUser, refMap)
      const bodySegs: PromptSegment[] = [...userSegs]
      if (hints.length > 0) {
        if (resolvedUser) bodySegs.push({ text: ". ", origin: "user" })
        hints.forEach((h, i) => {
          if (i > 0) bodySegs.push({ text: ", ", origin: "user" })
          bodySegs.push({ text: h, origin: "picker" })
        })
      }
      if (identityClause) {
        if (bodySegs.length > 0) bodySegs.push({ text: " ", origin: "user" })
        bodySegs.push({ text: identityClause, origin: "mention" })
      }
      // Dev-invariant: if our segment composition diverges from the string the
      // preview actually builds (e.g. a variable value introduced boundary
      // whitespace that .trim() removed), pass undefined so the builder
      // collapses the body to one user span rather than rendering a wrong split.
      const bodySegsValid = bodySegs.map((s) => s.text).join("") === preBuildPrompt

      const result = buildImagePromptSegments(
        {
          prompt: preBuildPrompt,
          provider,
          style: styleBypass ? undefined : style,
          negativePrompt: resolvedNeg || undefined,
          connectedReferences: refs.length > 0 ? [...refs] : undefined,
          identityMeta: meta.length > 0 ? [...meta] : undefined,
          characterDefs: characterDefs ? [...characterDefs] : undefined,
        },
        bodySegsValid ? bodySegs : undefined,
      )
      const promptText = result.prompt
      // The negative field's final view shows the RESOLVED negative input in
      // BOTH routings (spec: prompt-field-final-view.md §UX) — tinted, with a
      // caption explaining where it goes. So the display text is `resolvedNeg`
      // regardless of whether the builder routed it natively or folded it into
      // the prompt's `Avoid:` suffix. (Previously this returned "" on the
      // "appended" path — legacy preview semantics — which hid the negative.)
      const negativeText = resolvedNeg
      // copyText keeps its legacy shape (prompt + native negative only); it dies
      // with the standalone FinalPromptPreview block and is not consumed by the
      // inline field views (which copy their own plainText). When the negative
      // is folded into the prompt as `Avoid:`, it already rides along in
      // `promptText`, so appending it again here would double it.
      const copyLines: string[] = []
      if (promptText) copyLines.push(promptText)
      if (result.nativeNegativePrompt) copyLines.push(`Negative prompt: ${result.nativeNegativePrompt}`)
      // Snippet post-pass over the user-origin spans (builder guarantees
      // join(segments) === promptText; splitting preserves it).
      const segs = splitUserSegmentsBySnippets(result.segments as DisplaySegment[], promptSnippets)
      // Routing is read back from what the builder actually did (pass-through,
      // not a re-derivation of NATIVE_NEGATIVE_PROMPT_MODELS): a returned
      // `nativeNegativePrompt` means it went out as a real param ("native");
      // a non-empty negative that the builder did NOT surface natively was
      // folded into the prompt as an `Avoid:` suffix ("appended"); no negative
      // at all → null.
      const negativeRouting: NegativeRouting = !resolvedNeg
        ? null
        : result.nativeNegativePrompt
          ? "native"
          : "appended"
      return {
        promptText,
        cineHints: hints,
        refBlock: refIntro,
        negativeText,
        copyText: copyLines.join("\n\n"),
        promptSegments: segs,
        // Tint the resolved negative in both routings. The join-guard inside
        // buildNegativeSegments collapses to a single plain span if the tinted
        // decomposition can't reconstruct `negativeText` (defensive).
        negativeSegments: buildNegativeSegments(negativeText, rawNeg, refMap, negSnippets),
        negativeRouting,
      }
    }

    // Provider-less fallback: legacy manual composition (kept for callers that
    // haven't wired up `provider`). Best-effort preview, not byte-identical, and
    // rendered as flat text (no provenance spans).
    const trimmedStyle = styleBypass ? "" : (style ?? "").trim()
    const styleText = trimmedStyle
      ? (getStylePromptHint(trimmedStyle) || trimmedStyle)
      : ""
    const baseParts: string[] = []
    if (preBuildPrompt) baseParts.push(preBuildPrompt)
    let promptText = baseParts.join(". ")
    if (refIntro) {
      promptText = promptText ? `${refIntro}\n\n${promptText}` : refIntro
    }
    if (styleText) promptText += (promptText ? "\n" : "") + `Style: ${styleText}`

    const copyLines: string[] = []
    if (promptText) copyLines.push(promptText)
    if (resolvedNeg) copyLines.push(`Negative prompt: ${resolvedNeg}`)

    return {
      promptText,
      cineHints: hints,
      refBlock: refIntro,
      negativeText: resolvedNeg,
      copyText: copyLines.join("\n\n"),
      promptSegments: [] as DisplaySegment[],
      negativeSegments: [] as DisplaySegment[],
      // Provider-less surfaces have no native/append routing concept.
      negativeRouting: null,
    }
  }, [userPrompt, style, negativePrompt, consumerNodeId, nodes, edges, provider, connectedReferences, identityMeta, characterDefs, promptSnippets, negSnippets])
}
