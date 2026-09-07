import type { PluginSceneArtifactScope } from "./scene3d-artifact-contract.js"

/** Shared-reader checks on this active job's owned, received artifacts. */
export interface PluginScenePlaybackToolkit {
  inspectGlb(input: PluginSceneArtifactScope & { artifactId: string }, options?: { signal?: AbortSignal }): Promise<{
    animationClipNames: readonly string[]; meshNodeCount: number; triangleCount: number
  }>
  validate(input: PluginSceneArtifactScope & { plan: unknown }, options?: { signal?: AbortSignal }): Promise<{
    warnings: Array<{ code: string; message: string; subject?: string }>
  }>
}
