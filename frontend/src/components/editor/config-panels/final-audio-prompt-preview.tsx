"use client"

import { useMemo, type ReactNode } from "react"
import { collectAudioStyleHints, truncateForField, appendField } from "@/lib/audio-style-hints"
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

const FIELD_MAX = {
  "suno-generate-style": 500,
  "suno-generate-prompt": 3000,
  "generate-music": 2000,
  "voice-design": 1000,
  "voice-remix": 1000,
  "text-to-audio": 2000,
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
  const preview = useMemo(() => {
    const consumer = consumerNodeId ? nodes.find((n) => n.id === consumerNodeId) : undefined
    if (!consumer) return null
    const composition = collectAudioStyleHints(consumer, consumerType, nodes, edges)
    if (!composition.text && composition.warnings.length === 0) return null

    let label: string
    let userText: string
    let max: number
    if (consumerType === "suno-generate") {
      const isCustom = !!customMode
      label = isCustom ? "Final style" : "Final prompt"
      userText = isCustom ? (userStyle ?? "") : (userPrompt ?? "")
      max = isCustom ? FIELD_MAX["suno-generate-style"] : FIELD_MAX["suno-generate-prompt"]
    } else if (consumerType === "voice-design") {
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
    return { label, final, warnings: composition.warnings }
  }, [consumerNodeId, consumerType, userPrompt, userStyle, userVoiceDescription, customMode, nodes, edges])

  if (!preview) return null
  return (
    <div className={cn("flex flex-col gap-1.5 p-2 border border-border rounded-md bg-muted/30", className)}>
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
    </div>
  )
}
