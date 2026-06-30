"use client"

import { useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { SunoField, isSunoFieldWired } from "@/components/editor/config-panels/suno-field"
import { SunoFieldAiButton, isSunoAiField } from "./suno-field-ai-button"
import { isPromptEditorPortalInteraction } from "@/components/editor/config-panels/prompt-editor/prompt-editor-portal"
import { usePromptEditorRefs } from "./inline-node-prompt/use-prompt-editor-refs"
import {
  SUNO_FIELD_EDIT_META,
  SunoFieldEditor,
  type SunoEditField,
} from "@/components/editor/config-panels/suno-field-editor"
import type { SunoGenerateData } from "@/types/nodes"

/**
 * Phase C keystone: edit one Suno "secondary" text field (title / lyrics /
 * style / negative-style) in a focused Radix dialog, reusing the EXACT same
 * `SunoFieldEditor` the config panel renders — so caps/counters/tag behavior
 * can never drift between the two surfaces.
 *
 * Two load-bearing reuses:
 *  1. Wrapping the editor in `SunoField` means a wired field is handled for
 *     free: when the field's `field-<field>` canvas handle is connected,
 *     SunoField swaps the editor for a read-only preview and never mounts it.
 *     `wired` is read from the EDGE (the resolver's top precedence), NOT a
 *     manual fieldMappings entry — there is no per-field source dropdown.
 *  2. `onInteractOutside` ignores clicks inside a prompt-editor body portal (the
 *     TagTextarea `@`/`[`/`/` suggestion popups, marked in Task 2) so picking a
 *     suggestion doesn't dismiss the dialog.
 */
export function SunoFieldEditModal({
  nodeId,
  field,
  onClose,
}: {
  readonly nodeId: string
  readonly field: SunoEditField | null
  readonly onClose: () => void
}) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const variableDisplayMode = useWorkflowStore((s) => s.variableDisplayMode)
  const { nodeRefs, refMap } = usePromptEditorRefs(nodeId)

  const data = (nodes.find((n) => n.id === nodeId)?.data ?? {}) as SunoGenerateData

  const onUpdate = useCallback(
    (patch: Partial<SunoGenerateData>) => updateNodeData(nodeId, patch),
    [nodeId, updateNodeData],
  )

  const meta = field ? SUNO_FIELD_EDIT_META[field] : null
  // Wired via the SHARED predicate (edge into the field's handle OR a legacy
  // fieldMappings entry) — the SAME derivation the config panel + AI button use,
  // so this modal's read-only state can never drift from them.
  const wired = !!meta && isSunoFieldWired(meta.field, data, edges, nodeId)

  return (
    <Dialog open={!!field} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="sm:max-w-[560px]"
        onInteractOutside={(e) => { if (isPromptEditorPortalInteraction(e)) e.preventDefault() }}
      >
        {meta && (
          <>
            <DialogHeader>
              <DialogTitle>{meta.label.replace(" (optional)", "")}</DialogTitle>
            </DialogHeader>
            <SunoField
              field={meta.field}
              label={meta.label}
              wired={wired}
              labelAction={isSunoAiField(meta.field) ? <SunoFieldAiButton nodeId={nodeId} field={meta.field} /> : undefined}
            >
              <SunoFieldEditor
                meta={meta}
                data={data}
                onUpdate={onUpdate}
                nodeRefs={nodeRefs}
                refMap={refMap}
                variableDisplayMode={variableDisplayMode}
              />
            </SunoField>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
