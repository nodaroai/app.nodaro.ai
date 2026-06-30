"use client"

import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { isSunoFieldWired } from "@/components/editor/config-panels/suno-field"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SunoGenerateData } from "@/types/nodes"

/** The three Suno text fields that get the ✨ "Generate with AI" button — the
 *  single source of truth for which fields are AI-capable (title is NOT). Both
 *  mount sites (config panel + field-edit modal) gate on `isSunoAiField` so the
 *  set can't drift between surfaces. */
export const SUNO_AI_FIELDS = ["style", "negativeStyle", "lyrics"] as const
export type SunoAiField = (typeof SUNO_AI_FIELDS)[number]
export function isSunoAiField(field: string): field is SunoAiField {
  return (SUNO_AI_FIELDS as readonly string[]).includes(field)
}

/** ✨ AI for a Suno text field — runs the wizard with the composite
 *  `suno-generate:<field>` target and writes `data[field]`. The backend reshapes
 *  the OUTPUT per field (style/negativeStyle → comma-separated tags;
 *  lyrics → sectioned lyric text). Hidden when the field is wired (read-only).
 *  `nodeId` is explicit so it works from the field-edit modal, not just the
 *  globally-selected node. */
export function SunoFieldAiButton({
  nodeId,
  field,
}: {
  readonly nodeId: string
  readonly field: SunoAiField
}) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const data = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.data) as
    | SunoGenerateData
    | undefined
  // Hide when the field is wired (read-only) — derived from the SHARED
  // `isSunoFieldWired` predicate (edge into `field-<field>` OR a legacy
  // fieldMappings entry), the SAME one `SunoField` uses for its read-only state.
  // A wired field is overridden at run, so an AI write here would be silently
  // discarded (wasted credits). One predicate ⇒ button hides EXACTLY when the
  // field shows read-only. Selector returns a boolean so re-renders only on flip.
  const wired = useWorkflowStore((s) =>
    isSunoFieldWired(
      field,
      s.nodes.find((n) => n.id === nodeId)?.data as SunoGenerateData | undefined,
      s.edges,
      nodeId,
    ),
  )
  if (wired) return null
  return (
    <PromptHelperButton
      nodeType={`suno-generate:${field}`}
      nodeId={nodeId}
      currentPrompt={(data?.[field] as string | undefined) ?? ""}
      size="sm"
      onAccept={(value, modelChange) =>
        updateNodeData(nodeId, {
          [field]: value,
          ...(modelChange && { [modelChange.field]: modelChange.value }),
        })
      }
    />
  )
}
