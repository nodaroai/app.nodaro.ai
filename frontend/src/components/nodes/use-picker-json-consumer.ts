import { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  buildPickerAnalyzerSpec,
  applyPickerJson,
  isAnalyzablePicker,
  type PickerAnalyzerSpec,
  type PickerApplyMode,
  type PickerType,
} from "@nodaro/prompts"
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

/** Empty in any spelling (unset, null, "", []) reads as one value, so a
 *  cleared field and a field the injection leaves unset are not a difference. */
function fieldKey(v: unknown): string {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return ""
  return JSON.stringify(v)
}

/** True when applying `injected` now would change any of the node's fields —
 *  the node no longer matches its upstream, whether the upstream moved or the
 *  user edited the picker by hand since the last apply. Judged by the apply
 *  itself, so each mode answers by its own rule (fill-empty never counts a
 *  hand-filled field as out of date, because applying would not touch it). */
export function wouldApplyChange(
  data: Record<string, unknown>,
  injected: Record<string, unknown>,
  mode: PickerApplyMode,
  spec: PickerAnalyzerSpec,
): boolean {
  const patch = applyPickerJson(data, injected, mode, spec)
  return Object.keys(patch).some((k) => fieldKey(patch[k]) !== fieldKey(data[k]))
}

export interface PickerJsonConsumerState {
  readonly isConnected: boolean
  readonly hasPending: boolean
  /** The header's Update / Up to date button: always in manual mode; under
   *  auto-sync only when a hand edit left the node off its upstream. */
  readonly showSyncButton: boolean
  readonly apply: () => void
}

/** Auto-sync is the default: only an explicit `false` keeps a picker manual. */
export function isAutoSync(data: PickerConsumerData): boolean {
  return data.autoApplyInjected !== false
}

/** Generalized describe-to-picker consumer (lifted from person-node.tsx).
 *  Narrow fingerprint subscription to the wired producer; extracts this
 *  picker's section; applies per `applyMode` — automatically when the upstream
 *  changes (the default), or from the header button. */
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
  const mode = data.applyMode ?? "override"
  const autoSync = isAutoSync(data)
  // What the picker counts as already synced. A picker that has never applied
  // anything takes what is injected when it first renders as its baseline:
  // pickers saved before auto-sync was the default were set by hand next to an
  // analysis they never applied, and opening the workflow must not replace
  // their values (or write anything at all). Held in state, not written to the
  // node, so opening a workflow leaves it clean.
  const [baselineKey] = useState(() =>
    data.lastAppliedPickerJson === undefined ? pickerJsonKey(injected) : "",
  )
  const syncedKey =
    data.lastAppliedPickerJson === undefined ? baselineKey : pickerJsonKey(data.lastAppliedPickerJson)
  // Upstream moved since the last sync — the only trigger for auto-apply, so a
  // hand edit is never reverted under the user.
  const upstreamChanged = !!injected && pickerJsonKey(injected) !== syncedKey
  // The button also offers a sync after a hand edit: comparing the injected
  // JSON with the last applied one alone said "Up to date" while the node's
  // fields no longer matched it.
  const hasPending =
    upstreamChanged ||
    (!!injected && wouldApplyChange(data as Record<string, unknown>, injected, mode, spec))

  const apply = () => {
    if (!injected) return
    const patch = applyPickerJson(data as Record<string, unknown>, injected, mode, spec)
    patch.lastAppliedPickerJson = injected
    updateNodeData(id, patch)
  }

  useEffect(() => {
    if (!autoSync || !injected || !upstreamChanged) return
    const patch = applyPickerJson(data as Record<string, unknown>, injected, mode, spec)
    patch.lastAppliedPickerJson = injected
    updateNodeData(id, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected, upstreamChanged, autoSync, mode, id])

  return { isConnected, hasPending, showSyncButton: isConnected && (!autoSync || hasPending), apply }
}
