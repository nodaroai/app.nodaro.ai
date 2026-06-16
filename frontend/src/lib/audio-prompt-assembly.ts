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
  getEffectiveSunoCustomMode,
  truncateForField,
  appendField,
  resolveNodeRefs,
  type SoundConsumerType,
} from "@nodaro/shared"
import { collectAudioStyleHints } from "@/lib/audio-style-hints"

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
      // typed prompt resolves the same way the run's preview path does
      // (resolveTextRefs over data.prompt — no wired/override in a preview).
      const typed = resolveRefs(((data.prompt as string | undefined) ?? "").trim(), refMap)
      const custom = getEffectiveSunoCustomMode(data)
      // In custom mode the style hints fold into the STYLE field, NOT the
      // prompt — so the prompt field shown is just the bare typed prompt.
      if (custom) return typed
      const style = collectAudioStyleHints(node, "suno-generate", nodes, edges)
      return foldStyle(typed, style.text, SUNO_PROMPT_BUDGET)
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
