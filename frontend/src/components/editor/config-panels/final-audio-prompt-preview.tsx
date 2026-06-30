"use client"

import { useMemo, type ReactNode } from "react"
import { collectAudioStyleHints, truncateForField, appendField } from "@/lib/audio-style-hints"
import {
  GENERATE_MUSIC_BUDGET,
  TEXT_TO_AUDIO_BUDGET,
  VOICE_DESC_BUDGET,
  SUNO_PROMPT_BUDGET,
  assembleSunoPreview,
  sunoPreviewFields,
  type SunoPreviewField,
} from "@/lib/audio-prompt-assembly"
import { buildNodeRefMap } from "@/lib/node-refs"
import type { SoundConsumerType } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { cn } from "@/lib/utils"

interface Props {
  readonly consumerNodeId: string | undefined
  readonly consumerType: SoundConsumerType
  readonly userPrompt?: string
  /** Suno only — used in customMode. */
  readonly userStyle?: string
  /** Voice Design only. */
  readonly userVoiceDescription?: string
  /** Suno only — toggles between style (custom) and prompt (non-custom). */
  readonly customMode?: boolean
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  readonly className?: string
}

// suno-generate-style (500) is unique to this component — it gates the STYLE
// field in Suno custom mode, which audio-prompt-assembly.ts does not handle.
const SUNO_STYLE_BUDGET = 500

const FIELD_MAX = {
  "suno-generate-style": SUNO_STYLE_BUDGET,
  "suno-generate-prompt": SUNO_PROMPT_BUDGET,
  "generate-music": GENERATE_MUSIC_BUDGET,
  "voice-design": VOICE_DESC_BUDGET,
  "voice-remix": VOICE_DESC_BUDGET,
  "text-to-audio": TEXT_TO_AUDIO_BUDGET,
} as const

/**
 * Live preview of the byte-identical text the executor will send to the
 * consumer's prompt/style/voiceDescription field. Composes the user value
 * + audio-style hints with the same `truncateForField` + `appendField`
 * helpers the runtime uses, so what the user sees in the panel is what
 * actually goes on the wire.
 *
 * Soft warnings (Voice → Suno, Music → Voice Design, etc.) are surfaced
 * underneath in amber. Renders nothing when there's no audio-style
 * composition AND no warnings.
 *
 * SUNO is special: it is a pass-through of the shared `assembleSunoInput` (the
 * SAME fn the run calls) and renders the FULL field set — prompt + style +
 * lyrics + title + negativeStyle, each as a labeled block — so typed-field edits
 * AND connected pickers are visible. It renders whenever the assembled result
 * has ANY content (a typed field OR a folded picker), not only when a connected
 * picker produced hint text — fixing the empty-preview + invisible-edit bugs.
 */
export function FinalAudioPromptPreview({
  consumerNodeId,
  consumerType,
  userPrompt,
  userStyle,
  userVoiceDescription,
  customMode,
  nodes,
  edges,
  className,
}: Props): ReactNode {
  const preview = useMemo(():
    | { kind: "suno"; fields: SunoPreviewField[] }
    | { kind: "single"; label: string; final: string; warnings: ReadonlyArray<string> }
    | null => {
    const consumer = consumerNodeId ? nodes.find((n) => n.id === consumerNodeId) : undefined
    if (!consumer) return null

    // ── Suno: pass-through of the shared assembler → render EVERY field ──
    if (consumerType === "suno-generate") {
      const refMap = buildNodeRefMap(consumer.id, nodes, edges)
      const result = assembleSunoPreview({ node: consumer, nodes, edges, refMap })
      const fields = sunoPreviewFields(result)
      // Render whenever the assembled result has ANY content — a connected picker
      // OR any typed field. Only a truly-empty node (no typed field, no picker)
      // shows nothing.
      if (fields.length === 0) return null
      return { kind: "suno", fields }
    }

    // ── Other audio types: single folded prompt/voice-description field ──
    const composition = collectAudioStyleHints(consumer, consumerType, nodes, edges)
    if (!composition.text && composition.warnings.length === 0) return null

    let label: string
    let userText: string
    let max: number
    if (consumerType === "voice-design") {
      label = "Final voice description"
      userText = userVoiceDescription ?? ""
      max = FIELD_MAX["voice-design"]
    } else if (consumerType === "voice-remix") {
      label = "Final voice description"
      userText = userVoiceDescription ?? ""
      max = FIELD_MAX["voice-remix"]
    } else if (consumerType === "generate-music") {
      label = "Final prompt"
      userText = userPrompt ?? ""
      max = FIELD_MAX["generate-music"]
    } else {
      label = "Final prompt"
      userText = userPrompt ?? ""
      max = FIELD_MAX["text-to-audio"]
    }
    const composed = truncateForField(composition.text, userText, max)
    const final = appendField(userText, composed)
    return { kind: "single", label, final, warnings: composition.warnings }
  }, [consumerNodeId, consumerType, userPrompt, userStyle, userVoiceDescription, customMode, nodes, edges])

  if (!preview) return null
  return (
    <div className={cn("flex flex-col gap-2 p-2 border border-border rounded-md bg-muted/30", className)}>
      {preview.kind === "suno" ? (
        preview.fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              {f.label}
            </div>
            <pre className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-foreground">
              {f.text}
            </pre>
          </div>
        ))
      ) : (
        <>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            {preview.label}
          </div>
          <pre className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-foreground">
            {preview.final}
          </pre>
          {preview.warnings.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {preview.warnings.map((w, i) => (
                <div key={i} className="text-[10px] text-amber-600 dark:text-amber-400">
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
