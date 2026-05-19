import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getCachedUserId } from "@/hooks/use-auth"
import {
  approveLocationMainImage,
  ConcurrentModificationError,
  getLocationById,
  saveLocation,
} from "@/lib/api"
import { useInvalidateLocation } from "@/hooks/queries/use-invalidate-location"
import type { LocationAssetItem, LocationNodeData, LocationReferencePhoto } from "@/types/nodes"
import { useLocationRealtimeSync, type LocationRealtimeRow } from "./use-location-realtime-sync"

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
  /** Approve a candidate-generation job as the location's main image. Passes
   *  the studio's `updatedAt` token for optimistic-concurrency; on 409 re-
   *  fetches the canonical row + re-stages so the user can retry over fresh
   *  state. Same recovery shape as `saveStaged`. */
  approveMainImage: (candidateJobId: string) => Promise<{
    readonly sourceImageUrl: string
    readonly canonicalDescription: string
  }>
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

  /**
   * Re-fetch the canonical row + re-stage it after a 409. Shared by both
   * `saveStaged` and `approveMainImage` — same recovery shape so the user
   * sees identical "modified in another tab — reloaded" UX regardless of
   * which write tripped the version check.
   *
   * No-op when there's no `locationDbId` (can't 409 without a row id) or
   * the fetch itself fails (the user can retry).
   */
  const refetchAndRestage = useCallback(async (): Promise<void> => {
    const current = stagedRef.current
    if (!current?.locationDbId) return
    try {
      const fresh = await getLocationById(current.locationDbId)
      if (!fresh) return
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
        piiConsentAt: fresh.piiConsentAt ?? current.piiConsentAt,
      }
      merged.updatedAt = fresh.updatedAt
      setStagedData(merged)
      updateNodeData(nodeId, merged as Record<string, unknown>)
    } catch {
      // If even the re-fetch fails, leave staged as-is; the user can retry.
    }
  }, [nodeId, updateNodeData])

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
        // Phase 2 #7 — PII consent timestamp. Only set when the user has
        // ticked the consent checkbox on the reference-photos section; the
        // node's `piiConsentAt` flips from undefined → ISO timestamp at that
        // moment and stays set forever (consent doesn't time out).
        piiConsentAt: current.piiConsentAt,
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
        await refetchAndRestage()
      } else {
        toast.error("Save failed")
      }
      throw e
    } finally {
      setIsSaving(false)
    }
  }, [invalidate, nodeId, projectId, refetchAndRestage, updateNodeData, userId])

  /**
   * Approve a candidate-generation job as the location's main image.
   *
   * Mirrors `saveStaged`'s 409 handling: passes the studio's `updatedAt`
   * token to `approveLocationMainImage`, and on 409 refetches the canonical
   * row + re-stages it before re-throwing so the caller can keep its own
   * "approve in progress" flag in sync. The caller still owns the
   * `isApprovingMainImage` flag — the hook just owns the network +
   * recovery logic so the 409 codepath is identical to save.
   *
   * On success patches `sourceImageUrl` + `canonicalDescription` into
   * staged so the UI updates without waiting for a refetch.
   */
  const approveMainImage = useCallback(
    async (
      candidateJobId: string,
    ): Promise<{ readonly sourceImageUrl: string; readonly canonicalDescription: string }> => {
      const current = stagedRef.current
      if (!current?.locationDbId) {
        throw new Error("Studio state not ready.")
      }
      try {
        const result = await approveLocationMainImage(
          current.locationDbId,
          candidateJobId,
          current.updatedAt,
        )
        // Mirror result into staged so the UI updates immediately.
        // We don't bump `updatedAt` here — the backend bumped it, but we
        // don't get the new value back. The realtime sync (or the next
        // explicit refetch) will pick it up.
        setStagedData((prev) =>
          prev
            ? ({
                ...prev,
                sourceImageUrl: result.sourceImageUrl,
                canonicalDescription: result.canonicalDescription,
              } as LocationNodeData)
            : prev,
        )
        return result
      } catch (e) {
        if (e instanceof ConcurrentModificationError) {
          toast.error("Someone else just approved this — refreshed")
          await refetchAndRestage()
        }
        throw e
      }
    },
    [refetchAndRestage],
  )

  const ensureSavedBeforeGen = useCallback(async (): Promise<string> => {
    const current = stagedRef.current
    if (!current) throw new Error("Studio state not ready.")
    if (current.locationDbId) return current.locationDbId
    // saveStaged returns the new id synchronously from the resolved
    // saveLocation result — don't depend on stagedRef.current having
    // flushed through React's setState batching.
    return saveStaged()
  }, [saveStaged])

  // ---------------------------------------------------------------------
  // Realtime sync (Phase 2 #12)
  // ---------------------------------------------------------------------
  // Subscribe to UPDATE events on this location's row so the studio
  // reflects worker auto-attach writes instantly instead of waiting for
  // the user to Save (which triggers a refetch). The merge contract:
  //
  //   - Asset bucket columns (timeOfDay, weather, seasons, angles,
  //     lighting, atmosphereMotions, referencePhotos): APPEND-ONLY by url.
  //     New entries from the worker are appended to staged; existing
  //     staged entries are preserved (so a user-typed custom variation in
  //     progress isn't clobbered). Applied unconditionally — assets are
  //     additive and the user can't be "editing" them mid-stream.
  //
  //   - Identity/description fields (locationName, description,
  //     canonicalDescription, category, style, sourceImageUrl, styleLock):
  //     ONLY adopted when isDirty === false. If the user has unsaved
  //     local edits we preserve them — the next Save will hit the 409
  //     path and the existing recovery flow takes over.
  //
  //   - updatedAt: always adopted so a subsequent Save has the freshest
  //     optimistic-concurrency token. (Stale updatedAt would force every
  //     save through the 409 reload path.)
  //
  // The merge runs against the LATEST staged data via stagedRef — not the
  // value captured at subscribe time — so concurrent local edits are
  // never overwritten by a stale snapshot.
  const handleLocationRealtimeUpdate = useCallback(
    (row: LocationRealtimeRow) => {
      const current = stagedRef.current
      if (!current) return
      const live = node?.data as LocationNodeData | undefined
      // Re-compute dirty against the current canvas snapshot — not the
      // memoized `isDirty` from render, which may be stale relative to the
      // last setStagedData/updateNodeData round-trip.
      const dirty = live ? JSON.stringify(current) !== JSON.stringify(live) : false
      const merged = mergeRealtimeLocationRow(current, row, dirty)
      if (merged === current) return // nothing to apply
      setStagedData(merged)
      if (!dirty) {
        // Mirror clean merges to the canvas so the badge / list view
        // updates without waiting for the user to Save.
        updateNodeData(nodeId, merged as Record<string, unknown>)
      }
    },
    [node?.data, nodeId, updateNodeData],
  )
  useLocationRealtimeSync(stagedData?.locationDbId || null, handleLocationRealtimeUpdate)

  return {
    stagedData,
    isDirty,
    isSaving,
    isApprovingMainImage,
    setIsApprovingMainImage,
    patch,
    saveStaged,
    ensureSavedBeforeGen,
    approveMainImage,
  }
}

// ---------------------------------------------------------------------------
// Realtime merge helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Type guard for the per-asset row shape on the JSONB bucket columns.
 * The DB persists either `{ name, url }` (timeOfDay/weather/seasons/
 * angles/lighting/atmosphereMotions) or `{ kind, url }` (referencePhotos).
 * Either way the url is the dedupe key.
 */
function isAssetLike(value: unknown): value is { url: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof (value as { url: unknown }).url === "string"
  )
}

/**
 * Append entries from `incoming` to `staged` whose `url` isn't already in
 * staged. Preserves order: existing entries first, then new ones in the
 * order they arrived. Returns the same `staged` reference when nothing
 * needs to be appended so callers can skip re-renders cheaply.
 */
function mergeAssetBucket<T extends { url: string }>(
  staged: readonly T[] | undefined,
  incoming: unknown,
): readonly T[] | "unchanged" {
  if (!Array.isArray(incoming)) return "unchanged"
  const stagedArr = staged ?? []
  const seen = new Set(stagedArr.map((a) => a.url))
  const appended: T[] = []
  for (const entry of incoming) {
    if (!isAssetLike(entry)) continue
    if (seen.has(entry.url)) continue
    appended.push(entry as T)
    seen.add(entry.url)
  }
  if (appended.length === 0) return "unchanged"
  return [...stagedArr, ...appended]
}

/**
 * Builds a merged LocationNodeData from a Realtime `locations` row.
 *
 * Returns the same `staged` reference when nothing changed — callers
 * use this to skip the setState round-trip.
 *
 * Append-only bucket merge is unconditional. Identity/description
 * fields are only adopted when `!dirty` so in-flight local edits are
 * preserved.
 */
export function mergeRealtimeLocationRow(
  staged: LocationNodeData,
  row: LocationRealtimeRow,
  dirty: boolean,
): LocationNodeData {
  let changed = false
  const next: LocationNodeData = { ...staged }

  const timeOfDay = mergeAssetBucket<LocationAssetItem>(staged.timeOfDay, row.time_of_day)
  if (timeOfDay !== "unchanged") {
    next.timeOfDay = timeOfDay as LocationAssetItem[]
    changed = true
  }
  const weather = mergeAssetBucket<LocationAssetItem>(staged.weather, row.weather)
  if (weather !== "unchanged") {
    next.weather = weather as LocationAssetItem[]
    changed = true
  }
  const angles = mergeAssetBucket<LocationAssetItem>(staged.angles, row.angles)
  if (angles !== "unchanged") {
    next.angles = angles as LocationAssetItem[]
    changed = true
  }
  const lighting = mergeAssetBucket<LocationAssetItem>(staged.lighting, row.lighting)
  if (lighting !== "unchanged") {
    next.lighting = lighting as LocationAssetItem[]
    changed = true
  }
  const seasons = mergeAssetBucket<LocationAssetItem>(staged.seasons, row.seasons)
  if (seasons !== "unchanged") {
    next.seasons = seasons as LocationAssetItem[]
    changed = true
  }
  const atmosphereMotions = mergeAssetBucket<LocationAssetItem>(
    staged.atmosphereMotions,
    row.atmosphere_motions,
  )
  if (atmosphereMotions !== "unchanged") {
    next.atmosphereMotions = atmosphereMotions as LocationAssetItem[]
    changed = true
  }
  const referencePhotos = mergeAssetBucket<LocationReferencePhoto>(
    staged.referencePhotos,
    row.reference_photos,
  )
  if (referencePhotos !== "unchanged") {
    next.referencePhotos = referencePhotos as LocationReferencePhoto[]
    changed = true
  }

  // updatedAt is always adopted (token freshness for next save).
  if (row.updated_at && row.updated_at !== staged.updatedAt) {
    next.updatedAt = row.updated_at
    changed = true
  }

  if (!dirty) {
    if (row.name !== null && row.name !== staged.locationName) {
      next.locationName = row.name
      changed = true
    }
    if (row.description !== null && row.description !== staged.description) {
      next.description = row.description
      changed = true
    }
    if (row.canonical_description !== null && row.canonical_description !== staged.canonicalDescription) {
      next.canonicalDescription = row.canonical_description
      changed = true
    }
    if (row.source_image_url !== null && row.source_image_url !== staged.sourceImageUrl) {
      next.sourceImageUrl = row.source_image_url
      changed = true
    }
    if (row.category !== null && row.category !== staged.category) {
      next.category = row.category as LocationNodeData["category"]
      changed = true
    }
    if (row.style !== null && row.style !== staged.style) {
      next.style = row.style as LocationNodeData["style"]
      changed = true
    }
    if (row.style_lock !== null && row.style_lock !== staged.styleLock) {
      next.styleLock = row.style_lock
      changed = true
    }
  }

  return changed ? next : staged
}
