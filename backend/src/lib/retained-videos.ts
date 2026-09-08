import { createHash } from "node:crypto"
import { probeRetainedVideo } from "./retained-video-probe.js"
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { config, hasCredits } from "./config.js"
import { deploymentPayerActive } from "./deployment-payer.js"
import { supabase } from "./supabase.js"
import { isStorageConfigured, withObjectAcl, readR2Object, r2Url, s3 } from "./storage.js"
import { retainedVideoKey } from "./retained-image-keys.js"
import { applyUploadPolicies, UploadBlockedError } from "./upload-policy.js"

const MAX_BYTES = 500 * 1024 * 1024
const WRITE_TIMEOUT_MS = 30_000
interface RetainedVideoRow {
  id: string; user_id: string; workflow_id: string; sha256: string; byte_length: number
  width: number; height: number; duration_ms: number; content_type: string; state: "creating" | "ready"; upload_until: string
}

export interface RetainedVideo {
  assetId: string; contentHash: string; url: string; width: number; height: number; durationMs: number; byteLength: number
}

function view(row: RetainedVideoRow): RetainedVideo {
  return { assetId: row.id, contentHash: row.sha256, url: r2Url(retainedVideoKey(row.id)), width: row.width, height: row.height, durationMs: row.duration_ms, byteLength: Number(row.byte_length) }
}
function digest(body: Buffer): string { return createHash("sha256").update(body).digest("hex") }

/** The service receives already-authorized bytes, never a URL to fetch with
 * storage credentials. Callers must authorize the source and workflow first. */
export async function retainVideo(args: { userId: string; workflowId: string; body: Buffer }): Promise<RetainedVideo> {
  if (!isStorageConfigured()) throw new Error("Retained video storage is not configured")
  if (!args.body.length || args.body.length > MAX_BYTES) throw new Error("Video exceeds the retained storage limit")
  const body = Buffer.from(args.body)
  const meta = await probeRetainedVideo(body)
  const contentType = meta.contentType
  const decision = await applyUploadPolicies({ kind: "video", lane: "retained-video", mime: contentType,
    sizeBytes: body.length, userId: args.userId, buffer: body })
  if (!decision.allow) throw new UploadBlockedError(decision)
  const sha256 = digest(body)
  const { data, error } = await supabase.rpc("reserve_retained_video", {
    p_user_id: args.userId, p_workflow_id: args.workflowId, p_sha256: sha256, p_byte_length: body.length,
    p_width: meta.width, p_height: meta.height, p_duration_ms: meta.durationMs, p_content_type: contentType,
    p_quota_mode: !hasCredits() ? "none" : deploymentPayerActive() ? "track" : "enforce",
  })
  if (error || !data) throw new Error(error?.message === "Storage limit exceeded" ? "Storage limit exceeded" : "Failed to reserve retained video")
  const row = data as unknown as RetainedVideoRow
  const key = retainedVideoKey(row.id)
  if (row.state === "ready") {
    await verifyBytes(row)
    return view(row)
  }
  // Cleanup waits until upload_until + 2 minutes. No writer may START within
  // 30 seconds of that deadline, and the SDK aborts all retries after 30s.
  if (Date.parse(row.upload_until) - Date.now() <= WRITE_TIMEOUT_MS) throw new Error("Video capture expired; retry after cleanup")
  try {
    await s3.send(new PutObjectCommand(withObjectAcl({ Bucket: config.R2_BUCKET_NAME, Key: key,
      Body: body, ContentType: contentType, IfNoneMatch: "*",
    })), { abortSignal: AbortSignal.timeout(WRITE_TIMEOUT_MS) })
  } catch (error) {
    // A concurrent capture of identical bytes can win the conditional write.
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error
  }
  await verifyBytes(row)
  const completed = await supabase.rpc("complete_retained_video", { p_id: row.id, p_sha256: sha256 })
  if (completed.error || completed.data !== true) throw new Error("The production changed while retaining its video")
  return view(row)
}

async function verifyBytes(row: RetainedVideoRow): Promise<Buffer> {
  const stored = await readR2Object(retainedVideoKey(row.id), { maxBytes: MAX_BYTES })
  if (!stored || stored.body.length !== Number(row.byte_length) || digest(stored.body) !== row.sha256) {
    throw new Error("Retained video bytes are unavailable or changed")
  }
  return stored.body
}

/** A caller authorized to the workflow can read its snapshots, including those
 * captured by a collaborator. A pin from another workflow never resolves. */
export async function readRetainedVideo(workflowId: string, assetId: string): Promise<RetainedVideo | null> {
  const row = await retainedRow(workflowId, assetId)
  if (!row) return null
  await verifyBytes(row)
  return view(row)
}

async function retainedRow(workflowId: string, assetId: string): Promise<RetainedVideoRow | null> {
  try { retainedVideoKey(assetId) } catch { return null }
  const { data, error } = await supabase.from("retained_videos")
    .select("id,user_id,workflow_id,sha256,byte_length,width,height,duration_ms,content_type,state,upload_until")
    .eq("id", assetId).eq("workflow_id", workflowId).eq("state", "ready").maybeSingle()
  if (error) throw new Error("Failed to read retained video")
  if (!data) return null
  return data as unknown as RetainedVideoRow
}

/** Authorize source read and destination edit access before calling. Copies
 * verified bytes into the destination's independent retention/quota lifetime.
 * A byte copy does not transfer job provenance, review or execution authority. */
export async function copyRetainedVideo(args: {
  userId: string; sourceWorkflowId: string; workflowId: string; assetId: string
}): Promise<RetainedVideo | null> {
  const row = await retainedRow(args.sourceWorkflowId, args.assetId)
  if (!row) return null
  // The object key comes solely from the workflow-scoped row. No client URL
  // or storage key is accepted, and the copied bytes are the verified bytes.
  const body = await verifyBytes(row)
  if (args.sourceWorkflowId === args.workflowId) return view(row)
  const video = await retainVideo({ userId: args.userId, workflowId: args.workflowId, body })
  if (video.contentHash !== row.sha256 || video.width !== row.width || video.height !== row.height || video.durationMs !== row.duration_ms || video.byteLength !== Number(row.byte_length)) {
    throw new Error("The copied video does not match its retained source")
  }
  return video
}

/** Only durable tombstones reach the exceptional physical-delete lane. */
export async function collectRetainedVideos(): Promise<{ deleted: number; failed: number }> {
  const { data, error } = await supabase.rpc("claim_retained_video_gc", { p_limit: 50 })
  if (error) throw new Error("Failed to claim retained video cleanup")
  let deleted = 0, failed = 0
  for (const task of (data ?? []) as Array<{ id: string }>) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: retainedVideoKey(task.id) }))
      const completed = await supabase.rpc("complete_retained_video_gc", { p_id: task.id })
      if (completed.error || completed.data !== true) throw new Error("Cleanup was not recorded")
      deleted += 1
    } catch { failed += 1 }
  }
  return { deleted, failed }
}
