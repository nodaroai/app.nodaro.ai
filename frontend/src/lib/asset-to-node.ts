import type { LibraryAsset } from "@/lib/api"
import type { GeneratedResult, SceneNodeType } from "@/types/nodes"

const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)

/**
 * The asset sources whose `metadata.durationSeconds` the server measured from
 * the stored file itself: a file uploaded (`POST /v1/upload`) and a file the
 * media editor processed (`media-process`). Any other source's metadata is not
 * a measurement of the file — `POST /v1/library/save-generated` stores the
 * metadata its caller sends — so its length is never recorded.
 */
const SERVER_MEASURED_UPLOAD_SOURCES: ReadonlySet<string> = new Set(["manual_upload", "media_process"])

/**
 * The result row a VIDEO upload records for its file — the shape
 * `upload-video-node.tsx` writes when a file is uploaded: the file's url, its
 * poster, its size and, when the upload measured it, its length (`duration`).
 * Both engines read an upload's length from exactly this row, and only while
 * it is the file the node hands on (`forwardedVideoLengthSec`,
 * @nodaro/render-rules) — the run estimates, and the length Trim, Loop and
 * Combine Videos are charged by — so a video added from the Library is quoted
 * and charged at its real length, as a fresh upload is. The length is recorded
 * only when the server measured it ({@link SERVER_MEASURED_UPLOAD_SOURCES});
 * any other asset (a generated video's records none, a saved one carries its
 * caller's metadata) records none, and the estimates' fallback stands.
 */
function libraryVideoResultRow(asset: LibraryAsset): GeneratedResult {
  const meta = asset.metadata ?? {}
  const width = positive(meta.width)
  const height = positive(meta.height)
  const duration = SERVER_MEASURED_UPLOAD_SOURCES.has(asset.uploadSource) ? positive(meta.durationSeconds) : undefined
  return {
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl || undefined,
    jobId: `upload-${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...(width !== undefined && height !== undefined ? { width, height } : {}),
    ...(duration !== undefined ? { duration } : {}),
  }
}

/**
 * Map a library media asset to the `upload-*` node type + `initialData` used to
 * drop it on the canvas. Returns null for non-media asset types.
 *
 * Single source of truth for both add-to-canvas paths (the Media Library modal
 * in `workflow-canvas.tsx` and the My Library media tabs in
 * `unified-asset-library.tsx`) so the field mapping can't drift between them.
 *
 * `metadata` is passed through opaquely — its shape varies by media type
 * (image: width/height/format; video: + duration/codec; audio: duration) and
 * each upload node reads only the keys it needs. A video also records the
 * result row a fresh upload records ({@link libraryVideoResultRow}), so its
 * length is read where an upload's is. An audio or image asset is mapped as
 * before: a fresh audio upload records its length in `metadata` only, which is
 * where the audio readers look, and an image has none.
 */
export function assetToUploadNode(
  asset: LibraryAsset,
): { type: SceneNodeType; data: Record<string, unknown> } | null {
  const typeByMedia: Record<string, SceneNodeType> = {
    image: "upload-image",
    video: "upload-video",
    audio: "upload-audio",
  }
  const type = typeByMedia[asset.type]
  if (!type) return null
  return {
    type,
    data: {
      r2Url: asset.url,
      url: asset.url,
      thumbnailUrl: asset.thumbnailUrl ?? undefined,
      filename: asset.filename,
      fileSize: asset.sizeBytes,
      mimeType: asset.mimeType,
      metadata: asset.metadata,
      assetId: asset.id,
      ...(type === "upload-video" ? { generatedResults: [libraryVideoResultRow(asset)], activeResultIndex: 0 } : {}),
    },
  }
}
