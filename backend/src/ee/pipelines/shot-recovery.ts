import type { SupabaseClient } from "@supabase/supabase-js"
import type { FastifyReply } from "fastify"
import type { VideoCriticShotFields } from "@nodaro/shared"

/**
 * Phase 1D.2c-b-ii §9 (J1) — shared prologue for the per-shot recovery routes
 * (`skip-video-critic-failure` + `retry-video-generation`).
 *
 * Both routes do the same 4-step lookup:
 *   1. Confirm ownership of the pipeline row (existence-leak → 404).
 *   2. Load the scene entity scoped to `entity_type='scene'`.
 *   3. Walk `metadata.scene_node_data.shots[N]` to locate the target shot.
 *   4. Gate on `shot.video_critic_failed === true` (the critic terminally
 *      marked this shot; any other state means recovery is a no-op).
 *
 * On any failure the helper writes the appropriate error response to `reply`
 * and returns null — the caller `return`s without further work. Successful
 * lookups return the loaded context (scene entity, the freshly-parsed scene
 * data, the shot index for the per-route mutation, and the shot itself).
 */

/** Subset of the scene entity row the recovery routes need. */
export interface FailedShotSceneEntity {
  id: string
  metadata: Record<string, unknown> | null
}

/** Subset of the scene_node_data blob the recovery routes need.
 *  Pass-1 lifted `video_critic_failed?: boolean` into a shared
 *  `VideoCriticShotFields` interface; pass-2 makes this site use it directly
 *  so the writer (Stage 7) + readers (Skip/Retry routes) can't drift. */
export interface FailedShotSceneData {
  shots: Array<
    {
      shot_id: string
      [key: string]: unknown
    } & VideoCriticShotFields
  >
}

export interface FailedShotLoadResult {
  sceneEntity: FailedShotSceneEntity
  sceneData: FailedShotSceneData
  shotIndex: number
  shot: FailedShotSceneData["shots"][number]
}

export interface LoadFailedShotArgs {
  pipelineId: string
  sceneId: string
  shotId: string
  userId: string
}

/**
 * Validates ownership + locates a shot in the `video_critic_failed=true`
 * state. Returns null after writing the appropriate error response, or the
 * loaded context on success. The caller must `return` after a null return
 * (the response has already been sent).
 *
 * Error mapping:
 *   - 404 `not_found`                         — pipeline missing or wrong user
 *   - 404 `scene_not_found`                   — scene entity missing
 *   - 404 `shot_not_found`                    — shot id not in scene_node_data.shots
 *   - 409 `shot_not_video_critic_failed`      — shot exists but flag is false/undef
 */
export async function loadFailedShotOrError(
  supabase: SupabaseClient,
  reply: FastifyReply,
  args: LoadFailedShotArgs,
): Promise<FailedShotLoadResult | null> {
  const { pipelineId, sceneId, shotId, userId } = args

  // 1. Ownership check on the parent pipeline row (existence-leak prevention —
  // cross-user lookups return 404, not 403).
  const { data: owner } = await supabase
    .from("pipelines")
    .select("user_id")
    .eq("id", pipelineId)
    .maybeSingle()
  if (!owner || owner.user_id !== userId) {
    void reply.status(404).send({ error: { code: "not_found" } })
    return null
  }

  // 2. Load the scene entity (must be of type 'scene', scoped to this pipeline).
  const { data: sceneEntity } = await supabase
    .from("pipeline_entities")
    .select("id, metadata")
    .eq("id", sceneId)
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .maybeSingle()
  if (!sceneEntity) {
    void reply.status(404).send({ error: { code: "scene_not_found" } })
    return null
  }
  const sceneMetadata = (sceneEntity.metadata ?? {}) as Record<string, unknown>
  const sceneData = sceneMetadata.scene_node_data as
    | { shots?: Array<Record<string, unknown>> }
    | undefined
  if (!sceneData?.shots) {
    void reply.status(404).send({ error: { code: "shot_not_found" } })
    return null
  }

  // 3. Walk shots[N] to locate the target shot.
  const shotIndex = sceneData.shots.findIndex(
    (s) => (s as { shot_id?: string }).shot_id === shotId,
  )
  if (shotIndex === -1) {
    void reply.status(404).send({ error: { code: "shot_not_found" } })
    return null
  }
  const shot = sceneData.shots[shotIndex]! as FailedShotSceneData["shots"][number]

  // 4. Gate on video_critic_failed === true.
  if (shot.video_critic_failed !== true) {
    void reply.status(409).send({ error: { code: "shot_not_video_critic_failed" } })
    return null
  }

  return {
    sceneEntity: {
      id: sceneEntity.id as string,
      metadata: sceneMetadata,
    },
    sceneData: { shots: sceneData.shots as FailedShotSceneData["shots"] },
    shotIndex,
    shot,
  }
}

/**
 * /simplify pass-2 — shared tail for the per-shot recovery routes (Skip +
 * Retry). Both routes do the same 3-step finisher after their per-mutation
 * logic:
 *   a. Build `updatedMetadata = { ...sceneEntity.metadata, scene_node_data: { ...sceneData, shots: nextShots } }`
 *   b. `pipeline_entities.update({ metadata })` (db_error → 500)
 *   c. Emit `shot:status` SSE with `status: "approved"`
 *
 * Routes contribute the per-mutation closure (Skip: flip flag; Retry: strip
 * critic keys); the helper handles everything else. Returns true on success
 * (the helper already replied 200), false on DB failure (the helper already
 * replied 500). The caller `return`s either way.
 *
 * Mirrors {@link loadFailedShotOrError}'s "reply + return null" idiom so the
 * route handlers stay shaped the same in both prologue + finisher.
 */
export interface ApplyShotMutationArgs {
  supabase: SupabaseClient
  reply: FastifyReply
  pipelineId: string
  sceneEntity: FailedShotSceneEntity
  sceneData: FailedShotSceneData
  shotIndex: number
  shotId: string
  sceneId: string
  /**
   * Per-route mutator. Skip flips `video_critic_failed: false`; Retry strips
   * every `video_critic_*` key (via `clearVideoCriticMetadata`). Return type
   * is widened to `Record<string, unknown>` so callers using
   * `clearVideoCriticMetadata` (which returns `Omit<T, VideoCriticMetadataKey>`)
   * don't need a cast at the call site — the open-object shape of
   * `FailedShotSceneData.shots[N]` already mirrors that semantic.
   */
  shotMutator: (
    shot: FailedShotSceneData["shots"][number],
  ) => Record<string, unknown>
  /**
   * Optional post-UPDATE side-effect that runs AFTER a successful metadata
   * write but BEFORE the SSE + 200 reply. Used by the Retry route to
   * `enqueuePipelineRun` so the orchestrator picks up the freshly-cleared
   * shot. Skip leaves this undefined (no orchestrator re-entry needed).
   *
   * Throwing here aborts the SSE + reply path; the caller should already
   * have a try/catch around the route handler if it cares about that. The
   * normal failure path is the helper's own db_error 500 (which fires before
   * this callback ever runs).
   */
  onAfterUpdate?: () => Promise<void>
}

export async function applyShotMutationAndEmit(
  args: ApplyShotMutationArgs,
): Promise<boolean> {
  const {
    supabase,
    reply,
    pipelineId,
    sceneEntity,
    sceneData,
    shotIndex,
    shotId,
    sceneId,
    shotMutator,
    onAfterUpdate,
  } = args

  // a. Build the next-state metadata immutably so a partial commit can't
  //    smuggle stale shots into the in-memory view downstream of the route.
  //    The cast on the mutator result is structural — `FailedShotSceneData.shots[N]`
  //    is an open object (`[k: string]: unknown`) so a stripped/spread variant
  //    still satisfies the shape; we only need the cast because the mutator's
  //    return type is intentionally widened (see `shotMutator` doc).
  const updatedShots = sceneData.shots.map((s, i) =>
    i === shotIndex
      ? (shotMutator(s) as FailedShotSceneData["shots"][number])
      : s,
  )
  const updatedMetadata = {
    ...(sceneEntity.metadata ?? {}),
    scene_node_data: { ...sceneData, shots: updatedShots },
  }

  // b. Persist. db_error → 500 + the helper already replied (caller returns).
  const { error: updateError } = await supabase
    .from("pipeline_entities")
    .update({ metadata: updatedMetadata })
    .eq("id", sceneId)
    .eq("pipeline_id", pipelineId)
  if (updateError) {
    void reply
      .status(500)
      .send({ error: { code: "db_error", detail: updateError.message } })
    return false
  }

  // c. Optional post-UPDATE side-effect (Retry: re-enqueue orchestrator).
  //    Runs BEFORE the SSE + reply so a synchronous enqueue failure surfaces
  //    in the caller's try/catch (route handlers catch and 500 by default).
  if (onAfterUpdate) await onAfterUpdate()

  // d. SSE — per-shot UI subscribes to `shot:status` and flips the badge
  //    without a refetch. Both Skip + Retry use `approved` as the sentinel
  //    (Retry triggers a fresh Stage 7 attempt; the UI re-reads scene data
  //    to pick up the absence of the `video_critic_*` fields).
  const { pipelineEvents } = await import("./events.js")
  pipelineEvents.publish({
    type: "shot:status",
    pipelineId,
    sceneId,
    shotId,
    status: "approved",
  })

  void reply.send({ ok: true })
  return true
}
