import { supabase } from "../../lib/supabase.js"
import { accessAtLeast, workflowAccess } from "../../lib/workflow-access.js"
import { authorizeScene3DRevision } from "./authorize.js"
import { scene3DPlanDigest } from "./publish.js"
import { Scene3DArtifactError } from "./types.js"
import { isScene3DId } from "./object-keys.js"
import type { Scene3DDeliveryPublishInput } from "./delivery-types.js"

export interface Scene3DDeliverySourceBinding {
  sourceOwnerId: string
  sourceWorkflowId: string | null
  sourceJobId: string | null
  sourceContentHash: string | null
}

/** Source authority is canonical; a supplied source job never grants access. */
export async function resolveScene3DDeliverySource(
  input: Scene3DDeliveryPublishInput, planSha256: string,
): Promise<Scene3DDeliverySourceBinding> {
  if (input.source.kind === "retained-revision") {
    const auth = await authorizeScene3DRevision(input.userId, input.revisionId, "playback")
    if (!auth.ok) throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene delivery source is unavailable")
    const source = auth.revision
    if (source.planSha256 !== planSha256 || scene3DPlanDigest(source.plan) !== planSha256
      || (input.source.jobId !== undefined && input.source.jobId !== source.sourceJobId)) {
      throw new Scene3DArtifactError("SCENE_REVISION_CONFLICT", "Scene delivery source does not match the rendered revision")
    }
    if (input.mode === "authored" && source.sourceJobId !== input.jobId) {
      throw new Scene3DArtifactError("SCENE_REVISION_CONFLICT", "The parent did not author this scene revision")
    }
    const hash = (source.plan as { provenance?: { contentHash?: unknown } })?.provenance?.contentHash
    return {
      sourceOwnerId: source.userId, sourceWorkflowId: source.workflowId, sourceJobId: source.sourceJobId,
      sourceContentHash: typeof hash === "string" ? hash : null,
    }
  }

  if (input.mode !== "render-only" || !isScene3DId(input.source.jobId ?? "")) {
    throw new Scene3DArtifactError("SCENE_JOB_INVALID", "A Basic scene export requires its source job")
  }
  const { data, error } = await supabase.from("jobs").select("id,user_id,workflow_id,status,output_data")
    .eq("id", input.source.jobId!).eq("user_id", input.userId).maybeSingle()
  if (error) throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Could not read the scene delivery source")
  if (!data || data.status !== "completed") {
    throw new Scene3DArtifactError("SCENE_JOB_INVALID", "Scene delivery source job is unavailable")
  }
  const workflowId: string | null = data.workflow_id ?? null
  if (workflowId && !accessAtLeast(await workflowAccess(input.userId, workflowId), "view")) {
    throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene delivery source is unavailable")
  }
  const plan = (data.output_data as { scenePlan?: unknown } | null)?.scenePlan
  if (!plan || (plan as { schemaVersion?: unknown }).schemaVersion !== 1
    || (plan as { revisionId?: unknown }).revisionId !== input.revisionId || scene3DPlanDigest(plan) !== planSha256) {
    throw new Scene3DArtifactError("SCENE_REVISION_CONFLICT", "Basic scene export does not match its retained job output")
  }
  return { sourceOwnerId: input.userId, sourceWorkflowId: workflowId, sourceJobId: data.id, sourceContentHash: null }
}
