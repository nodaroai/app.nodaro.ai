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

const PIN_COLUMNS = "artifact_id,artifact_owner_id,usage,via_revision_id"
const SHOT_STILL_COLUMNS = ",shot_index,frame,width,height"
/**
 * Whether this database has migration 417's shot-still columns yet.
 *
 * Code reaches staging on every `dev` merge, but migrations reach the shared
 * database only from the `migrate` job on `main` — a window of days in which
 * asking for a column that does not exist yet would 500 EVERY delivery read,
 * not just the ones with stills. So the first such failure downgrades the
 * read, permanently for the process, and the stills simply read as absent.
 * Delete this once 417 is applied in production.
 */
let hasShotStillColumns = true

interface Scene3DDeliveryPinRow {
  artifact_id: string
  artifact_owner_id: string
  usage: Scene3DArtifactUsage
  via_revision_id: string | null
  shot_index?: number | null
  frame?: number | null
  width?: number | null
  height?: number | null
}

async function readDeliveryPins(jobId: string, columns: string):
  Promise<{ rows: Scene3DDeliveryPinRow[]; code: string | null }> {
  const { data, error } = await supabase.from("scene3d_delivery_artifacts").select(columns).eq("job_id", jobId)
  return {
    rows: (data ?? []) as unknown as Scene3DDeliveryPinRow[],
    code: error ? ((error as { code?: string }).code ?? "unknown") : null,
  }
}

/** Read through this delivery's pins, preserving each artifact's actual owner. */
export async function loadScene3DDeliveryArtifacts(jobId: string): Promise<Scene3DDeliveryArtifact[]> {
  let read = await readDeliveryPins(jobId, hasShotStillColumns ? PIN_COLUMNS + SHOT_STILL_COLUMNS : PIN_COLUMNS)
  if (read.code === "42703" && hasShotStillColumns) {
    hasShotStillColumns = false
    read = await readDeliveryPins(jobId, PIN_COLUMNS)
  }
  if (read.code) throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Could not read scene delivery assets")
  const pins = read.rows
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
  const { data, error } = await supabase.rpc("scene3d_publish_delivery", { payload })
  if (error) throw error
  if (data !== "created" && data !== "unchanged") {
    throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Scene delivery publication returned no result")
  }
  return data
}
