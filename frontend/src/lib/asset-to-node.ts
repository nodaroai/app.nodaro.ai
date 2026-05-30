import type { LibraryAsset } from "@/lib/api"
import type { SceneNodeType } from "@/types/nodes"

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
 * each upload node reads only the keys it needs.
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
    },
  }
}
