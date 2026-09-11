import { supabase } from "../../lib/supabase.js"
import { loadScene3DArtifactsByIds } from "./db.js"
import { Scene3DArtifactError, type Scene3DArtifactUsage } from "./types.js"
import type { Scene3DDeliveryRecord, Scene3DDeliveryArtifact } from "./delivery-types.js"

const COLUMNS = "job_id,user_id,workflow_id,source_kind,source_revision_id,source_plan_sha256,source_content_hash,source_job_id,source_owner_id,source_workflow_id,mode,created_at"

export async function loadScene3DDelivery(jobId: string): Promise<Scene3DDeliveryRecord | null> {
  const { data, error } = await supabase.from("scene3d_deliveries").select(COLUMNS).eq("job_id", jobId).maybeSingle()
  if (error) throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Could not read scene delivery")
  if (!data) return null
  return {
    jobId: data.job_id, userId: data.user_id, workflowId: data.workflow_id,
    sourceKind: data.source_kind, sourceRevisionId: data.source_revision_id,
    sourcePlanSha256: data.source_plan_sha256, sourceContentHash: data.source_content_hash,
    sourceJobId: data.source_job_id, sourceOwnerId: data.source_owner_id,
    sourceWorkflowId: data.source_workflow_id, mode: data.mode, createdAt: data.created_at,
  }
}

const PIN_COLUMNS = "artifact_id,artifact_owner_id,usage,via_revision_id,shot_index,frame,width,height"

interface Scene3DDeliveryPinRow {
  artifact_id: string
  artifact_owner_id: string
  usage: Scene3DArtifactUsage
  via_revision_id: string | null
  shot_index: number | null
  frame: number | null
  width: number | null
  height: number | null
}

/** Read through this delivery's pins, preserving each artifact's actual owner. */
export async function loadScene3DDeliveryArtifacts(jobId: string): Promise<Scene3DDeliveryArtifact[]> {
  const { data, error } = await supabase.from("scene3d_delivery_artifacts").select(PIN_COLUMNS).eq("job_id", jobId)
  if (error) throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Could not read scene delivery assets")
  const pins = (data ?? []) as unknown as Scene3DDeliveryPinRow[]
  const artifacts = await loadScene3DArtifactsByIds(pins.map((pin) => pin.artifact_id))
  const byId = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]))
  return pins.flatMap((pin) => {
    const artifact = byId.get(pin.artifact_id)
    return artifact && artifact.userId === pin.artifact_owner_id
      ? [{
          ...artifact, usage: pin.usage, viaRevisionId: pin.via_revision_id,
          shotIndex: pin.shot_index ?? null, frame: pin.frame ?? null,
          width: pin.width ?? null, height: pin.height ?? null,
        }]
      : []
  })
}

export async function callScene3DPublishDelivery(payload: Record<string, unknown>): Promise<"created" | "unchanged"> {
  return callDeliveryRpc("scene3d_publish_delivery", payload)
}

/**
 * The refused lane has its OWN function, deliberately.
 *
 * `scene3d_publish_delivery` settles deliveries that follow a paid render, and its
 * plan/poster/revision rules are what keep that honest. Widening them with a branch would
 * relax them for every caller; a separate function repeats only the structural guards — the
 * parent row lock, the owner match, the active-job requirement and the exact-replay
 * comparison — and shares none of the evidence rules.
 */
export async function callScene3DPublishRefusedDelivery(payload: Record<string, unknown>): Promise<"created" | "unchanged"> {
  return callDeliveryRpc("scene3d_publish_refused_delivery", payload)
}

async function callDeliveryRpc(fn: string, payload: Record<string, unknown>): Promise<"created" | "unchanged"> {
  const { data, error } = await supabase.rpc(fn, { payload })
  if (error) throw error
  if (data !== "created" && data !== "unchanged") {
    throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Scene delivery publication returned no result")
  }
  return data
}
