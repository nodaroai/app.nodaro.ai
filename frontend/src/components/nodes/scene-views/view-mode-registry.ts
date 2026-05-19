import type { ComponentType } from "react"
import type { SceneNodeFrontendData } from "@/types/nodes"
import { useSceneViewModeStore } from "@/lib/scene-view-mode-store"

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
 * Phase 1C.2 — Resolve the effective scene-view mode for a SceneNode given
 * its per-node setting. The canvas-wide store override wins when set; when
 * `null`, the per-node value wins; when both are absent, falls back to
 * `"default"`. Subscribed via Zustand so toggling the toolbar override
 * re-renders every SceneNode that calls this hook.
 */
export function useActiveSceneViewMode(
  perNodeMode: SceneViewMode | undefined,
): SceneViewMode {
  const canvasWide = useSceneViewModeStore((s) => s.canvasWideMode)
  return canvasWide ?? perNodeMode ?? "default"
}
