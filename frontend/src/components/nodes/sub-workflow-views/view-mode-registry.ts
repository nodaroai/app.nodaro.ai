import type { ComponentType } from "react"
import type { SubWorkflowData } from "@/types/nodes"

export const DEFAULT_VIEW_MODE_ID = "default"

export interface SubWorkflowViewProps {
  readonly nodeId: string
  readonly data: SubWorkflowData
  readonly selected: boolean
}

export interface SubWorkflowViewMode {
  readonly id: string
  readonly label: string
  readonly Component: ComponentType<SubWorkflowViewProps>
  readonly description?: string
}

const registry = new Map<string, SubWorkflowViewMode>()

export function registerSubWorkflowViewMode(mode: SubWorkflowViewMode): void {
  if (registry.has(mode.id)) {
    console.warn(`[sub-workflow] view mode "${mode.id}" registered twice — second registration wins`)
  }
  registry.set(mode.id, mode)
}

export function getSubWorkflowViewMode(id: string | undefined): SubWorkflowViewMode {
  return registry.get(id ?? DEFAULT_VIEW_MODE_ID) ?? registry.get(DEFAULT_VIEW_MODE_ID)!
}

export function listSubWorkflowViewModes(): readonly SubWorkflowViewMode[] {
  return [...registry.values()]
}
