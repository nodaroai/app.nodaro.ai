/** Durable scene renders under an already reserved parent operation. */
export interface PluginSceneRenderScope {
  parentJobId: string
  userId: string
  /** Stable within the parent: replay addresses the same child. */
  key: string
}

export interface PluginSceneRenderInput extends PluginSceneRenderScope {
  plan: unknown
  /** `owned-build` reads the active parent's received, unpublished artifacts. */
  assets: "retained-revision" | "owned-build"
  output: { kind: "video" } | { kind: "stills"; frames: number[] }
}

export type PluginSceneRenderResult =
  | { kind: "video"; videoUrl: string; sceneRevisionId: string; elapsedMs: number }
  | { kind: "stills"; sceneRevisionId: string; elapsedMs: number;
      frames: Array<{ frame: number; artifactId: string; sha256: string; byteLength: number }> }

export interface PluginSceneRenderStatus {
  childJobId: string
  state: "pending" | "running" | "completed" | "failed" | "cancelled"
  /** A cancelled DB row is not proof that Chromium has stopped. */
  drained: boolean
  progress: number
  result?: PluginSceneRenderResult
  error?: string
}

export interface PluginSceneRenderingToolkit {
  submit(input: PluginSceneRenderInput, options?: { signal?: AbortSignal }): Promise<{ childJobId: string; adopted: boolean }>
  status(input: PluginSceneRenderScope): Promise<PluginSceneRenderStatus>
  /** Requests cancellation; poll status until drained before releasing the parent stage. */
  cancel(input: PluginSceneRenderScope): Promise<PluginSceneRenderStatus>
}
