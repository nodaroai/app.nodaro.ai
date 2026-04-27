import { useCallback } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { GeneratedResult } from "@/types/nodes"

interface UseResultAspectRatioReturn {
  /** Synchronous aspect ratio of the active result, or undefined if not yet measured. */
  readonly aspectRatio: number | undefined
  /** Pass to <CachedImage onLoadDimensions> or use directly with a <video onLoadedMetadata>. */
  readonly onLoadDimensions: (dim: { width: number; height: number }) => void
}

/**
 * Reads the active result's stored width/height to derive aspect ratio
 * synchronously — no side-channel `new Image()` preload that races the
 * src change. Persists captured dimensions back to the result on first
 * render so future result switches are instant.
 *
 * The previous pattern used a separate `useEffect` + `new Image()` which
 * caused two visible glitches:
 *  1. Switching between results with different aspects rendered the new
 *     image at the old node dimensions until the async preload resolved.
 *  2. If the side-channel preload failed (CORS, transient error), the
 *     node never resized and the image stayed cropped until the user
 *     manually clicked Fit Content.
 *
 * The store update is guarded so it only fires once per result.
 */
export function useResultAspectRatio(
  nodeId: string,
  results: readonly GeneratedResult[],
  activeIndex: number,
): UseResultAspectRatioReturn {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const activeResult = results[activeIndex]

  const aspectRatio = activeResult?.width && activeResult?.height
    ? activeResult.width / activeResult.height
    : undefined

  const onLoadDimensions = useCallback(
    ({ width, height, duration }: { width: number; height: number; duration?: number }) => {
      // Re-read state at fire time — `results` in closure may be stale
      // if the user has switched results between mount and load.
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      const data = (node?.data ?? {}) as Record<string, unknown>
      const currentResults = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const currentIndex = (data.activeResultIndex as number | undefined) ?? 0
      const target = currentResults[currentIndex]
      if (!target || target.url !== activeResult?.url) return
      const needsDims = !target.width || !target.height
      const needsDuration = duration !== undefined && target.duration === undefined
      if (!needsDims && !needsDuration) return
      const next = currentResults.map((r, i) =>
        i === currentIndex
          ? {
              ...r,
              ...(needsDims ? { width, height } : {}),
              ...(needsDuration ? { duration } : {}),
            }
          : r,
      )
      updateNodeData(nodeId, { generatedResults: next })
    },
    [nodeId, activeResult?.url, updateNodeData],
  )

  return { aspectRatio, onLoadDimensions }
}
