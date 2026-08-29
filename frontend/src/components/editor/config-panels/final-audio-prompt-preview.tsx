"use client"

import { useMemo, type ReactNode } from "react"
import { collectAudioStyleHints } from "@/lib/audio-style-hints"
import {
  assembleAudioPrompt,
  assembleSunoPreview,
  sunoPreviewFields,
  type SunoPreviewField,
} from "@/lib/audio-prompt-assembly"
import { buildNodeRefMap } from "@/lib/node-refs"
import type { SoundConsumerType } from "@nodaro/prompts"
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

/**
 * Live preview of the byte-identical text the executor will send to the
 * consumer's prompt/style/voiceDescription field.
 *
 * PASS-THROUGH, NOT A COPY: every branch delegates to the shared audio
 * assembler (`@/lib/audio-prompt-assembly`) — `assembleSunoPreview` for
 * suno-generate, `assembleAudioPrompt` for the rest — which is the SAME
 * composer the coloured segments Final view uses and a faithful mirror of the
 * run's per-type composition (typed-field resolution → pre/post text →
 * audio-style fold, at the run's char budgets). This box used to hand-roll the
 * user-value + style-hint fold off its raw props, which silently dropped the
 * node's pre/post text (`promptPrefix` / `promptSuffix`): the box showed the
 * bare typed prompt while the segments view above it — and the run — showed
 * the wrapped one. Composing here again is how that drift happens, so don't:
 * per-type budgets, the fold shape and the affix wrap all live in the assembler.
 *
 * Soft warnings (Voice → Suno, Music → Voice Design, etc.) are surfaced
 * underneath in amber. Renders nothing when there's no audio-style
 * composition AND no warnings.
 *
 * SUNO is special: it renders the FULL field set — prompt + style + lyrics +
 * title + negativeStyle, each as a labeled block — so typed-field edits AND
 * connected pickers are visible. It renders whenever the assembled result has
 * ANY content (a typed field OR a folded picker), not only when a connected
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
    // The hints are collected here for the WARNINGS + the render guard only; the
    // text itself is composed by the shared assembler, which folds the very same
    // composition at the run's budget.
    const composition = collectAudioStyleHints(consumer, consumerType, nodes, edges)
    if (!composition.text && composition.warnings.length === 0) return null

    const label =
      consumerType === "voice-design" || consumerType === "voice-remix"
        ? "Final voice description"
        : "Final prompt"
    // Built only once we know we're rendering: this memo reruns on every render
    // of every audio config panel, and `buildNodeRefMap` is a full-graph walk
    // with no empty-graph short-circuit (unlike `collectAudioStyleHints`). Same
    // refMap the run builds — it resolves `{Node Label}` refs in the typed
    // fields AND in the pre/post text.
    const refMap = buildNodeRefMap(consumer.id, nodes, edges)
    const final = assembleAudioPrompt(consumerType, { node: consumer, nodes, edges, refMap })
    return { kind: "single", label, final, warnings: composition.warnings }
    // The typed values are read off the consumer node's `data` (via the shared
    // assembler), not off these props — but they stay in the deps so a keystroke
    // recomputes the preview even if the `nodes` array is referentially stable.
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
