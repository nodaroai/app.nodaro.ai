import type { ComponentType } from "react"
import type { SceneNodeFrontendData } from "@/types/nodes"

export type SceneViewMode = "default" | "storyboard" | "video" | "scripting"

export interface SceneViewProps {
  data: SceneNodeFrontendData
  selected: boolean
}

export type SceneViewComponent = ComponentType<SceneViewProps>

const registry: Partial<Record<SceneViewMode, SceneViewComponent>> = {}

export function registerSceneView(mode: SceneViewMode, component: SceneViewComponent): void {
  registry[mode] = component
}

export function getSceneView(mode: SceneViewMode): SceneViewComponent | undefined {
  return registry[mode]
}

export function listRegisteredSceneViews(): SceneViewMode[] {
  return Object.keys(registry) as SceneViewMode[]
}

/**
 * Resolve the effective scene-view mode for a SceneNode from its per-node
 * setting, falling back to `"default"` when unset.
 */
export function useActiveSceneViewMode(
  perNodeMode: SceneViewMode | undefined,
): SceneViewMode {
  return perNodeMode ?? "default"
}
