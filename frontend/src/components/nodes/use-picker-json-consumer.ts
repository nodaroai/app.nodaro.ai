import { useEffect, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { buildPickerAnalyzerSpec, applyPickerJson, isAnalyzablePicker, type PickerType } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { PickerConsumerData, DescribeToPickerData } from "@/types/nodes"

/** Order-independent canonical change-detection key (was person-injection.ts). */
export function pickerJsonKey(json: Record<string, unknown> | undefined): string {
  if (!json) return ""
  const keys = Object.keys(json).sort()
  return JSON.stringify(keys.map((k) => [k, json[k]]))
}

/** Tolerant read of a producer's `generatedPickerJson`: a multi-section object
 *  yields this picker's own section; a legacy FLAT object (pre-migration saved
 *  data, or a Ctrl+V that bypassed loadWorkflow) is treated as the `person`
 *  section so person never wipes, and non-person pickers get nothing. */
export function extractSection(
  full: Record<string, unknown> | undefined,
  pickerType: PickerType,
): Record<string, unknown> | undefined {
  if (!full) return undefined
  const isMultiSection = Object.keys(full).some((k) => isAnalyzablePicker(k))
  if (isMultiSection) return full[pickerType] as Record<string, unknown> | undefined
  return pickerType === "person" ? full : undefined
}

export interface PickerJsonConsumerState {
  readonly isConnected: boolean
  readonly hasPending: boolean
  readonly apply: () => void
}

/** Generalized describe-to-picker consumer (lifted from person-node.tsx).
 *  Narrow fingerprint subscription to the wired producer; extracts this
 *  picker's section; applies per `applyMode` (manual button or auto). */
export function usePickerJsonConsumer(
  pickerType: PickerType,
  id: string,
  data: PickerConsumerData,
): PickerJsonConsumerState {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const fingerprint = useWorkflowStore(
    useShallow((s) => {
      const edge = s.edges.find((e) => e.target === id && e.targetHandle === "picker-json")
      if (!edge) return ""
      const src = s.nodes.find((n) => n.id === edge.source)
      if (!src) return `${edge.id}\x01${edge.source}`
      return `${edge.id}\x01${src.id}\x01${JSON.stringify(src.data ?? {})}`
    }),
  )

  const injected = useMemo<Record<string, unknown> | undefined>(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const edge = edges.find((e) => e.target === id && e.targetHandle === "picker-json")
    if (!edge) return undefined
    const src = nodes.find((n) => n.id === edge.source)
    const full = (src?.data as DescribeToPickerData | undefined)?.generatedPickerJson
    return extractSection(full, pickerType)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fingerprint, pickerType])

  const spec = useMemo(() => buildPickerAnalyzerSpec(pickerType), [pickerType])
  const isConnected = fingerprint !== ""
  const hasPending =
    !!injected && pickerJsonKey(injected) !== pickerJsonKey(data.lastAppliedPickerJson)
  const mode = data.applyMode ?? "override"

  const apply = () => {
    if (!injected) return
    const patch = applyPickerJson(data as Record<string, unknown>, injected, mode, spec)
    patch.lastAppliedPickerJson = injected
    updateNodeData(id, patch)
  }

  useEffect(() => {
    if (!data.autoApplyInjected || !injected || !hasPending) return
    const patch = applyPickerJson(data as Record<string, unknown>, injected, mode, spec)
    patch.lastAppliedPickerJson = injected
    updateNodeData(id, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected, hasPending, data.autoApplyInjected, mode, id])

  return { isConnected, hasPending, apply }
}
