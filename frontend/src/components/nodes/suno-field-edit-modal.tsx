"use client"

import { useMemo, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MappableField } from "@/components/editor/config-panels/mappable-field"
import { getConnectedSources } from "@/components/editor/config-panels/helpers"
import { isPromptEditorPortalInteraction } from "@/components/editor/config-panels/prompt-editor/prompt-editor-portal"
import { usePromptEditorRefs } from "./inline-node-prompt/use-prompt-editor-refs"
import {
  SUNO_FIELD_EDIT_META,
  SunoFieldEditor,
  type SunoEditField,
} from "@/components/editor/config-panels/suno-field-editor"
import type { SunoGenerateData, FieldMappings } from "@/types/nodes"

/**
 * Phase C keystone: edit one Suno "secondary" text field (title / lyrics /
 * style / negative-style) in a focused Radix dialog, reusing the EXACT same
 * `SunoFieldEditor` the config panel renders — so caps/counters/tag behavior
 * can never drift between the two surfaces.
 *
 * Two load-bearing reuses:
 *  1. Wrapping the editor in `MappableField` (fed the REAL connected sources +
 *     fieldMappings) means a wired field is handled for free: MappableField
 *     swaps the editor for a read-only preview and never mounts it.
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
  const sources = useMemo(() => getConnectedSources(nodeId, edges, nodes), [nodeId, edges, nodes])
  const fieldMappings = (data.fieldMappings as FieldMappings) ?? {}

  const onUpdate = useCallback(
    (patch: Partial<SunoGenerateData>) => updateNodeData(nodeId, patch),
    [nodeId, updateNodeData],
  )
  const onMapField = useCallback(
    (f: string, sourceNodeId: string | null) => {
      const current = { ...((data.fieldMappings as FieldMappings) ?? {}) }
      if (sourceNodeId === null) {
        const { [f]: _drop, ...rest } = current
        updateNodeData(nodeId, { fieldMappings: rest })
      } else {
        updateNodeData(nodeId, { fieldMappings: { ...current, [f]: { sourceNodeId } } })
      }
    },
    [data.fieldMappings, nodeId, updateNodeData],
  )

  const meta = field ? SUNO_FIELD_EDIT_META[field] : null

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
            <MappableField
              field={meta.field}
              label={meta.label}
              sources={sources}
              fieldMappings={fieldMappings}
              onMapField={onMapField}
            >
              <SunoFieldEditor
                meta={meta}
                data={data}
                onUpdate={onUpdate}
                nodeRefs={nodeRefs}
                refMap={refMap}
                variableDisplayMode={variableDisplayMode}
              />
            </MappableField>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
