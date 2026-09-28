"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useWiredSettings } from "@/hooks/use-wired-settings"
import { wiredSettingText } from "@/components/nodes/settings-chips"

/** A field the node's Settings input sets, as its settings panel shows it. */
export interface WiredSettingField {
  /** The wired node's label (the panel localizes it). */
  readonly label: string
  /** The value the node runs with. */
  readonly value: string
  /** A Provider this node cannot run — the run is refused. */
  readonly refused: boolean
}

const WiredSettingsContext = createContext<ReadonlyMap<string, WiredSettingField>>(new Map())

/**
 * Tells every `MappableField` in a node's settings panel which fields a wired
 * Generation Settings node sets, so each shows that node and the value it
 * runs with instead of its own control — without each config component
 * threading the Settings input through its props.
 */
export function WiredSettingsScope({
  nodeId,
  nodeType,
  data,
  children,
}: {
  readonly nodeId: string
  readonly nodeType: string
  readonly data: Record<string, unknown>
  readonly children: ReactNode
}) {
  const view = useWiredSettings(nodeId, nodeType, data)
  const fields = useMemo(
    () =>
      new Map<string, WiredSettingField>(
        view.wired.map((w) => [
          w.field,
          { label: view.labels[w.sourceId] ?? w.sourceType, value: wiredSettingText(w, view.data), refused: view.problem?.sourceId === w.sourceId },
        ]),
      ),
    [view],
  )
  return <WiredSettingsContext.Provider value={fields}>{children}</WiredSettingsContext.Provider>
}

/** The Settings input's hold on `field` in the open panel, if any. */
export function useWiredSettingField(field: string): WiredSettingField | undefined {
  return useContext(WiredSettingsContext).get(field)
}
