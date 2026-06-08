import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getCachedUserId } from "@/hooks/use-auth"
import {
  approveCreatureMainImage,
  ConcurrentModificationError,
  getCreatureById,
  saveCreature,
} from "@/lib/api"
import { useInvalidateCreature } from "@/hooks/queries/use-invalidate-creature"
import type {
  ObjectAssetItem,
  CreatureNodeData,
  ObjectReferencePhoto,
} from "@/types/nodes"
import {
  useCreatureRealtimeSync,
  type CreatureRealtimeRow,
} from "./use-creature-realtime-sync"

/**
 * Creature Studio — staged state hook.
 *
 * Mirrors the object-studio precedent (use-object-studio.ts) verbatim with
 * object → creature substitution + the creature deltas:
 *  - `creatureDbId` / `creatureName` instead of `objectDbId` / `objectName`.
 *  - `poses` replaces object's `materials` asset bucket.
 *  - `species` (free-text) is a new identity field, persisted via saveCreature.
 *
 * The hook:
 *  - Deep-copies node data into a local `stagedData` so edits never leak into
 *    the workflow store until `saveStaged()` lands. Dirty tracking is a
 *    JSON-equality diff against the live canvas node.
 *  - On `saveStaged()`, calls `saveCreature()` with optimistic-concurrency
 *    token; on success mirrors the staged data back into the workflow store
 *    (so the canvas summary updates) and invalidates the React Query asset
 *    list so the library tab refreshes.
 *  - On 409 (`ConcurrentModificationError`) re-fetches the canonical row via
 *    `getCreatureById` and re-stages it so the user can re-apply edits over
 *    fresh state instead of clobbering the concurrent writer.
 *  - `ensureSavedBeforeGen()` is the "first-generate" path: if there's
 *    no `creatureDbId`, save first so the worker can attach the produced
 *    asset back to the row when the job completes.
 *
 * Creature has 5 asset buckets (mirror object): `angles`, `poses`,
 * `variations`, `motionClips`, `referencePhotos`. There is no `piiConsentAt`
 * — creature never references real-world people so the reference-photo
 * consent flow doesn't apply. Reference-sheet (`sheets` / `detailCloseups`)
 * is carried for forward-compat but has NO UI this phase (Sheet tab DEFERRED).
 */
export interface CreatureStudioState {
  /** Deep copy of the canvas node data, locally edited via `patch`. Null when
   *  the workflow store hasn't seeded the node yet (cold-load). */
  stagedData: CreatureNodeData | null
  /** Diff-equality against the live canvas node. */
  isDirty: boolean
  /** True while a save (POST /v1/creatures) is in flight. */
  isSaving: boolean
  /** True while approve-main-image is in flight — gates Generate to prevent
   *  the user kicking off another candidate batch mid-approval. */
  isApprovingMainImage: boolean
  setIsApprovingMainImage: (v: boolean) => void
  /** Shallow-merge into stagedData (does NOT mirror to canvas — the canvas
   *  only learns about edits at save time). */
  patch: (updates: Partial<CreatureNodeData>) => void
  /** Persist stagedData to the backend, mirror to canvas, invalidate query
   *  cache. Returns the saved id so callers don't have to wait for the
   *  React setState to flush. Throws on non-409 errors after toasting. */
  saveStaged: () => Promise<string>
  /** Returns the row's DB id, saving first if absent. */
  ensureSavedBeforeGen: () => Promise<string>
  /** Approve a candidate-generation job as the creature's main image. Passes
   *  the studio's `updatedAt` token for optimistic-concurrency; on 409 re-
   *  fetches the canonical row + re-stages so the user can retry over fresh
   *  state. Same recovery shape as `saveStaged`. */
  approveMainImage: (candidateJobId: string) => Promise<{
    readonly sourceImageUrl: string
    readonly canonicalDescription: string
  }>
}

export function useCreatureStudio(nodeId: string): CreatureStudioState {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)
  const userId = getCachedUserId()
  const invalidate = useInvalidateCreature(projectId ?? undefined, userId)

  const [stagedData, setStagedData] = useState<CreatureNodeData | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isApprovingMainImage, setIsApprovingMainImage] = useState(false)

  // Seed from the canvas node once. Subsequent canvas updates (e.g. from
  // worker auto-attach completing while the studio is open) flow through
  // patch() or saveStaged()'s round-trip, so we don't re-seed unconditionally.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current || !node) return
    seededRef.current = true
    setStagedData(JSON.parse(JSON.stringify(node.data)) as CreatureNodeData)
  }, [node])

  // Keep latest staged in a ref so callbacks captured by buttons see the
  // freshest value without forcing re-creation on every keystroke. The
  // assignment runs in an effect (NOT during render) so Concurrent React's
  // discarded renders don't poison the ref with a value that never committed.
  // No code path reads `stagedRef.current` synchronously during the same
  // render that produced `stagedData` — the save/ensureSaved callbacks only
  // fire from event handlers, which run after commit.
  const stagedRef = useRef<CreatureNodeData | null>(null)
  useEffect(() => {
    stagedRef.current = stagedData
  }, [stagedData])

  const isDirty = useMemo(() => {
    if (!stagedData || !node) return false
    return JSON.stringify(stagedData) !== JSON.stringify(node.data)
  }, [stagedData, node?.data])

  const patch = useCallback((updates: Partial<CreatureNodeData>) => {
    setStagedData((prev) => (prev ? ({ ...prev, ...updates } as CreatureNodeData) : prev))
  }, [])

  /**
   * Re-fetch the canonical row + re-stage it after a 409. Shared by both
   * `saveStaged` and `approveMainImage` — same recovery shape so the user
   * sees identical "modified in another tab — reloaded" UX regardless of
   * which write tripped the version check.
   *
   * No-op when there's no `creatureDbId` (can't 409 without a row id) or
   * the fetch itself fails (the user can retry).
   */
  const refetchAndRestage = useCallback(async (): Promise<void> => {
    const current = stagedRef.current
    if (!current?.creatureDbId) return
    try {
      const fresh = await getCreatureById(current.creatureDbId)
      if (!fresh) return
      // Merge into the canvas data shape so the studio keeps working
      // against a CreatureNodeData (DbCreature is the API shape, not
      // the node-data shape — they overlap but aren't identical).
      const merged: CreatureNodeData = {
        ...current,
        creatureDbId: fresh.id,
        creatureName: fresh.name,
        description: fresh.description ?? "",
        species: fresh.species ?? current.species,
        category: fresh.category ?? current.category,
        style: (fresh.style as CreatureNodeData["style"]) ?? current.style,
        sourceImageUrl: fresh.sourceImageUrl ?? "",
        angles: fresh.angles ?? current.angles,
        poses: fresh.poses ?? current.poses,
        variations: fresh.variations ?? current.variations,
        motionClips: fresh.motionClips ?? current.motionClips,
        referencePhotos:
          (fresh.referencePhotos as CreatureNodeData["referencePhotos"]) ?? current.referencePhotos,
        // Reference-sheet buckets — hydrate so a sheet generated in a prior
        // session is reflected if/when the Sheet tab ships. No UI consumes
        // these this phase, but keeping them in sync mirrors object-studio
        // and avoids a clobber on the next save round-trip.
        sheets: fresh.sheets ?? current.sheets ?? [],
        detailCloseups:
          (fresh.detailCloseups as CreatureNodeData["detailCloseups"]) ?? current.detailCloseups,
        canonicalDescription: fresh.canonicalDescription ?? "",
        styleLock: fresh.styleLock ?? current.styleLock,
      }
      merged.updatedAt = fresh.updatedAt
      setStagedData(merged)
      updateNodeData(nodeId, merged as Record<string, unknown>)
    } catch {
      // If even the re-fetch fails, leave staged as-is; the user can retry.
    }
  }, [nodeId, updateNodeData])

  // On open, refetch the canonical row ONCE (when saved) so any worker-owned
  // buckets reflect what's actually persisted. The canvas node only carries
  // what was mirrored at save time, and the realtime merge
  // (mergeRealtimeCreatureRow) is append-only — so without this, assets
  // generated in a prior session can be missing from the seed. Mirrors the
  // object-studio seed+refetch.
  const refetchedRef = useRef(false)
  useEffect(() => {
    if (refetchedRef.current || !stagedData?.creatureDbId) return
    refetchedRef.current = true
    void refetchAndRestage()
  }, [stagedData?.creatureDbId, refetchAndRestage])

  const saveStaged = useCallback(async (): Promise<string> => {
    const current = stagedRef.current
    if (!current) throw new Error("Studio state not ready.")
    setIsSaving(true)
    try {
      const result = await saveCreature({
        id: current.creatureDbId || undefined,
        nodeId,
        projectId: current.projectId || projectId || undefined,
        userId,
        name: current.creatureName,
        description: current.description,
        species: current.species,
        category: current.category,
        style: current.style,
        sourceImageUrl: current.sourceImageUrl || undefined,
        // Pass-through identity fields — the route handler ignores
        // worker-owned asset bucket columns on UPDATE, so it's safe to include
        // them here for the INSERT path. Dumb pass-through; backend owns the
        // INSERT-vs-UPDATE exclusion.
        angles: current.angles,
        poses: current.poses,
        variations: current.variations,
        motionClips: current.motionClips,
        referencePhotos: current.referencePhotos,
        canonicalDescription: current.canonicalDescription,
        styleLock: current.styleLock,
        expectedUpdatedAt: current.updatedAt,
      })
      // Sync to canvas AFTER saveCreature succeeds so the canvas never holds
      // a phantom `creatureDbId` if the request fails.
      const mergedForCanvas: Partial<CreatureNodeData> = {
        ...current,
        creatureDbId: result.id,
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
              creatureDbId: result.id,
              ...(result.updatedAt ? { updatedAt: result.updatedAt } : {}),
            } as CreatureNodeData)
          : prev,
      )
      invalidate()
      toast.success("Saved")
      return result.id
    } catch (e) {
      if (e instanceof ConcurrentModificationError) {
        // 409 path: reload canonical state so the user can re-apply edits
        // over fresh data instead of clobbering the concurrent writer.
        toast.error("Creature was modified in another tab — reloaded")
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
   * Approve a candidate-generation job as the creature's main image.
   *
   * Mirrors `saveStaged`'s 409 handling: passes the studio's `updatedAt`
   * token to `approveCreatureMainImage`, and on 409 refetches the canonical
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
      if (!current?.creatureDbId) {
        throw new Error("Studio state not ready.")
      }
      try {
        const result = await approveCreatureMainImage(
          current.creatureDbId,
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
              } as CreatureNodeData)
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
    if (current.creatureDbId) return current.creatureDbId
    // saveStaged returns the new id synchronously from the resolved
    // saveCreature result — don't depend on stagedRef.current having
    // flushed through React's setState batching.
    return saveStaged()
  }, [saveStaged])

  // ---------------------------------------------------------------------
  // Realtime sync
  // ---------------------------------------------------------------------
  // Subscribe to UPDATE events on this creature's row so the studio
  // reflects worker auto-attach writes instantly instead of waiting for
  // the user to Save (which triggers a refetch). The merge contract:
  //
  //   - Asset bucket columns (angles, poses, variations, motionClips,
  //     referencePhotos): APPEND-ONLY by url. New entries from the worker
  //     are appended to staged; existing staged entries are preserved (so
  //     a user-typed custom variation in progress isn't clobbered).
  //     Applied unconditionally — assets are additive and the user can't
  //     be "editing" them mid-stream.
  //
  //   - Identity/description fields (creatureName, description, species,
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
  const handleCreatureRealtimeUpdate = useCallback(
    (row: CreatureRealtimeRow) => {
      const current = stagedRef.current
      if (!current) return
      const live = node?.data as CreatureNodeData | undefined
      // Re-compute dirty against the current canvas snapshot — not the
      // memoized `isDirty` from render, which may be stale relative to the
      // last setStagedData/updateNodeData round-trip.
      const dirty = live ? JSON.stringify(current) !== JSON.stringify(live) : false
      const merged = mergeRealtimeCreatureRow(current, row, dirty)
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
  useCreatureRealtimeSync(stagedData?.creatureDbId || null, handleCreatureRealtimeUpdate)

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
 * The DB persists either `{ name, url }` (angles/poses/variations/
 * motionClips) or `{ kind, url }` (referencePhotos). Either way the url is
 * the dedupe key.
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
export function mergeAssetBucket<T extends { url: string }>(
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
 * Builds a merged CreatureNodeData from a Realtime `creatures` row.
 *
 * Returns the same `staged` reference when nothing changed — callers
 * use this to skip the setState round-trip.
 *
 * Append-only bucket merge is unconditional. Identity/description
 * fields are only adopted when `!dirty` so in-flight local edits are
 * preserved.
 */
export function mergeRealtimeCreatureRow(
  staged: CreatureNodeData,
  row: CreatureRealtimeRow,
  dirty: boolean,
): CreatureNodeData {
  let changed = false
  const next: CreatureNodeData = { ...staged }

  const angles = mergeAssetBucket<ObjectAssetItem>(staged.angles, row.angles)
  if (angles !== "unchanged") {
    next.angles = angles as ObjectAssetItem[]
    changed = true
  }
  const poses = mergeAssetBucket<ObjectAssetItem>(staged.poses, row.poses)
  if (poses !== "unchanged") {
    next.poses = poses as ObjectAssetItem[]
    changed = true
  }
  const variations = mergeAssetBucket<ObjectAssetItem>(staged.variations, row.variations)
  if (variations !== "unchanged") {
    next.variations = variations as ObjectAssetItem[]
    changed = true
  }
  const motionClips = mergeAssetBucket<ObjectAssetItem>(staged.motionClips, row.motion_clips)
  if (motionClips !== "unchanged") {
    next.motionClips = motionClips as ObjectAssetItem[]
    changed = true
  }
  const referencePhotos = mergeAssetBucket<ObjectReferencePhoto>(
    staged.referencePhotos,
    row.reference_photos,
  )
  if (referencePhotos !== "unchanged") {
    next.referencePhotos = referencePhotos as ObjectReferencePhoto[]
    changed = true
  }

  // updatedAt is always adopted (token freshness for next save).
  if (row.updated_at && row.updated_at !== staged.updatedAt) {
    next.updatedAt = row.updated_at
    changed = true
  }

  if (!dirty) {
    if (row.name !== null && row.name !== staged.creatureName) {
      next.creatureName = row.name
      changed = true
    }
    if (row.description !== null && row.description !== staged.description) {
      next.description = row.description
      changed = true
    }
    if (row.species !== null && row.species !== staged.species) {
      next.species = row.species
      changed = true
    }
    if (
      row.canonical_description !== null &&
      row.canonical_description !== staged.canonicalDescription
    ) {
      next.canonicalDescription = row.canonical_description
      changed = true
    }
    if (row.source_image_url !== null && row.source_image_url !== staged.sourceImageUrl) {
      next.sourceImageUrl = row.source_image_url
      changed = true
    }
    if (row.category !== null && row.category !== staged.category) {
      next.category = row.category
      changed = true
    }
    if (row.style !== null && row.style !== staged.style) {
      next.style = row.style as CreatureNodeData["style"]
      changed = true
    }
    if (row.style_lock !== null && row.style_lock !== staged.styleLock) {
      next.styleLock = row.style_lock
      changed = true
    }
  }

  return changed ? next : staged
}
