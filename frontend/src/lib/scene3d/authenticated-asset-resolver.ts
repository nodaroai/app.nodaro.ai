import { nodaroClient } from "@/lib/nodaro-client"
import type { Scene3DAssetRef } from "@nodaro/shared"
import type { Scene3DAssetResolver } from "@remotion-pkg/scene3d/v2/asset-resolver"
import { createMemoizedAssetResolver } from "./asset-cache"

/** Editor-only: the stateless embed must never import authentication. */
export function createAuthenticatedScene3DAssetResolver(planRevisionId: string): Scene3DAssetResolver {
  return createMemoizedAssetResolver({
    async resolve(ref: Scene3DAssetRef, signal: AbortSignal): Promise<ArrayBuffer> {
      if (ref.kind !== "glb" && ref.kind !== "camera-track-json") {
        throw new Error("This asset is not available to the preview")
      }
      // Every retained revision pins reused bytes too. An origin id is
      // provenance, never a substitute for this revision's access check.
      return nodaroClient.scene3d.assetBytes(planRevisionId, ref, { signal })
    },
  })
}
