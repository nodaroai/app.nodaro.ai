/**
 * Record an image edited in the canvas editor (Filerobot) as a real job with
 * `POST /v1/jobs/from-upload`, so the edit shows in job history and the gallery
 * next to the picture it was made from.
 *
 * Best effort: the edit is already uploaded and placed on the node, so a
 * failure here only costs the record — the caller keeps a local result id.
 */
import { getAuthHeaders } from "@/lib/api"
import type { GeneratedResult } from "@/types/nodes"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ImageEditSource {
  readonly sourceJobId?: string
  readonly sourceImageUrl?: string
  readonly sourceAssetId?: string
}

/**
 * What the edited picture was made from: the job of the node result showing it
 * (a real job id only — local results carry `upload-…` / `image-edit-…` ids),
 * else the upload an Upload Image node holds for that same url.
 */
export function imageEditSource(nodeData: Record<string, unknown> | undefined, editedUrl: string): ImageEditSource {
  if (!nodeData || !editedUrl) return {}
  const results = (nodeData.generatedResults as readonly GeneratedResult[] | undefined) ?? []
  const shown = results.find((r) => r.url === editedUrl && UUID_RE.test(r.jobId))
  if (shown) return { sourceJobId: shown.jobId, sourceImageUrl: editedUrl }
  const assetId = nodeData.assetId
  if (nodeData.url === editedUrl && typeof assetId === "string" && UUID_RE.test(assetId)) {
    return { sourceAssetId: assetId }
  }
  return {}
}

async function postFromUpload(body: Record<string, unknown>): Promise<Response> {
  const headers = await getAuthHeaders()
  return fetch("/v1/jobs/from-upload", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * The recorded job's id, or null when it could not be recorded. A source the
 * server refuses (a job since deleted, an image it no longer lists) is dropped
 * and the edit is recorded on its own rather than not at all.
 */
export async function recordImageEdit(input: {
  readonly assetId: string | null
  readonly source: ImageEditSource
  readonly editStateUrl?: string
}): Promise<string | null> {
  if (!input.assetId) return null
  const base = { assetId: input.assetId, ...(input.editStateUrl ? { editStateUrl: input.editStateUrl } : {}) }
  try {
    const hasSource = Object.keys(input.source).length > 0
    let res = await postFromUpload({ ...base, ...input.source })
    if (hasSource && (res.status === 400 || res.status === 404)) res = await postFromUpload(base)
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { id?: unknown } }
    return typeof json.data?.id === "string" ? json.data.id : null
  } catch {
    return null
  }
}
