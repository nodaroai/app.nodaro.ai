/**
 * Phase 1C.2 — Canvas-wide Scene View Mode override.
 *
 * Per spec §6.9.4: SceneNodes have a per-node `view_mode` field that the
 * `scene-views/view-mode-registry` consumes to render the matching view
 * component (default / storyboard / video / scripting). With many scenes on
 * the canvas the per-node toggle becomes unwieldy, so the canvas toolbar
 * ships a "Scene View Modes" toggle group that overrides every SceneNode at
 * once.
 *
 * Override semantics:
 *   - When `canvasWideMode` is `null`, the per-node `view_mode` wins
 *     (preserves the legacy single-node UX).
 *   - When set, every SceneNode renders that mode regardless of its
 *     per-node value. Clicking the active button clears the override.
 *
 * This is UI-only state — it's not persisted to the workflow document or
 * the user profile (matches the "Follow build" / sidebar-visible pattern).
 * Reloading the canvas drops the override back to `null`.
 */

import { create } from "zustand"
import type { SceneViewMode } from "@/components/nodes/scene-views/view-mode-registry"

interface SceneViewModeState {
  /** Active canvas-wide override, or `null` when per-node toggles win. */
  readonly canvasWideMode: SceneViewMode | null
  /** Set or clear the override. Pass `null` to return to per-node mode. */
  setCanvasWideMode: (mode: SceneViewMode | null) => void
}

export const useSceneViewModeStore = create<SceneViewModeState>((set) => ({
  canvasWideMode: null,
  setCanvasWideMode: (canvasWideMode) => set({ canvasWideMode }),
}))
