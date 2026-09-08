import { supabase } from "../supabase.js"
import { hasCredits } from "../config.js"
import { insertInternalJob } from "../insert-job.js"
import { cancelOwnedJob } from "../cancel-job.js"
import { renderQueue } from "../render-queue.js"
import { authorizeScene3DJob, createScene3DArtifactToolkit } from "./scene3d-artifact-toolkit.js"
import { authorizeScene3DRenderPlan } from "../../workers/scene3d-render-assets.js"
import { validateSceneRenderRequest, validateSceneRenderResult } from "./scene3d-render-identity.js"
import type { PluginSceneRenderInput } from "./scene3d-render-contract.js"
import type { SceneRenderChild, SceneRenderPorts } from "./scene3d-render-toolkit.js"

const SOURCE = "scene-render-child"
const SELECT = "id,user_id,parent_job_id,status,input_data,output_data,error_message,source_detail,usage_log_id,should_watermark"

async function read(childJobId: string): Promise<SceneRenderChild | null> {
  // tenant-scope-ignore: internal queue lookup; validate the scope-derived ID below, then callers authorize its parent and owner before use.
  const { data, error } = await supabase.from("jobs").select(SELECT).eq("id", childJobId).maybeSingle()
  if (error) throw new Error("Could not read scene render child")
  if (!data) return null
  if (data.source_detail !== SOURCE || data.usage_log_id !== null || !data.input_data?.sceneRender) {
    throw new Error("Scene render child record is invalid")
  }
  const request = await validateSceneRenderRequest(data.input_data.sceneRender as PluginSceneRenderInput)
  if (request.childJobId !== childJobId || request.inputHash !== data.input_data.sceneRenderInputHash ||
      request.input.userId !== data.user_id || request.input.parentJobId !== data.parent_job_id) {
    throw new Error("Scene render child input has changed")
  }
  return { id: data.id, userId: data.user_id, parentJobId: data.parent_job_id,
    input: request.input, inputHash: request.inputHash, status: data.status, shouldWatermark: data.should_watermark !== false,
    ...(data.status === "completed" ? { result: validateSceneRenderResult(data.output_data?.sceneRenderResult, request.input) } : {}) }
}

/** Host-only persistence/queue adapter. Nothing in a public request selects this lane. */
export function createSceneRenderPorts(): SceneRenderPorts {
  return {
    async parent(scope) {
      const { data, error } = await supabase.from("jobs").select("user_id,status,stop_requested_at,usage_log_id")
        .eq("id", scope.parentJobId).eq("user_id", scope.userId).maybeSingle()
      if (error) throw new Error("Could not read scene render parent")
      if (!data) return null
      if (["pending", "processing"].includes(data.status)) {
        await authorizeScene3DJob({ jobId: scope.parentJobId, userId: scope.userId })
      }
      let reservationActive = !hasCredits()
      if (hasCredits() && data.usage_log_id) {
        const { data: hold, error: holdError } = await supabase.from("usage_logs").select("status")
          .eq("id", data.usage_log_id).eq("job_id", scope.parentJobId).eq("user_id", scope.userId).maybeSingle()
        if (holdError) throw new Error("Could not verify scene render reservation")
        reservationActive = hold?.status === "reserved"
      }
      return { userId: data.user_id, status: data.status, stopRequested: Boolean(data.stop_requested_at), reservationActive }
    },
    read,
    async create(request) {
      const { input, childJobId, inputHash } = request
      const { data: parent, error } = await supabase.from("jobs")
        .select("workflow_id,workflow_execution_id,workspace_id,org_id,mcp_client,should_watermark")
        .eq("id", input.parentJobId).eq("user_id", input.userId).in("status", ["pending", "processing"]).maybeSingle()
      if (error || !parent) throw new Error("Scene render parent is unavailable")
      const inserted = await insertInternalJob(SOURCE, {
        ...parent, id: childJobId, user_id: input.userId, parent_job_id: input.parentJobId,
        status: "pending", force_private: true, usage_log_id: null,
        input_data: { type: "render-video", mode: "scene-child", sceneRender: input, sceneRenderInputHash: inputHash },
      })
      // Resolve an uncertain insert by the same unique child ID; never overwrite a winner.
      const child = await read(childJobId)
      if (!child) throw new Error(inserted.error ? "Could not create scene render child" : "Scene render child was not retained")
      return child
    },
    async authorizeAssets(input, signal) {
      signal?.throwIfAborted()
      await authorizeScene3DJob({ jobId: input.parentJobId, userId: input.userId })
      if (input.plan.schemaVersion === 1) return
      if (input.assets === "retained-revision") {
        await authorizeScene3DRenderPlan(input.userId, input.plan)
      } else {
        const artifacts = createScene3DArtifactToolkit()
        if (!artifacts) throw new Error("Scene private storage is unavailable")
        for (const asset of input.plan.assets) {
          if (asset.kind !== "glb" && asset.kind !== "camera-track-json") continue
          signal?.throwIfAborted()
          const receipt = await artifacts.receive({ jobId: input.parentJobId, userId: input.userId,
            revisionId: input.plan.revisionId, artifactId: asset.assetId })
          if (receipt.kind !== asset.kind || receipt.sha256 !== asset.sha256 || receipt.byteLength !== asset.byteLength) {
            throw new Error("Scene render artifact differs from its owned receipt")
          }
        }
      }
      signal?.throwIfAborted()
    },
    async enqueue(child) {
      await renderQueue.add("scene-render-child", { jobId: child.id, sceneRenderChild: true },
        { jobId: child.id, attempts: 4, backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { age: 604800, count: 10000 }, removeOnFail: { age: 604800, count: 10000 } })
    },
    async queue(childJobId) {
      const job = await renderQueue.getJob(childJobId)
      if (!job) return null
      return { state: await job.getState(), progress: typeof job.progress === "number" && Number.isFinite(job.progress) ? job.progress : 0 }
    },
    async cancel(child) {
      await cancelOwnedJob(child.id, child.userId)
      const queued = await renderQueue.getJob(child.id)
      if (queued && await queued.getState() !== "active") {
        // A concurrent worker acquisition makes remove() refuse the lock. Its cancellation
        // poll then closes Chromium; callers still need a drained status before continuing.
        await queued.remove().catch(() => undefined)
      }
    },
  }
}
