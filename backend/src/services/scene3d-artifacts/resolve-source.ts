import { computeScene3DPlanV2ContentHash, scene3DAnyPlanSchema } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { accessAtLeast, workflowAccess } from "../../lib/workflow-access.js"
import type { PluginSceneSourceRequest, PluginSceneSource } from "../../lib/private-plugins/scene3d-source-contract.js"
import { scene3DRevisionAccess } from "./authorize.js"
import { loadScene3DRevision } from "./db.js"
import { isScene3DId } from "./object-keys.js"
import { scene3DPlanDigest } from "./publish.js"
import { Scene3DArtifactError } from "./types.js"

function missing(): never { throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene source is unavailable") }
function mismatch(): never { throw new Scene3DArtifactError("SCENE_REVISION_CONFLICT", "Scene source does not match the requested revision") }

/** A retained revision takes precedence; an inaccessible one never falls back to job history. */
export async function resolveScene3DSource(input: PluginSceneSourceRequest): Promise<PluginSceneSource> {
  if (![input.userId, input.revisionId].every(isScene3DId)
    || (input.sourceJobId !== undefined && !isScene3DId(input.sourceJobId))) missing()
  if (!["view", "edit"].includes(input.requiredAccess)) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Invalid scene source access requirement")
  }
  const revision = await loadScene3DRevision(input.revisionId)
  if (revision) {
    const access = await scene3DRevisionAccess(input.userId, revision)
    if (access === "none" || !accessAtLeast(access, input.requiredAccess)) missing()
    if (input.sourceJobId !== undefined && input.sourceJobId !== revision.sourceJobId) mismatch()
    const parsed = scene3DAnyPlanSchema.safeParse(revision.plan)
    if (!parsed.success || parsed.data.revisionId !== input.revisionId
      || scene3DPlanDigest(revision.plan) !== revision.planSha256) mismatch()
    let contentHash: string | null = null
    if (parsed.data.schemaVersion === 2) {
      contentHash = parsed.data.provenance.contentHash
      if (await computeScene3DPlanV2ContentHash(parsed.data) !== contentHash) mismatch()
    }
    return { kind: "retained-revision", revisionId: revision.revisionId, ownerId: revision.userId,
      workflowId: revision.workflowId, sourceJobId: revision.sourceJobId, plan: structuredClone(revision.plan),
      planSha256: revision.planSha256, contentHash, access }
  }
  if (!input.sourceJobId) missing()
  const { data, error } = await supabase.from("jobs").select("id,user_id,status,workflow_id,output_data")
    .eq("id", input.sourceJobId).eq("user_id", input.userId).maybeSingle()
  if (error) throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Could not resolve the scene source")
  if (!data || data.status !== "completed") missing()
  const workflowId: string | null = data.workflow_id ?? null
  const access = workflowId ? await workflowAccess(input.userId, workflowId) : "own"
  if (access === "none" || !accessAtLeast(access, input.requiredAccess)) missing()
  const plan = (data.output_data as Record<string, unknown> | null)?.scenePlan
  const parsed = scene3DAnyPlanSchema.safeParse(plan)
  // v2 geometry needs its retained revision and pins. A job ID cannot restore deleted access.
  if (!parsed.success || parsed.data.schemaVersion !== 1 || parsed.data.revisionId !== input.revisionId) mismatch()
  return { kind: "job-output", revisionId: input.revisionId, ownerId: input.userId,
    workflowId, sourceJobId: data.id, plan: structuredClone(plan), planSha256: scene3DPlanDigest(plan),
    contentHash: null, access }
}
