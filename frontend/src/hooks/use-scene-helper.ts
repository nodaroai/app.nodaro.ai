import { useState, useCallback } from "react"
import type { SceneHelperName } from "@nodaro/shared"
import type { SceneHelperBody, SceneHelperResult } from "@/lib/pipelines-api"
import { pipelinesApi } from "@/lib/pipelines-api"

/**
 * §6.11 Scene-Context helper state machine.
 *
 * Lifecycle:
 *  - idle: no helper has been invoked (no modal shown)
 *  - loading: a helper is in-flight (modal shown with spinner)
 *  - ready: helper returned successfully (modal shown with result + Accept/Reject)
 *  - error: helper threw (modal shown with error + Close)
 *
 * The `ready` slot is a discriminated union over {@link SceneHelperName}, so
 * the modal can `switch (state.name)` and TypeScript narrows `state.result`
 * to the matching `SceneHelperResult[N]` — no casts.
 *
 * `pipelineId` / `sceneEntityId` may be undefined transiently (e.g. while
 * the SceneNode is loading); invoke is a no-op until both are present.
 */

// Distributive mapping over SceneHelperName produces one ready-variant per
// helper. Equivalent to `{ status: "ready"; name: "audit_prompt"; result: AuditPromptResult } | … | …`.
type SceneHelperReadyState = {
  [N in keyof SceneHelperResult]: {
    status: "ready"
    name: N
    result: SceneHelperResult[N]
  }
}[keyof SceneHelperResult]

export type SceneHelperState =
  | { status: "idle" }
  | { status: "loading"; name: SceneHelperName }
  | SceneHelperReadyState
  | { status: "error"; name: SceneHelperName; message: string }

export function useSceneHelper(
  pipelineId: string | undefined,
  sceneEntityId: string | undefined,
) {
  const [state, setState] = useState<SceneHelperState>({ status: "idle" })

  const invoke = useCallback(
    async <N extends keyof SceneHelperBody>(name: N, body: SceneHelperBody[N]) => {
      if (!pipelineId || !sceneEntityId) return
      setState({ status: "loading", name })
      try {
        const result = await pipelinesApi.runSceneHelper(
          pipelineId,
          sceneEntityId,
          name,
          body,
        )
        // The `{ status: "ready", name, result }` object is a valid member of
        // SceneHelperReadyState for the inferred N, but TS can't narrow across
        // the generic boundary — assert via the union to drop the cast in
        // every consumer.
        setState({ status: "ready", name, result } as SceneHelperReadyState)
      } catch (err) {
        setState({
          status: "error",
          name,
          message: err instanceof Error ? err.message : "unknown error",
        })
      }
    },
    [pipelineId, sceneEntityId],
  )

  const reset = useCallback(() => setState({ status: "idle" }), [])

  return { state, invoke, reset }
}
