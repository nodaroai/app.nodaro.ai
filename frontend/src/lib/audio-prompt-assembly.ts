/**
 * Audio-family prompt assembly — the SHARED composition logic used by BOTH the
 * run path (`execute-node.ts`) and the final-prompt PREVIEW
 * (`use-final-prompt-segments.ts`).
 *
 * Parallel to `video-prompt-assembly.ts`. Previously the audio preview
 * (`final-audio-prompt-preview.tsx`) hand-rolled the user-value + style-hint
 * fold but the COLOURED inline preview hook only showed the resolved user
 * prompt — it OMITTED the audio-style hints (genre / mood / instrumentation /
 * voice-character) that the run FOLDS in from connected audio-style nodes.
 * This module reproduces the run's per-type PROMPT-FIELD composition so the
 * coloured preview matches what the run actually sends.
 *
 * Dependencies are limited to `@nodaro/shared` (pure prompt helpers) and
 * `@/lib/audio-style-hints` / `@/lib/node-refs` / `@/types/nodes` — none import
 * back from `execute-node.ts`, so there is no circular-import risk and the run
 * path is unchanged (it keeps its own inline composition; this is a faithful
 * mirror, not a re-wire).
 *
 * Mirrors `execute-node.ts`'s per-type audio handlers (line ranges current as
 * of this commit — kept here for drift auditability):
 *   - generate-music    handler ~2318-2364 (fold style, budget 2000)
 *   - text-to-audio     handler ~2366-2404 (fold style, budget 2000)
 *   - voice-remix       handler ~2559-2595 (voiceDescription + fold, budget 1000)
 *   - voice-design      handler ~2597-2644 (voiceDescription + fold, budget 1000)
 *   - suno-generate     handler ~2758-2818 (custom → bare typed; else fold, budget 3000)
 *   - suno-cover        handler ~2820-2857 (pass-through, resolved prompt)
 *   - suno-extend       handler ~2859-2893 (pass-through, prompt)
 *   - suno-lyrics       handler ~2895-...  (pass-through, resolved prompt)
 *   - suno-replace-sec. handler ~3137-3165 (pass-through, promptOf → computeNodePrompt)
 *   - suno-style-boost  handler ~3167-...  (pass-through, `content` field)
 *   - suno-upload-extend handler ~3277-... (pass-through, prompt)
 *   - text-to-speech    handler ~3924+     (pass-through, directText when textSource==="direct")
 *   - lip-sync          handler ~3774-3864 (pass-through, prompt)
 *
 * The exact fold shape — `composed = typed ? truncateForField(style.text, typed,
 * BUDGET) : style.text` then `final = typed ? appendField(typed, composed) :
 * style.text-or-composed` — and the per-type char budgets are load-bearing; they
 * must match the run byte-for-byte.
 */

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import {
  computeNodePrompt,
  truncateForField,
  appendField,
  resolveNodeRefs,
  assembleSunoInput,
  type AssembleSunoResult,
  type SoundConsumerType,
} from "@nodaro/shared"
import { collectAudioStyleHints } from "@/lib/audio-style-hints"
// The editor's field-mapping resolver — the SAME wrapper the RUN calls
// (execute-node.ts ~892). Reused here so the Suno preview resolves `field-*`
// canvas edges via the identical upstream-output source (extractNodeOutput /
// getParameterValue), guaranteeing the wired field surfaces in the preview
// exactly as it will at run. No import cycle: the wrapper → execution-graph
// chain never imports back into this module.
import {
  resolveFieldMappings,
  NODE_MAPPABLE_FIELDS,
} from "@/components/editor/workflow-editor/resolve-field-mappings"

/**
 * Resolve `{Node Label}` refs in a typed value, mirroring the frontend
 * `resolveTextRefs` wrapper EXACTLY (empty-guard → shared `resolveNodeRefs`).
 * Uses the shared primitive directly so the arg can stay a `ReadonlyMap` (a
 * preview never mutates the ref map) — `resolveTextRefs` is currently typed
 * `Map<string,string>`, but it only delegates to this same `resolveNodeRefs`.
 */
function resolveRefs(text: string, refMap: ReadonlyMap<string, string>): string {
  if (!text || refMap.size === 0) return text
  return resolveNodeRefs(text, refMap)
}

/**
 * The audio-FAMILY node types whose prompt-field composition `assembleAudioPrompt`
 * reproduces (the task's target set). The preview hook gates its audio branch on
 * THIS set — NOT on `getSnippetMedia(type) === "audio"` alone — because two
 * `media: "audio"` nodes are deliberately OUT of scope:
 *   - `video-sfx`        — a video-domain SFX node that HAS a negative-prompt
 *                          lever; routing it here would drop its negative display.
 *   - `forced-alignment` — its prompt field is `transcript` (not `prompt`), so a
 *                          generic `computeNodePrompt` would read the wrong field.
 * Both keep hitting the provider-less fallback (which handles their negative /
 * transcript correctly). This is the single source of truth for "audio nodes the
 * assembler owns"; the dispatch in {@link assembleAudioPrompt} stays in lockstep.
 */
export const AUDIO_PROMPT_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  // composition-heavy (fold audio-style hints)
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "voice-design",
  "voice-remix",
  // pass-through (resolved field only)
  "text-to-speech",
  "suno-cover",
  "suno-extend",
  "suno-lyrics",
  "suno-replace-section",
  "suno-upload-extend",
  "suno-style-boost",
  "lip-sync",
])

export interface AssembleAudioPromptArgs {
  /** The audio consumer node (its `data` + `id` + `type` drive composition). */
  readonly node: WorkflowNode
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  /**
   * Label→output map for resolving `{Node Label}` variable refs in the typed
   * prompt fields. The PREVIEW passes `{ refMap }` only into `computeNodePrompt`
   * (there is no `wired`/`override` in a preview, unlike the run).
   */
  readonly refMap: ReadonlyMap<string, string>
}

/**
 * The 5 composition-heavy audio node types that FOLD connected audio-style
 * hints (genre / mood / instrumentation / voice-character / voice-delivery)
 * into their prompt field — the exact `SoundConsumerType` members that
 * `collectAudioStyleHints` accepts. All other audio nodes in
 * `AUDIO_PROMPT_NODE_TYPES` are pass-through (resolved field only, no fold).
 */
export const AUDIO_STYLE_FOLD_TYPES: ReadonlySet<SoundConsumerType> = new Set<SoundConsumerType>([
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "voice-design",
  "voice-remix",
])

/** Per-field char budgets the run enforces when folding audio-style hints.
 *  Mirrors the literals in `execute-node.ts`'s audio handlers + Suno's server
 *  caps. Exported so `FinalAudioPromptPreview` can share the same values. */
export const GENERATE_MUSIC_BUDGET = 2000
export const TEXT_TO_AUDIO_BUDGET = 2000
export const VOICE_DESC_BUDGET = 1000
export const SUNO_PROMPT_BUDGET = 3000

/**
 * Fold the audio-style composition text into a user-typed value the SAME way
 * the run does:  `composed = user ? truncateForField(styleText, user, budget) :
 * styleText`, then `final = user ? appendField(user, composed) : styleText`.
 * When `user` is empty the style text stands alone (the run's
 * `composedPrompt`/`finalPrompt` ternaries collapse to `audioStyle.text`).
 */
function foldStyle(user: string, styleText: string, budget: number): string {
  if (!user) return styleText
  const composed = truncateForField(styleText, user, budget)
  return appendField(user, composed)
}

/**
 * Build the PREVIEW's assembled Suno field set — a pass-through of the SHARED
 * `assembleSunoInput` (the SAME fn the FE + BE run call), under the preview's
 * input constraints: no wired/override prompt and no wired persona, `userPrompt`
 * + `lyrics` resolved via the `{Label}` refMap ONLY, and `throwOnEmpty:false`.
 *
 * This is the SINGLE place the editor derives a suno-generate node's preview
 * fields, so the two suno preview surfaces — the multi-field segment string
 * ({@link assembleAudioPrompt}'s suno case) and the standalone
 * `FinalAudioPromptPreview` blocks — stay in lockstep, AND the preview equals
 * the run (modulo the persona/override the preview structurally lacks). The
 * userPrompt/lyrics resolution mirrors `execute-node.ts`'s suno branch: the
 * prompt is trimmed-then-resolved; lyrics is resolved WITHOUT trimming.
 *
 * FIELD-HANDLE RESOLUTION (preview==run): the run rebinds `node.data` via
 * `resolveFieldMappings` BEFORE assembling, so a `field-style`/`field-lyrics`/…
 * edge sets `data.<field> = <upstream output>`. The preview runs the IDENTICAL
 * resolver first (same wrapper, same upstream-output reader) so a handle-wired
 * field surfaces here exactly as it does at run. With no field edges (the typed-
 * field / connected-picker case) the resolver copies `data` through untouched, so
 * those existing previews are unchanged. The preview has no upstream prompt
 * (`inputs.prompt`), so `{}` injection gets `undefined` — a no-op, matching a run
 * with no wired prompt. customMode + userPrompt + lyrics are then read from the
 * RESOLVED data, exactly as `execute-node.ts` reads them off the rebound node.
 */
export function assembleSunoPreview(args: AssembleAudioPromptArgs): AssembleSunoResult {
  const { node, nodes, edges, refMap } = args
  // Resolve `field-*` edges (+ legacy fieldMappings + {} injection) the same way
  // the run does, then assemble off the RESOLVED data — never mutating the input.
  const resolvedData = resolveFieldMappings(
    node.data as Record<string, unknown>,
    nodes,
    undefined, // preview has no upstream prompt → {} injection is a no-op
    NODE_MAPPABLE_FIELDS["suno-generate"] ?? [],
    node.id,
    edges,
  )
  const resolvedNode = { ...node, data: resolvedData } as WorkflowNode
  const userPrompt = resolveRefs(((resolvedData.prompt as string | undefined) ?? "").trim(), refMap)
  const lyrics = resolveRefs((resolvedData.lyrics as string | undefined) ?? "", refMap)
  return assembleSunoInput({
    node: resolvedNode,
    graph: { nodes, edges },
    userPrompt,
    lyrics,
    throwOnEmpty: false,
  })
}

/** One labeled, non-empty field of an assembled Suno result. */
export interface SunoPreviewField {
  readonly key: "prompt" | "style" | "lyrics" | "title" | "negativeStyle"
  readonly label: string
  readonly text: string
}

/**
 * The ordered, non-empty fields of an assembled Suno result, for the multi-field
 * Final preview. SINGLE source of the preview's field vocabulary + order, shared
 * by the segment-view string ({@link formatSunoPreviewText}) and the standalone
 * `FinalAudioPromptPreview` blocks — so the two suno surfaces never drift. Empty
 * fields are omitted, so the preview shows exactly the fields the run would send.
 */
export function sunoPreviewFields(result: AssembleSunoResult): SunoPreviewField[] {
  const out: SunoPreviewField[] = []
  if (result.prompt) out.push({ key: "prompt", label: "Prompt", text: result.prompt })
  if (result.style) out.push({ key: "style", label: "Style", text: result.style })
  if (result.lyrics) out.push({ key: "lyrics", label: "Lyrics", text: result.lyrics })
  if (result.title) out.push({ key: "title", label: "Title", text: result.title })
  if (result.negativeStyle) out.push({ key: "negativeStyle", label: "Negative style", text: result.negativeStyle })
  return out
}

/**
 * Format the assembled Suno result as the multi-field FINAL preview STRING the
 * segment view renders: the prompt body first (unlabeled — it's the main text),
 * then each secondary field as its own `Label: value` block, blank-line
 * separated. Empty fields are omitted. The folded picker hint rides INSIDE
 * `prompt` (non-custom) or `style` (custom) verbatim, so the caller's provenance
 * tagger still colours it wherever it landed.
 */
export function formatSunoPreviewText(result: AssembleSunoResult): string {
  return sunoPreviewFields(result)
    .map((f) => (f.key === "prompt" ? f.text : `${f.label}: ${f.text}`))
    .join("\n\n")
}

/**
 * Reproduce the RUN's audio-prompt PROMPT-FIELD composition EXACTLY for a single
 * audio node, so the final-prompt PREVIEW matches what the run sends to that
 * node's prompt-equivalent field (per `getPromptFields(nodeType)`). Dispatches
 * per `nodeType`. Returns ONLY the composed prompt-field string.
 *
 * Composition-heavy types fold connected audio-style hints (genre / mood /
 * instrumentation / voice-character / voice-delivery) collected via
 * `collectAudioStyleHints`. Pass-through types return just the resolved field.
 *
 * NOTE on the preview vs run delta: the run resolves the typed prompt with
 * `{ wired, override, refMap }`; the preview has no wired/override input, so it
 * passes `{ refMap }` only. For nodes whose prompt is purely user-typed (the
 * normal preview case) this is identical to the run. Unknown / unmapped audio
 * types fall back to the resolved prompt field via `computeNodePrompt`.
 */
export function assembleAudioPrompt(nodeType: string, args: AssembleAudioPromptArgs): string {
  const { node, nodes, edges, refMap } = args
  const data = node.data as Record<string, unknown>

  switch (nodeType) {
    // ── Composition-heavy: fold audio-style hints into the prompt field ──
    case "generate-music": {
      const typed = computeNodePrompt("generate-music", data, { refMap })
      const style = collectAudioStyleHints(node, "generate-music", nodes, edges)
      return foldStyle(typed, style.text, GENERATE_MUSIC_BUDGET)
    }
    case "text-to-audio": {
      const typed = computeNodePrompt("text-to-audio", data, { refMap })
      const style = collectAudioStyleHints(node, "text-to-audio", nodes, edges)
      return foldStyle(typed, style.text, TEXT_TO_AUDIO_BUDGET)
    }
    case "suno-generate": {
      // Pass-through of the shared assembler — the suno preview shows the FULL
      // field set (prompt + style + lyrics + title + negativeStyle), so typed-
      // field edits AND connected pickers are visible (fixes the empty preview +
      // invisible-edit complaints). Unlike the other audio types this returns a
      // MULTI-FIELD labeled string (not just the prompt field); the folded picker
      // hint rides inside prompt (non-custom) or style (custom), so the caller's
      // provenance tagger still colours it. `assembleSunoPreview` resolves the
      // user prompt + lyrics via refMap exactly as the run does.
      return formatSunoPreviewText(assembleSunoPreview({ node, nodes, edges, refMap }))
    }
    case "voice-design":
    case "voice-remix": {
      // The run reads data.voiceDescription RAW-trimmed (NOT ref-resolved),
      // so mirror that exactly — no resolveTextRefs here.
      const userDesc = ((data.voiceDescription as string | undefined) ?? "").trim()
      const style = collectAudioStyleHints(node, nodeType as SoundConsumerType, nodes, edges)
      return foldStyle(userDesc, style.text, VOICE_DESC_BUDGET)
    }

    // ── Pass-through: just the resolved prompt field, no folding ──
    case "suno-style-boost": {
      // `suno-style-boost`'s prompt field is `content`, NOT `prompt`, so
      // computeNodePrompt (which defaults to data.prompt) would read the wrong
      // field — resolve `content` directly.
      return resolveRefs(((data.content as string | undefined) ?? "").trim(), refMap)
    }
    // text-to-speech (computeNodePrompt gates on textSource==="direct" →
    // directText, else ""), suno-cover / suno-extend / suno-lyrics /
    // suno-replace-section / suno-upload-extend / lip-sync (all → data.prompt),
    // and any unknown audio type all resolve via computeNodePrompt.
    default:
      return computeNodePrompt(nodeType, data, { refMap })
  }
}
