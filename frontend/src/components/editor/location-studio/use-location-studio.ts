import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getCachedUserId } from "@/hooks/use-auth"
import {
  ConcurrentModificationError,
  getLocationById,
  saveLocation,
} from "@/lib/api"
import { useInvalidateLocation } from "@/hooks/queries/use-invalidate-location"
import type { LocationNodeData } from "@/types/nodes"

/**
 * Location Studio — staged state hook.
 *
 * Mirrors the character-studio precedent in shape but uses an explicit Save
 * button (PR-1 scope; auto-save can land in PR-2). The hook:
 *  - Deep-copies node data into a local `stagedData` so edits never leak into
 *    the workflow store until `saveStaged()` lands. Dirty tracking is a
 *    JSON-equality diff against the live canvas node.
 *  - On `saveStaged()`, calls `saveLocation()` with optimistic-concurrency
 *    token; on success mirrors the staged data back into the workflow store
 *    (so the canvas summary updates) and invalidates the React Query asset
 *    list so the library tab refreshes.
 *  - On 409 (`ConcurrentModificationError`) re-fetches the canonical row via
 *    `getLocationById` and re-stages it so the user can re-apply edits over
 *    fresh state instead of clobbering the concurrent writer.
 *  - `ensureSavedBeforeGen()` is the Q-8 "first-generate" path: if there's
 *    no `locationDbId`, save first so the worker can attach the produced
 *    asset back to the row when the job completes.
 */
export interface LocationStudioState {
  /** Deep copy of the canvas node data, locally edited via `patch`. Null when
   *  the workflow store hasn't seeded the node yet (cold-load). */
  stagedData: LocationNodeData | null
  /** Diff-equality against the live canvas node. */
  isDirty: boolean
  /** True while a save (POST /v1/locations) is in flight. */
  isSaving: boolean
  /** True while approve-main-image is in flight — gates Generate to prevent
   *  the user kicking off another candidate batch mid-approval. */
  isApprovingMainImage: boolean
  setIsApprovingMainImage: (v: boolean) => void
  /** Shallow-merge into stagedData (does NOT mirror to canvas — the canvas
   *  only learns about edits at save time). */
  patch: (updates: Partial<LocationNodeData>) => void
  /** Persist stagedData to the backend, mirror to canvas, invalidate query
   *  cache. Returns the saved id so callers don't have to wait for the
   *  React setState to flush. Throws on non-409 errors after toasting. */
  saveStaged: () => Promise<string>
  /** Returns the row's DB id, saving first if absent. */
  ensureSavedBeforeGen: () => Promise<string>
}

export function useLocationStudio(nodeId: string): LocationStudioState {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)
  const userId = getCachedUserId()
  const invalidate = useInvalidateLocation(projectId ?? undefined, userId)

  const [stagedData, setStagedData] = useState<LocationNodeData | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isApprovingMainImage, setIsApprovingMainImage] = useState(false)

  // Seed from the canvas node once. Subsequent canvas updates (e.g. from
  // worker auto-attach completing while the studio is open) flow through
  // patch() or saveStaged()'s round-trip, so we don't re-seed unconditionally.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current || !node) return
    seededRef.current = true
    setStagedData(JSON.parse(JSON.stringify(node.data)) as LocationNodeData)
  }, [node])

  // Keep latest staged in a ref so callbacks captured by buttons see the
  // freshest value without forcing re-creation on every keystroke. The
  // assignment runs in an effect (NOT during render) so Concurrent React's
  // discarded renders don't poison the ref with a value that never committed.
  // No code path reads `stagedRef.current` synchronously during the same
  // render that produced `stagedData` — the save/ensureSaved callbacks only
  // fire from event handlers, which run after commit.
  const stagedRef = useRef<LocationNodeData | null>(null)
  useEffect(() => {
    stagedRef.current = stagedData
  }, [stagedData])

  const isDirty = useMemo(() => {
    if (!stagedData || !node) return false
    return JSON.stringify(stagedData) !== JSON.stringify(node.data)
  }, [stagedData, node?.data])

  const patch = useCallback((updates: Partial<LocationNodeData>) => {
    setStagedData((prev) => (prev ? ({ ...prev, ...updates } as LocationNodeData) : prev))
  }, [])

  const saveStaged = useCallback(async (): Promise<string> => {
    const current = stagedRef.current
    if (!current) throw new Error("Studio state not ready.")
    setIsSaving(true)
    try {
      const result = await saveLocation({
        id: current.locationDbId || undefined,
        nodeId,
        projectId: current.projectId || projectId || undefined,
        userId,
        name: current.locationName,
        description: current.description,
        category: current.category,
        style: current.style,
        sourceImageUrl: current.sourceImageUrl || undefined,
        // Pass-through identity fields — the route handler ignores
        // worker-owned asset bucket columns on UPDATE, so it's safe to include
        // them here for the INSERT path.
        timeOfDay: current.timeOfDay,
        weather: current.weather,
        angles: current.angles,
        lighting: current.lighting,
        seasons: current.seasons,
        atmosphereMotions: current.atmosphereMotions,
        referencePhotos: current.referencePhotos,
        canonicalDescription: current.canonicalDescription,
        styleLock: current.styleLock,
        expectedUpdatedAt: current.updatedAt,
      })
      // Sync to canvas AFTER saveLocation succeeds so the canvas never holds
      // a phantom `locationDbId` if the request fails.
      const mergedForCanvas: Partial<LocationNodeData> = {
        ...current,
        locationDbId: result.id,
      }
      if (result.updatedAt) {
        mergedForCanvas.updatedAt = result.updatedAt
      }
      updateNodeData(nodeId, mergedForCanvas as Record<string, unknown>)
      // Mirror the new id + updatedAt back into staged so subsequent edits
      // carry the freshest optimistic-concurrency token.
      setStagedData((prev) =>
        prev
          ? ({
              ...prev,
              locationDbId: result.id,
              ...(result.updatedAt ? { updatedAt: result.updatedAt } : {}),
            } as LocationNodeData)
          : prev,
      )
      invalidate()
      toast.success("Saved")
      return result.id
    } catch (e) {
      if (e instanceof ConcurrentModificationError) {
        // 409 path: reload canonical state so the user can re-apply edits
        // over fresh data instead of clobbering the concurrent writer.
        toast.error("Location was modified in another tab — reloaded")
        if (current.locationDbId) {
          try {
            const fresh = await getLocationById(current.locationDbId)
            if (fresh) {
              // Merge into the canvas data shape so the studio keeps working
              // against a LocationNodeData (DbLocation is the API shape, not
              // the node-data shape — they overlap but aren't identical).
              const merged: LocationNodeData = {
                ...current,
                locationDbId: fresh.id,
                locationName: fresh.name,
                description: fresh.description ?? "",
                category: (fresh.category as LocationNodeData["category"]) ?? current.category,
                style: (fresh.style as LocationNodeData["style"]) ?? current.style,
                sourceImageUrl: fresh.sourceImageUrl ?? "",
                timeOfDay: fresh.timeOfDay ?? current.timeOfDay,
                weather: fresh.weather ?? current.weather,
                angles: fresh.angles ?? current.angles,
                lighting: fresh.lighting ?? current.lighting,
                seasons: fresh.seasons ?? current.seasons,
                atmosphereMotions: fresh.atmosphereMotions ?? current.atmosphereMotions,
                referencePhotos:
                  (fresh.referencePhotos as LocationNodeData["referencePhotos"]) ?? current.referencePhotos,
                canonicalDescription: fresh.canonicalDescription ?? "",
                styleLock: fresh.styleLock ?? current.styleLock,
              }
              merged.updatedAt = fresh.updatedAt
              setStagedData(merged)
              updateNodeData(nodeId, merged as Record<string, unknown>)
            }
          } catch {
            // If even the re-fetch fails, leave staged as-is; the user can
            // retry Save and will hit the 409 path again.
          }
        }
      } else {
        toast.error("Save failed")
      }
      throw e
    } finally {
      setIsSaving(false)
    }
  }, [invalidate, nodeId, projectId, updateNodeData, userId])

  const ensureSavedBeforeGen = useCallback(async (): Promise<string> => {
    const current = stagedRef.current
    if (!current) throw new Error("Studio state not ready.")
    if (current.locationDbId) return current.locationDbId
    // saveStaged returns the new id synchronously from the resolved
    // saveLocation result — don't depend on stagedRef.current having
    // flushed through React's setState batching.
    return saveStaged()
  }, [saveStaged])

  return {
    stagedData,
    isDirty,
    isSaving,
    isApprovingMainImage,
    setIsApprovingMainImage,
    patch,
    saveStaged,
    ensureSavedBeforeGen,
  }
}
