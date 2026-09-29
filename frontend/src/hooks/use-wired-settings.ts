import { useMemo } from "react"
import { connectedSettingsSources, getParameterValue, resolveWiredSettings, type SettingsInputProblem, type WiredSetting } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export interface WiredSettingsView {
  /** The node's data as it runs: each wired setting written in and fitted to the model. */
  readonly data: Record<string, unknown>
  readonly wired: readonly WiredSetting[]
  readonly problem?: SettingsInputProblem
  /** Each wired node's label, by id. */
  readonly labels: Readonly<Record<string, string>>
}

const NO_WIRED_SETTINGS = ""

/**
 * Each field a wired setting sets → the (localized) label of the node that
 * sets it — what a run strip or panel shows beside the fixed control. A
 * prompt-clause setting (Motion) sets no field, so it has no entry.
 */
export function wiredFieldSources(
  view: WiredSettingsView | undefined,
  localizeNode: (label: string) => string,
): ReadonlyMap<string, string> {
  return new Map(
    (view?.wired ?? []).flatMap((w) =>
      w.field ? [[w.field, localizeNode(view?.labels[w.sourceId] ?? w.sourceType)] as const] : [],
    ),
  )
}

/**
 * What a node with a Settings input runs with, for its chips, its run strip
 * and its price — the same `resolveWiredSettings` the workflow estimate and
 * both run engines go through. The store subscription is a string of what is
 * wired and the values it holds, so an unrelated node or edge change does not
 * re-render the node.
 */
export function useWiredSettings(nodeId: string, nodeType: string, data: Record<string, unknown>): WiredSettingsView {
  const key = useWorkflowStore((s) => {
    const typeOf = (id: string) => s.nodes.find((n) => n.id === id)?.type
    const connected = connectedSettingsSources(nodeId, nodeType, s.edges, typeOf)
    if (connected.length === 0) return NO_WIRED_SETTINGS
    return connected
      .map((c) => {
        const source = s.nodes.find((n) => n.id === c.sourceId)
        const sourceData = (source?.data ?? {}) as Record<string, unknown>
        return JSON.stringify([c.sourceId, c.sourceType, getParameterValue(sourceData, c.sourceType), sourceData.label])
      })
      .join("|")
  })

  return useMemo(() => {
    if (key === NO_WIRED_SETTINGS) return { data, wired: [], labels: {} }
    const { nodes, edges } = useWorkflowStore.getState()
    const resolved = resolveWiredSettings(nodeId, nodeType, data, nodes, edges)
    const labels = Object.fromEntries(
      resolved.wired.map((w) => {
        const label = (nodes.find((n) => n.id === w.sourceId)?.data as { label?: unknown } | undefined)?.label
        return [w.sourceId, typeof label === "string" && label ? label : w.sourceType]
      }),
    )
    return { ...resolved, labels }
    // `key` carries every wired value and label this reads from the store.
  }, [key, data, nodeId, nodeType])
}
