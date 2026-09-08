import { createHash } from "node:crypto"
import sharp from "sharp"
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { config, hasCredits } from "./config.js"
import { deploymentPayerActive } from "./deployment-payer.js"
import { supabase } from "./supabase.js"
import { isStorageConfigured, withObjectAcl, readR2Object, r2Url, s3 } from "./storage.js"
import { retainedImageKey } from "./retained-image-keys.js"
import { applyUploadPolicies, UploadBlockedError } from "./upload-policy.js"

const MAX_BYTES = 25 * 1024 * 1024
const WRITE_TIMEOUT_MS = 30_000
interface RetainedImageRow {
  id: string; user_id: string; workflow_id: string; sha256: string; byte_length: number
  width: number; height: number; content_type: string; state: "creating" | "ready"; upload_until: string
}

export interface RetainedImage {
  assetId: string; contentHash: string; url: string; width: number; height: number
}

function view(row: RetainedImageRow): RetainedImage {
  return { assetId: row.id, contentHash: row.sha256, url: r2Url(retainedImageKey(row.id)), width: row.width, height: row.height }
}
function digest(body: Buffer): string { return createHash("sha256").update(body).digest("hex") }

/** The service receives already-authorized bytes, never a URL to fetch with
 * storage credentials. Callers must authorize the source and workflow first. */
export async function retainImage(args: { userId: string; workflowId: string; body: Buffer }): Promise<RetainedImage> {
  if (!isStorageConfigured()) throw new Error("Retained image storage is not configured")
  if (!args.body.length || args.body.length > MAX_BYTES) throw new Error("Image exceeds the retained storage limit")
  let body: Buffer = Buffer.from(args.body)
  let meta = await sharp(body, { limitInputPixels: 100_000_000 }).metadata()
  if ((meta.pages ?? 1) > 1) throw new Error("Retained frames must be still images")
  if ((meta.orientation ?? 1) !== 1 || meta.format === "heif") {
    body = await sharp(body, { limitInputPixels: 100_000_000 }).rotate().png().toBuffer()
    meta = await sharp(body).metadata()
  }
  const contentType = ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[meta.format ?? ""]
  if (!contentType || !meta.width || !meta.height || body.length > MAX_BYTES) throw new Error("Unsupported retained image")
  const decision = await applyUploadPolicies({ kind: "image", lane: "retained-image", mime: contentType,
    sizeBytes: body.length, userId: args.userId, buffer: body })
  if (!decision.allow) throw new UploadBlockedError(decision)
  const sha256 = digest(body)
  const { data, error } = await supabase.rpc("reserve_retained_image", {
    p_user_id: args.userId, p_workflow_id: args.workflowId, p_sha256: sha256, p_byte_length: body.length,
    p_width: meta.width, p_height: meta.height, p_content_type: contentType,
    p_quota_mode: !hasCredits() ? "none" : deploymentPayerActive() ? "track" : "enforce",
  })
  if (error || !data) throw new Error(error?.message === "Storage limit exceeded" ? "Storage limit exceeded" : "Failed to reserve retained image")
  const row = data as unknown as RetainedImageRow
  const key = retainedImageKey(row.id)
  if (row.state === "ready") {
    await verifyBytes(row)
    return view(row)
  }
  // Cleanup waits until upload_until + 2 minutes. No writer may START within
  // 30 seconds of that deadline, and the SDK aborts all retries after 30s.
  if (Date.parse(row.upload_until) - Date.now() <= WRITE_TIMEOUT_MS) throw new Error("Image capture expired; retry after cleanup")
  try {
    await s3.send(new PutObjectCommand(withObjectAcl({ Bucket: config.R2_BUCKET_NAME, Key: key,
      Body: body, ContentType: contentType, IfNoneMatch: "*",
    })), { abortSignal: AbortSignal.timeout(WRITE_TIMEOUT_MS) })
  } catch (error) {
    // A concurrent capture of identical bytes can win the conditional write.
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error
  }
  await verifyBytes(row)
  const completed = await supabase.rpc("complete_retained_image", { p_id: row.id, p_sha256: sha256 })
  if (completed.error || completed.data !== true) throw new Error("The production changed while retaining its image")
  return view(row)
}

async function verifyBytes(row: RetainedImageRow): Promise<Buffer> {
  const stored = await readR2Object(retainedImageKey(row.id), { maxBytes: MAX_BYTES })
  if (!stored || stored.body.length !== Number(row.byte_length) || digest(stored.body) !== row.sha256) {
    throw new Error("Retained image bytes are unavailable or changed")
  }
  return stored.body
}

/** A caller authorized to the workflow can read its snapshots, including those
 * captured by a collaborator. A pin from another workflow never resolves. */
export async function readRetainedImage(workflowId: string, assetId: string): Promise<RetainedImage | null> {
  const row = await retainedRow(workflowId, assetId)
  if (!row) return null
  await verifyBytes(row)
  return view(row)
}

async function retainedRow(workflowId: string, assetId: string): Promise<RetainedImageRow | null> {
  try { retainedImageKey(assetId) } catch { return null }
  const { data, error } = await supabase.from("retained_images")
    .select("id,user_id,workflow_id,sha256,byte_length,width,height,content_type,state,upload_until")
    .eq("id", assetId).eq("workflow_id", workflowId).eq("state", "ready").maybeSingle()
  if (error) throw new Error("Failed to read retained image")
  if (!data) return null
  return data as unknown as RetainedImageRow
}

/** Authorize source read and destination edit access before calling. Copies
 * verified bytes into the destination's independent retention/quota lifetime.
 * A byte copy does not transfer job provenance, review or execution authority. */
export async function copyRetainedImage(args: {
  userId: string; sourceWorkflowId: string; workflowId: string; assetId: string
}): Promise<RetainedImage | null> {
  const row = await retainedRow(args.sourceWorkflowId, args.assetId)
  if (!row) return null
  // The object key comes solely from the workflow-scoped row. No client URL
  // or storage key is accepted, and the copied bytes are the verified bytes.
  const body = await verifyBytes(row)
  if (args.sourceWorkflowId === args.workflowId) return view(row)
  const image = await retainImage({ userId: args.userId, workflowId: args.workflowId, body })
  if (image.contentHash !== row.sha256 || image.width !== row.width || image.height !== row.height) {
    throw new Error("The copied image does not match its retained source")
  }
  return image
}

/** Only durable tombstones reach the exceptional physical-delete lane. */
export async function collectRetainedImages(): Promise<{ deleted: number; failed: number }> {
  const { data, error } = await supabase.rpc("claim_retained_image_gc", { p_limit: 50 })
  if (error) throw new Error("Failed to claim retained image cleanup")
  let deleted = 0, failed = 0
  for (const task of (data ?? []) as Array<{ id: string }>) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: retainedImageKey(task.id) }))
      const completed = await supabase.rpc("complete_retained_image_gc", { p_id: task.id })
      if (completed.error || completed.data !== true) throw new Error("Cleanup was not recorded")
      deleted += 1
    } catch { failed += 1 }
  }
  return { deleted, failed }
}
