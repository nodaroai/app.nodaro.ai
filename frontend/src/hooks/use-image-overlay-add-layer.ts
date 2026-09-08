import { useCallback, useState } from "react"
import { toast } from "sonner"
import { uploadFile } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { OVERLAY_HANDLE_IDS, OVERLAY_MAX_LAYERS, visibleOverlayLayerCount, type ImageOverlayData } from "@/types/nodes"

/**
 * "Upload an image as a layer" from inside the compositor. A layer is a WIRE
 * into the node — so the upload becomes a real Upload Image node on the
 * canvas, placed to the left of the overlay node and connected to the next
 * free layer handle. The graph stays the single source of truth: the run,
 * the resolver and the preview all see the same edge.
 */
export function useImageOverlayAddLayer(nodeId: string): { addFromFile: (file: File) => Promise<void>; isUploading: boolean } {
  const { user } = useAuth()
  const [isUploading, setIsUploading] = useState(false)

  const addFromFile = useCallback(
    async (file: File) => {
      const store = useWorkflowStore.getState()
      const target = store.nodes.find((n) => n.id === nodeId)
      if (!target) return
      const wired = new Set(store.edges.filter((e) => e.target === nodeId).map((e) => e.targetHandle ?? "image"))
      const free = (OVERLAY_HANDLE_IDS as readonly string[]).findIndex((h) => !wired.has(h))
      if (free < 0) {
        toast.error(`Image Overlay supports at most ${OVERLAY_MAX_LAYERS} layers`)
        return
      }
      setIsUploading(true)
      try {
        const result = await uploadFile(file, user?.id)
        const meta = result.metadata
        const generatedResult = {
          url: result.url,
          jobId: `upload-${Date.now()}`,
          timestamp: new Date().toISOString(),
          ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
          ...(meta?.width && meta?.height ? { width: meta.width, height: meta.height } : {}),
        }
        const sourceId = store.addNode(
          "upload-image",
          { x: target.position.x - 380, y: target.position.y + free * 60 },
          {
            label: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Layer",
            assetId: result.assetId ?? "",
            url: result.url,
            r2Url: result.url,
            thumbnailUrl: result.thumbnailUrl ?? "",
            filename: result.filename,
            fileSize: result.sizeBytes,
            mimeType: result.mimeType,
            metadata: result.metadata ?? {},
            isUploading: false,
            uploadError: "",
            externalUrl: "",
            generatedResults: [generatedResult],
            activeResultIndex: 0,
          },
        )
        if (!sourceId) return
        store.onConnect({ source: sourceId, sourceHandle: "image", target: nodeId, targetHandle: OVERLAY_HANDLE_IDS[free] })
        // Make sure the node shows the handle the new wire landed on.
        const data = target.data as ImageOverlayData
        const shown = visibleOverlayLayerCount(data.layerCount, Array.isArray(data.layers) ? data.layers.length : 0, 0)
        if (free + 1 > shown) store.updateNodeData(nodeId, { layerCount: free + 1 })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setIsUploading(false)
      }
    },
    [nodeId, user?.id],
  )

  return { addFromFile, isUploading }
}
