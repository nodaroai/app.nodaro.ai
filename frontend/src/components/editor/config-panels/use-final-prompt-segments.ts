"use client"

import { useMemo } from "react"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { collectCinematographyHints, hasConnectedStyleNode } from "@/lib/cinematography-hints"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"
import { buildNodeRefMap, resolveTextRefs, resolveTextRefsSegments, collectWiredPromptContribution } from "@/lib/node-refs"
import { matchSnippetRanges } from "@/lib/snippet-matching"
import type { SnippetPoolItem } from "@/lib/snippet-pool"
import { getStylePromptHint } from "@nodaro/shared"
import {
  assembleImageInput,
  buildIdentityDirectives,
} from "@nodaro/shared"
import { collectIdentityLockClause } from "@nodaro/shared"
import { applyVideoNegativePrompt, composeNegative } from "@nodaro/shared"
import type {
  CharacterDef,
  ConnectedReference,
  IdentityMeta,
  SoundConsumerType,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { buildImageAssembleInput } from "./build-image-assemble-input"
import { assembleVideoPrompt } from "@/lib/video-prompt-assembly"
import { assembleAudioPrompt, AUDIO_PROMPT_NODE_TYPES, AUDIO_STYLE_FOLD_TYPES } from "@/lib/audio-prompt-assembly"
import { collectAudioStyleHints } from "@/lib/audio-style-hints"
import { getSnippetMedia } from "@/lib/prompt-fields"
import { tagPromptProvenance, type ProvenanceFragment } from "@/lib/prompt-provenance"
import type { DisplaySegment } from "./prompt-field-final-view"

/**
 * The directive-block headers `buildImagePrompt` emits at the START of an
 * assembled image prompt (each followed by `\n` then the bulleted directives,
 * the whole block terminated by a blank line). Kept in lockstep with the
 * literal headers in `@nodaro/shared`'s `prompt-builder.ts`:
 *   - `resolveCharacterMentions` / the `@`-mention consolidation branch →
 *     "Use these characters:"
 *   - the location directive block → "Use these locations:"
 *   - the "Use these references…" prepend branch (non-`@` connected refs).
 */
const DIRECTIVE_BLOCK_HEADERS = [
  "Use these characters:\n",
  "Use these locations:\n",
  "Use these references for the output image:\n",
] as const

/**
 * Extract the leading reference/identity DIRECTIVE block from an assembled image
 * prompt for provenance tinting. The block is always a prefix under a known
 * header (see {@link DIRECTIVE_BLOCK_HEADERS}) and is separated from the user
 * body by the first blank line, so we return everything up to (but not
 * including) that `\n\n`. Reading it back from the FINAL string — rather than
 * re-deriving it from a standalone helper — is the only approach that's faithful
 * across EVERY way the builder produces the block (`@`-mentions, `{image:N}`,
 * canonical-wired fallbacks, locations). Returns "" when the prompt has no
 * directive block.
 */
function extractDirectivePrefix(promptText: string): string {
  if (!DIRECTIVE_BLOCK_HEADERS.some((h) => promptText.startsWith(h))) return ""
  const sep = promptText.indexOf("\n\n")
  // No blank line → the whole prompt is the directive block (empty user body).
  return sep === -1 ? promptText : promptText.slice(0, sep)
}

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
 *  - `null`    — no negative text (or a plain provider-less surface — image
 *                `provider` unset AND `videoProvider` unset — which has no routing concept)
 *  - `native`  — the provider takes `negative_prompt` natively. Image path:
 *                `buildImagePromptSegments` returned `nativeNegativePrompt`.
 *                Video path: `applyVideoNegativePrompt` returned `nativeNegativePrompt`
 *                (Kling / Wan families).
 *  - `appended`— folded into the prompt as a trailing `Avoid: …` suffix (image
 *                providers without a native field, or non-native video providers) */
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
   * Video provider key for the provider-less (video) path. PREDICTS the backend's
   * video negative-prompt routing via the SAME shared helper the pipeline uses
   * (`applyVideoNegativePrompt`), so the rendered prompt + routing caption match
   * what the video provider actually receives. Native-negative video providers
   * (Kling / Wan families) keep the prompt unchanged and surface the negative as
   * a native param ("native" routing); all others fold it into the prompt as a
   * trailing `Avoid: …` clause ("appended"). IGNORED when `provider` (the image
   * path) is set — image assembly wins, and that path derives its own routing
   * from `buildImagePromptSegments`. NEVER routes video prompts through
   * `buildImagePrompt`.
   */
  readonly videoProvider?: string
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
  /** Origin-tagged prompt segments (variables / snippets / picker / mention /
   *  style / negative). Falls back to `[]` only when a decomposition fails the
   *  absolute join-guard — the view then renders `promptText` verbatim. */
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
    videoProvider,
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

  // Store slices the image path needs so the preview routes through the SAME
  // full input set the run passes to `assembleImageInput` (templates + library
  // character defs). Read here (top-level, React rules) and passed into the
  // memo; the provider-less branch ignores them.
  const userPromptTemplates = useWorkflowStore((s) => s.userPromptTemplates)
  const flowPromptTemplates = useWorkflowStore((s) => s.flowPromptTemplates)
  const characterDefinitions = useWorkflowStore((s) => s.characterDefinitions)

  return useMemo<UseFinalPromptSegmentsResult>(() => {
    // Resolve {Node Label} variable refs first — this mirrors the runtime
    // step in execute-node.ts before the prompt enters buildImagePrompt.
    const refMap = consumerNodeId ? buildNodeRefMap(consumerNodeId, nodes, edges) : new Map<string, string>()
    const consumerType = consumerNodeId ? nodes.find((n) => n.id === consumerNodeId)?.type : undefined
    const rawUser = (userPrompt ?? "").trim()
    const resolvedUser = (resolveTextRefs(rawUser, refMap) ?? rawUser).trim()
    const rawNeg = (negativePrompt ?? "").trim()
    let resolvedNeg = (resolveTextRefs(rawNeg, refMap) ?? rawNeg).trim()
    // generate-image / generate-video COMPOSE the wired negative-handle text
    // (parity with execute-node's composeNegative) so the preview shows the
    // connected negative the run sends. The wired half is RAW — composeNegative
    // does not ref-resolve the wired value (mirrors execute-node).
    if ((consumerType === "generate-image" || consumerType === "generate-video") && consumerNodeId) {
      const wiredN = collectWiredPromptContribution(consumerNodeId, nodes, edges, "negative")
      if (wiredN) resolvedNeg = composeNegative(resolvedNeg, wiredN)
    }
    const styleBypass = hasConnectedStyleNode(consumerNodeId, nodes, edges)

    const hints = consumerNodeId
      // Image preview is a bullet consumer (character elements are stamped onto
      // the ref's identity bullet); exclude them here to mirror the run and
      // avoid a tail dup in the preview.
      ? collectCinematographyHints(consumerNodeId, nodes, edges, { excludeCharacterElements: true })
      : []
    const identityClause = consumerNodeId
      ? collectIdentityLockClause(consumerNodeId, nodes, edges)
      : ""

    // Replicate the prompt assembly execute-node.ts performs before
    // buildImagePrompt: typed → APPENDED wired prompt (generate-image only;
    // generate-video appends inside assembleVideoPrompt) → cinematography hints
    // → identity clause. The wired prompt is ref-resolved to mirror resolvePrompt.
    let preBuildPrompt = resolvedUser
    if (consumerType === "generate-image" && consumerNodeId) {
      const wiredP = collectWiredPromptContribution(consumerNodeId, nodes, edges, "prompt")
      const rp = wiredP ? (resolveTextRefs(wiredP, refMap) ?? wiredP).trim() : ""
      if (rp) preBuildPrompt = preBuildPrompt ? `${preBuildPrompt}. ${rp}` : rp
    }
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

    // Provider-aware (image) path: route the preview through the SAME shared
    // assembler the RUN uses (`assembleImageInput`) with the FULL input set
    // (templates + library defs + ancestor/order/suppression levers), built via
    // `buildImageAssembleInput` exactly as the run does — so the rendered text
    // is byte-identical to the payload AND no longer DROPS text the run sends.
    // Colour is then located in the FINAL string via `tagPromptProvenance`
    // (robust to reference/{image:N}/truncation rewrites), not re-derived from a
    // hand-mirrored body composition.
    if (provider) {
      const consumerNode = consumerNodeId
        ? nodes.find((n) => n.id === consumerNodeId)
        : undefined

      // Safety: if we can't find the consumer node we can't build the run-
      // faithful input. Fall through to the provider-less path below rather than
      // assemble against a synthetic node (the `if (provider)` guard is the only
      // thing skipped — `consumerNode` is the precondition for it).
      if (consumerNode) {
        const assembleInput = buildImageAssembleInput({
          node: consumerNode,
          nodes,
          edges,
          characterDefinitions,
          userPromptTemplates,
          flowPromptTemplates,
          composedPrompt: preBuildPrompt,
          provider,
          style,
          styleBypass,
          resolvedNegative: resolvedNeg,
        })
        const result = assembleImageInput({ ...assembleInput, referenceFormat: IMAGE_REFERENCE_FORMAT })
        const promptText = result.prompt

        // The reference/identity DIRECTIVE block sits at the very START of the
        // assembled prompt under a stable header (e.g. "Use these characters:")
        // and is terminated by the first blank line. We read it back from the
        // FINAL string — the same locate-in-output discipline `tagPromptProvenance`
        // uses — so it's correct for EVERY way the block is produced (`@`-mention
        // consolidation, `{image:N}` directives, canonical-wired fallbacks,
        // locations), none of which a standalone helper reproduces faithfully.
        const imageRefIntro = extractDirectivePrefix(promptText)

        // The style / appended-negative suffixes are matched EXACTLY against
        // `buildImagePrompt`'s emitted form (`\nStyle: <hint>` / `\nAvoid: <neg>`).
        const styleHint = styleBypass
          ? ""
          : (() => {
              const t = (style ?? "").trim()
              return t ? (getStylePromptHint(t) || t) : ""
            })()

        // ── Provenance fragments, OUTER/STRUCTURAL-FIRST (precedence order) ──
        // `tagPromptProvenance` consumes earlier fragments first and only tags
        // text that survived VERBATIM in `promptText`, so over-listing is
        // harmless: a fragment a rewrite mangled simply stays "user".
        const fragments: ProvenanceFragment[] = []
        // Reference/identity directive block.
        if (imageRefIntro) fragments.push({ text: imageRefIntro, origin: "mention" })
        // The cinematography identity-lock clause (folded into the body upstream
        // of the assembler) reads as a "References" tint.
        if (identityClause) fragments.push({ text: identityClause, origin: "mention" })
        // Style suffix — exact `\nStyle: <hint>` form (no-op tag if truncated away).
        if (styleHint) fragments.push({ text: `\nStyle: ${styleHint}`, origin: "style" })
        // Appended negative — only when the assembler folded it in (non-native);
        // exact `\nAvoid: <neg>` form.
        if (result.nativeNegativePrompt == null && resolvedNeg) {
          fragments.push({ text: `\nAvoid: ${resolvedNeg}`, origin: "negative" })
        }
        // Variables resolved from {Node Label} refs in the user prose.
        for (const s of resolveTextRefsSegments(rawUser, refMap)) {
          if (s.origin === "variable" && s.text) fragments.push({ text: s.text, origin: "variable" })
        }
        // Cinematography picker hints folded into the body.
        for (const h of hints) if (h) fragments.push({ text: h, origin: "picker" })
        // Snippet fragments inserted in the user prose.
        for (const sn of promptSnippets) if (sn.text) fragments.push({ text: sn.text, origin: "snippet" })

        const promptSegments = tagPromptProvenance(promptText, fragments)

        // The negative field's final view shows the RESOLVED negative input in
        // BOTH routings (spec: prompt-field-final-view.md §UX) — tinted, with a
        // caption explaining where it goes. So the display text is `resolvedNeg`
        // regardless of whether the builder routed it natively or folded it into
        // the prompt's `Avoid:` suffix.
        const negativeText = resolvedNeg
        // copyText keeps its legacy shape (prompt + native negative only). When
        // the negative is folded into the prompt as `Avoid:`, it already rides
        // along in `promptText`, so appending it again here would double it.
        const copyLines: string[] = []
        if (promptText) copyLines.push(promptText)
        if (result.nativeNegativePrompt) copyLines.push(`Negative prompt: ${result.nativeNegativePrompt}`)
        // Routing is read back from what the assembler actually did (pass-through,
        // not a re-derivation of NATIVE_NEGATIVE_PROMPT_MODELS): a returned
        // `nativeNegativePrompt` means it went out as a real param ("native"); a
        // non-empty negative the assembler did NOT surface natively was folded
        // into the prompt as an `Avoid:` suffix ("appended"); none → null.
        const negativeRouting: NegativeRouting = !resolvedNeg
          ? null
          : result.nativeNegativePrompt
            ? "native"
            : "appended"
        return {
          promptText,
          cineHints: hints,
          refBlock: imageRefIntro,
          negativeText,
          copyText: copyLines.join("\n\n"),
          promptSegments,
          // Tint the resolved negative in both routings. The join-guard inside
          // buildNegativeSegments collapses to a single plain span if the tinted
          // decomposition can't reconstruct `negativeText` (defensive).
          negativeSegments: buildNegativeSegments(negativeText, rawNeg, refMap, negSnippets),
          negativeRouting,
        }
      }
    }

    // ── Audio path (consumer node's snippet media is "audio") ────────────────
    // Audio config panels pass NEITHER `provider` nor `videoProvider`, so before
    // Phase 4 they hit the flat provider-less fallback — which showed ONLY the
    // resolved user prompt and OMITTED the audio-style hints (genre / mood /
    // instrumentation / voice-character) the run FOLDS in from connected
    // audio-style nodes. Compose the prompt-field the SAME way the run does via
    // the shared `assembleAudioPrompt` (Phase 4A), then colour the FINAL string
    // with `tagPromptProvenance`. Derive "audio" from the consumer node's
    // snippet media (single source of truth in `prompt-fields.ts`) rather than a
    // hand-kept type list, so a new audio node is covered automatically. Placed
    // BEFORE the provider-less fallback so it takes precedence; the image/video
    // branches above (gated on `provider` / `videoProvider`) are untouched.
    const audioConsumerNode = consumerNodeId
      ? nodes.find((n) => n.id === consumerNodeId)
      : undefined
    const audioMedia = audioConsumerNode ? getSnippetMedia(audioConsumerNode.type) : undefined
    // Gate on the assembler's OWNED audio types — not `media === "audio"` alone —
    // so the two out-of-scope audio-media nodes (`video-sfx`: has a negative
    // lever; `forced-alignment`: prompt field is `transcript`) keep their correct
    // provider-less rendering. `AUDIO_PROMPT_NODE_TYPES` is the single source of
    // truth, in lockstep with `assembleAudioPrompt`'s dispatch.
    if (
      audioMedia === "audio" &&
      audioConsumerNode &&
      audioConsumerNode.type &&
      AUDIO_PROMPT_NODE_TYPES.has(audioConsumerNode.type)
    ) {
      const nodeType = audioConsumerNode.type
      const promptText = assembleAudioPrompt(nodeType, {
        node: audioConsumerNode,
        nodes,
        edges,
        refMap,
      })

      // The folded audio-style hint text (only the 5 SoundConsumerType nodes
      // fold; pass-through audio nodes have none). For suno-generate in custom
      // mode the hints go to the STYLE field, so they won't appear in this
      // prompt-field `promptText` — `tagPromptProvenance` simply leaves the
      // (absent) fragment untagged, which is exactly right.
      const audioStyleText = AUDIO_STYLE_FOLD_TYPES.has(nodeType as SoundConsumerType)
        ? collectAudioStyleHints(audioConsumerNode, nodeType as SoundConsumerType, nodes, edges).text
        : ""

      // ── Provenance fragments (precedence order) ──
      // `tagPromptProvenance` tags only text that survived VERBATIM in
      // `promptText`, so over-listing is harmless. Audio nodes have no
      // reference / style / negative levers on this surface, so we tag exactly
      // three kinds: folded audio-style hints, resolved {variables}, snippets.
      const fragments: ProvenanceFragment[] = []
      // Folded audio-style hint text reads as a "picker" (parameter-picker) tint.
      if (audioStyleText) fragments.push({ text: audioStyleText, origin: "picker" })
      // Variables resolved from {Node Label} refs in the user prose.
      for (const s of resolveTextRefsSegments(rawUser, refMap)) {
        if (s.origin === "variable" && s.text) fragments.push({ text: s.text, origin: "variable" })
      }
      // Snippet fragments inserted in the user prose.
      for (const sn of promptSnippets) if (sn.text) fragments.push({ text: sn.text, origin: "snippet" })

      const promptSegments = tagPromptProvenance(promptText, fragments)

      const copyLines: string[] = []
      if (promptText) copyLines.push(promptText)
      return {
        promptText,
        // Audio nodes carry no cinematography hints or reference block on this
        // surface — the audio-style fold is the "picker" provenance, not cineHints.
        cineHints: [],
        refBlock: "",
        // Audio nodes have no negative field here.
        negativeText: "",
        copyText: copyLines.join("\n\n"),
        promptSegments,
        negativeSegments: [],
        negativeRouting: null,
      }
    }

    // ── Video path (`videoProvider` set, no image `provider`) ────────────────
    // Compose the prompt the SAME way the run does by calling the run's shared
    // assembler (`assembleVideoPrompt` — extracted from execute-node.ts in Phase
    // 3A), so the preview matches the payload: motion + cinematography folding,
    // identity clause, @-mention resolution, {image:N} stripping — none of which
    // the old provider-less composition did. Then layer the negative routing on
    // top via the SAME shared helper the pipeline uses (`applyVideoNegativePrompt`),
    // and colour the FINAL string via `tagPromptProvenance` (locate-in-output,
    // robust to clamping/reference rewrites).
    if (videoProvider && !provider) {
      const consumerNode = consumerNodeId
        ? nodes.find((n) => n.id === consumerNodeId)
        : undefined
      // Need the node (its type + data drive composition) AND a node type to
      // dispatch on. Missing either → fall through to the provider-less path.
      if (consumerNode && consumerNode.type) {
        const composed = assembleVideoPrompt(consumerNode.type, {
          node: consumerNode,
          nodes,
          edges,
          refMap,
        })
        // Negative routing: native (Kling/Wan families) → prompt unchanged,
        // negative rides a native param; non-native → folded in as `\nAvoid: …`.
        const negResult = applyVideoNegativePrompt(composed, resolvedNeg, videoProvider)
        const promptText = negResult.prompt ?? ""
        const negativeRouting: NegativeRouting = !resolvedNeg
          ? null
          : negResult.nativeNegativePrompt
            ? "native"
            : "appended"

        // ── Provenance fragments, OUTER/STRUCTURAL-FIRST (precedence order) ──
        // `tagPromptProvenance` tags only text that survived VERBATIM in
        // `promptText`, so over-listing is harmless (a clamped/rewritten
        // fragment simply stays "user").
        const fragments: ProvenanceFragment[] = []
        // The @-mention / canonical-fallback directive block, when it was
        // PREPENDED as a "Use these characters:" prefix (best-effort: only the
        // cleanly-detectable prefix form, terminated by the first blank line).
        const mentionPrefix = extractDirectivePrefix(composed)
        if (mentionPrefix) fragments.push({ text: mentionPrefix, origin: "mention" })
        // The identity-lock clause (currently a no-op helper, but mirror the run).
        if (identityClause) fragments.push({ text: identityClause, origin: "mention" })
        // Appended negative — only when the helper folded it in (non-native).
        if (negResult.nativeNegativePrompt == null && resolvedNeg) {
          fragments.push({ text: `\nAvoid: ${resolvedNeg}`, origin: "negative" })
        }
        // Variables resolved from {Node Label} refs in the user prose.
        for (const s of resolveTextRefsSegments(rawUser, refMap)) {
          if (s.origin === "variable" && s.text) fragments.push({ text: s.text, origin: "variable" })
        }
        // Cinematography picker hints folded into the body.
        for (const h of hints) if (h) fragments.push({ text: h, origin: "picker" })
        // Snippet fragments inserted in the user prose.
        for (const sn of promptSnippets) if (sn.text) fragments.push({ text: sn.text, origin: "snippet" })

        const promptSegments = tagPromptProvenance(promptText, fragments)

        // copyText mirrors the field views: the prompt (with the `Avoid:` tail
        // already folded in for the appended routing) plus, for the native
        // routing, the negative on its own line — same convention as the image
        // path's native branch.
        const copyLines: string[] = []
        if (promptText) copyLines.push(promptText)
        if (negResult.nativeNegativePrompt) {
          copyLines.push(`Negative prompt: ${negResult.nativeNegativePrompt}`)
        }
        return {
          promptText,
          cineHints: hints,
          refBlock: mentionPrefix,
          // The negative field's final view shows the RESOLVED negative input in
          // BOTH routings (the caption explains where it goes), exactly like the
          // image path.
          negativeText: resolvedNeg,
          copyText: copyLines.join("\n\n"),
          promptSegments,
          negativeSegments: buildNegativeSegments(resolvedNeg, rawNeg, refMap, negSnippets),
          negativeRouting,
        }
      }
    }

    // Provider-less fallback: legacy manual composition (kept for callers that
    // haven't wired up `provider`). Best-effort preview, not byte-identical to a
    // model payload — but the {variable} + snippet tinting IS exact, and the
    // join-guard below guarantees the tinted spans always reconstruct the flat
    // text (else we drop to `[]` and the view renders plainText verbatim).
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

    // Origin-tagged decomposition mirroring the flat composition above EXACTLY.
    //
    // Body: tint the user prose's {variables} (resolveTextRefsSegments), then
    // append the picker hints + identity-clause spans with the SAME joiners and
    // origins as the provider path's `bodySegs` ("." . " " ", " joiners; hints →
    // "picker", identity clause → "mention"), so their join equals
    // `preBuildPrompt` — the body half of `promptText`.
    const userSegsFlat = resolveTextRefsSegments(rawUser, refMap) as DisplaySegment[]
    const bodySegsFlat: DisplaySegment[] = [...userSegsFlat]
    if (hints.length > 0) {
      if (resolvedUser) bodySegsFlat.push({ text: ". ", origin: "user" })
      hints.forEach((h, i) => {
        if (i > 0) bodySegsFlat.push({ text: ", ", origin: "user" })
        bodySegsFlat.push({ text: h, origin: "picker" })
      })
    }
    if (identityClause) {
      if (bodySegsFlat.length > 0) bodySegsFlat.push({ text: " ", origin: "user" })
      bodySegsFlat.push({ text: identityClause, origin: "mention" })
    }
    // Snippet post-pass over user-origin body spans (matches the provider path;
    // partitioning only — never alters text, so the join is preserved).
    const tintedBody = splitUserSegmentsBySnippets(bodySegsFlat, promptSnippets)

    // Wrap: prepend the reference intro (mirror `${refIntro}\n\n${promptText}`
    // → the prefix string is `refIntro + "\n\n"` when there's a body, else just
    // `refIntro`) as a "mention" span; append the style suffix (mirror
    // `(promptText ? "\n" : "") + "Style: " + styleText`) as a "style" span.
    const bodyText = baseParts.join(". ")
    const promptSegmentsFlat: DisplaySegment[] = []
    if (refIntro) {
      promptSegmentsFlat.push({ text: bodyText ? `${refIntro}\n\n` : refIntro, origin: "mention" })
    }
    if (bodyText) promptSegmentsFlat.push(...tintedBody)
    if (styleText) {
      // `promptText` here is everything before the style suffix (= refIntro-wrap
      // + body). Re-derive whether a newline separator precedes the suffix.
      const beforeStyle = refIntro ? (bodyText ? `${refIntro}\n\n${bodyText}` : refIntro) : bodyText
      promptSegmentsFlat.push({ text: (beforeStyle ? "\n" : "") + `Style: ${styleText}`, origin: "style" })
    }
    // ABSOLUTE join-guard: never ship a decomposition that doesn't reconstruct
    // the displayed text. On any drift, fall back to `[]` (the view renders
    // plainText) — the same discipline as the provider path's bodySegs invariant
    // and `buildNegativeSegments`.
    let promptSegments =
      promptSegmentsFlat.map((s) => s.text).join("") === promptText
        ? promptSegmentsFlat
        : ([] as DisplaySegment[])

    // ── Video-aware negative routing (provider-less, `videoProvider` set) ─────
    // PREDICT what the video provider receives by calling the SAME shared helper
    // the backend pipeline uses (`applyVideoNegativePrompt` — kie/video.ts,
    // payload-builder.ts, extend-video route). Pass-through only: we never
    // re-derive NATIVE_NEGATIVE_VIDEO_PROVIDERS, and we NEVER route the prompt
    // through buildImagePrompt.
    //
    // Composition point: the helper is applied to the FULLY-ASSEMBLED flat
    // `promptText` — AFTER the refIntro prefix and the `Style:` suffix — so the
    // displayed prompt ends with the `Avoid:` tail exactly as the runtime would
    // present it. The backend applies the negative to its resolved prompt as the
    // LAST step (after cinematography hints + identity clause); for video panels
    // (which pass no `style`/`connectedReferences`) this `promptText` equals the
    // backend's `preBuildPrompt`, so the assembled string is byte-identical to
    // what the provider sees. Negative always lands last → faithful regardless.
    let negativeRouting: NegativeRouting = null
    if (videoProvider && resolvedNeg) {
      const videoResult = applyVideoNegativePrompt(promptText, resolvedNeg, videoProvider)
      negativeRouting = videoResult.nativeNegativePrompt ? "native" : "appended"
      // `appended` → the helper returned `<promptText>\nAvoid: <neg>` (or just
      // `Avoid: <neg>` when promptText was empty). Adopt the new prompt and tack
      // a `negative`-origin segment carrying ONLY the appended tail so the
      // existing spans (still reconstructing the OLD promptText) plus the tail
      // reconstruct the NEW promptText. `native` → the helper left the prompt
      // unchanged (negative goes out as a native param), so nothing to append.
      if (!videoResult.nativeNegativePrompt && videoResult.prompt !== undefined) {
        const base = promptText
        const newPrompt = videoResult.prompt
        promptText = newPrompt
        // The tail is everything the helper added past the prior promptText.
        const tail = newPrompt.slice(base.length)
        if (promptSegments.length > 0) {
          const candidate: DisplaySegment[] = [...promptSegments, { text: tail, origin: "negative" }]
          // Re-assert the absolute join-guard against the NEW promptText: keep
          // the tinted decomposition only if it reconstructs the displayed text,
          // else collapse to `[]` (the view renders plainText). Same discipline
          // as everywhere else in this hook.
          promptSegments =
            candidate.map((s) => s.text).join("") === promptText
              ? candidate
              : ([] as DisplaySegment[])
        }
      }
    }

    // copyText mirrors the field views: the prompt (with the `Avoid:` tail folded
    // in for the appended routing — it already rides along in `promptText`) plus,
    // for the native routing, the negative on its own `Negative prompt:` line —
    // the same convention as the provider (image) path's native branch. On the
    // pure provider-less path (no videoProvider) keep the legacy shape: prompt +
    // `Negative prompt:` line whenever a negative exists.
    const copyLines: string[] = []
    if (promptText) copyLines.push(promptText)
    if (resolvedNeg && negativeRouting !== "appended") {
      copyLines.push(`Negative prompt: ${resolvedNeg}`)
    }

    return {
      promptText,
      cineHints: hints,
      refBlock: refIntro,
      negativeText: resolvedNeg,
      copyText: copyLines.join("\n\n"),
      promptSegments,
      // Negative: tint {variables} + snippets over the resolved negative. The
      // join-guard inside buildNegativeSegments collapses to a single plain span
      // if the decomposition can't reconstruct `resolvedNeg` (defensive; the
      // node-refs-segments join-invariant test guarantees equality for the
      // variable layer, and the snippet split only partitions). The resolved
      // negative shows in BOTH video routings (native AND appended) — the caption
      // explains where it goes — exactly like the provider (image) path.
      negativeSegments: buildNegativeSegments(resolvedNeg, rawNeg, refMap, negSnippets),
      // null when no `videoProvider` / no negative; otherwise the PREDICTED video
      // routing (pass-through from the shared helper). Plain provider-less
      // surfaces (text/audio/script/llm-chat/composition) pass no `videoProvider`
      // → stays null (no native/append routing concept).
      negativeRouting,
    }
  }, [userPrompt, style, negativePrompt, consumerNodeId, nodes, edges, provider, videoProvider, connectedReferences, identityMeta, characterDefs, promptSnippets, negSnippets, userPromptTemplates, flowPromptTemplates, characterDefinitions])
}
