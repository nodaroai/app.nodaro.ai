import { useCallback, useEffect, useRef, useState } from "react"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getCharacter, saveCharacter } from "@/lib/api"
import type { CharacterNodeData } from "@/types/nodes"

/**
 * Character Studio state — no Save button, no dirty machinery.
 *
 * Persistence model:
 *  - Every `patch()` updates local `staged`, mirrors to the workflow store
 *    (so the canvas node summary stays live), tracks which fields changed,
 *    and schedules a debounced PATCH to `/v1/characters` (~600ms after the
 *    last change). The PATCH includes ONLY the fields the user touched
 *    locally — important so the worker's concurrent auto-attach to asset
 *    arrays doesn't get clobbered by a debounce save that's carrying stale
 *    array contents.
 *  - Asset generations call `ensureSaved()` first to obtain a `characterDbId`,
 *    then pass it to the backend as `attachToCharacterId`. The worker writes
 *    the resulting URL/clip directly to the user's character row, so closing
 *    the page mid-generation doesn't orphan the result.
 *  - On open, if there's a `characterDbId`, refetch the row once so we pick
 *    up assets that landed via backend auto-attach from a previous session.
 */

const AUTOSAVE_DEBOUNCE_MS = 600

/** Frontend-only-managed fields (never written by the worker). Always sent on
 *  an UPDATE so the user sees them persist immediately. */
const ALWAYS_PATCH_FIELDS = ["characterName", "description", "gender", "style", "baseOutfit", "voice", "personality"] as const

/** Fields that the WORKER can also write to. The frontend sends them on
 *  UPDATE only when the user explicitly mutated them locally (delete, rename,
 *  import, polled completion). Skipping them otherwise prevents a race where
 *  the debounce save sends a stale array and overwrites a worker append. */
type DirtyTrackedField =
  | "sourceImageUrl"
  | "expressions"
  | "poses"
  | "angles"
  | "lightingVariations"
  | "motions"

const DIRTY_TRACKED_FIELDS: ReadonlySet<DirtyTrackedField> = new Set([
  "sourceImageUrl",
  "expressions",
  "poses",
  "angles",
  "lightingVariations",
  "motions",
])

export type SaveStatus = "idle" | "saving" | "saved" | "error"

export interface CharacterStudioState {
  staged: CharacterNodeData
  /** Saves are async; this surfaces the latest result for a status indicator. */
  saveStatus: SaveStatus
  /** Shallow merge into staged, mirror to canvas, and schedule a debounced PATCH. */
  patch: (p: Partial<CharacterNodeData>) => void
  /** Returns the persisted character DB id, creating the row first if needed.
   *  If the user hasn't typed a name yet, auto-assigns PLACEHOLDER_CHARACTER_NAME
   *  (prompt builders strip it; the Appearance tab shows a rename cue). */
  ensureSaved: () => Promise<string>
}

function buildInsertPayload(nodeId: string, d: CharacterNodeData) {
  return {
    nodeId,
    projectId: d.projectId || undefined,
    name: d.characterName,
    description: d.description,
    gender: d.gender,
    style: d.style,
    baseOutfit: d.baseOutfit,
    sourceImageUrl: d.sourceImageUrl || undefined,
    expressions: d.expressions,
    poses: d.poses,
    lightingVariations: d.lightingVariations,
    angles: d.angles,
    motions: d.motions,
    voice: d.voice,
    personality: d.personality,
  }
}

function buildUpdatePayload(nodeId: string, d: CharacterNodeData, dirty: Set<DirtyTrackedField>) {
  // Always-send identity fields. The route requires `name` (Zod min 1) and
  // `nodeId`, plus voice/personality are frontend-managed only so safe.
  const payload: Parameters<typeof saveCharacter>[0] = {
    id: d.characterDbId,
    nodeId,
    projectId: d.projectId || undefined,
    name: d.characterName,
    description: d.description,
    gender: d.gender,
    style: d.style,
    baseOutfit: d.baseOutfit,
    voice: d.voice,
    personality: d.personality,
  }
  // Dirty-only fields (worker also writes these — only send what the user
  // changed in this debounce window to avoid clobbering worker appends).
  if (dirty.has("sourceImageUrl")) payload.sourceImageUrl = d.sourceImageUrl || undefined
  if (dirty.has("expressions")) payload.expressions = d.expressions
  if (dirty.has("poses")) payload.poses = d.poses
  if (dirty.has("angles")) payload.angles = d.angles
  if (dirty.has("lightingVariations")) payload.lightingVariations = d.lightingVariations
  if (dirty.has("motions")) payload.motions = d.motions
  return payload
}

export function useCharacterStudio(nodeId: string): CharacterStudioState | null {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const [staged, setStaged] = useState<CharacterNodeData | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

  // Latest staged kept in a ref so the debounced timer captures fresh values
  // without resetting on every keystroke.
  const stagedRef = useRef<CharacterNodeData | null>(null)
  stagedRef.current = staged

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Serializes in-flight saves: a save that's mid-flight when the next debounce
  // fires waits its turn rather than racing. Last write wins because every save
  // sends the dirty fields it accumulated up to that point.
  const inFlightRef = useRef<Promise<void> | null>(null)
  // Guards a parallel "first insert" — if two generate clicks race past
  // ensureSaved before any DB id exists, only the first creates the row.
  const ensureInFlightRef = useRef<Promise<string> | null>(null)
  // Fields the user has changed locally since the last successful UPDATE.
  // We send these on the next flush, then clear. Worker-managed columns that
  // aren't in this set get omitted so the worker's writes survive.
  const dirtyRef = useRef<Set<DirtyTrackedField>>(new Set())

  // Seed local staged from the canvas node once, then refetch from the DB if
  // there's a `characterDbId` so we pick up backend-attached assets that
  // landed while the studio was closed in a previous session.
  useEffect(() => {
    if (!node || staged !== null) return
    const initial = JSON.parse(JSON.stringify(node.data)) as CharacterNodeData
    setStaged(initial)
    const dbId = initial.characterDbId
    if (!dbId) return
    let cancelled = false
    void (async () => {
      try {
        const fresh = await getCharacter(dbId)
        if (cancelled) return
        setStaged((prev) => {
          if (!prev) return prev
          const merged: CharacterNodeData = {
            ...prev,
            characterName: fresh.name || prev.characterName,
            description: fresh.description ?? prev.description,
            gender: (fresh.gender as CharacterNodeData["gender"]) ?? prev.gender,
            style: (fresh.style as CharacterNodeData["style"]) ?? prev.style,
            baseOutfit: fresh.baseOutfit ?? prev.baseOutfit,
            sourceImageUrl: fresh.sourceImageUrl ?? prev.sourceImageUrl,
            expressions: fresh.expressions ?? prev.expressions,
            poses: fresh.poses ?? prev.poses,
            lightingVariations: fresh.lightingVariations ?? prev.lightingVariations,
            angles: fresh.angles ?? prev.angles,
            motions: fresh.motions ?? prev.motions,
            voice: fresh.voice ?? prev.voice,
            personality: fresh.personality ?? prev.personality,
          }
          updateNodeData(nodeId, merged)
          return merged
        })
      } catch {
        // Non-fatal: studio still works off staged local state.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [node, staged, nodeId, updateNodeData])

  // Flush pending debounce on unmount so the final keystrokes get persisted.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const flushSave = useCallback(async () => {
    const current = stagedRef.current
    if (!current || !current.characterName.trim()) return
    if (!current.characterDbId) {
      // Without a DB id this would create a new row. Defer to ensureSaved so
      // the path that hands out the id is the only one that inserts.
      return
    }
    // Wait for any in-flight save to land first so writes serialize.
    if (inFlightRef.current) {
      try { await inFlightRef.current } catch { /* ignore */ }
    }
    const snapshot = stagedRef.current
    if (!snapshot || !snapshot.characterName.trim()) return
    // Snapshot + clear dirty BEFORE the network call so concurrent patches
    // that arrive mid-flight get their own subsequent flush.
    const dirtySnapshot = new Set(dirtyRef.current)
    dirtyRef.current = new Set()
    setSaveStatus("saving")
    const op = (async () => {
      try {
        await saveCharacter(buildUpdatePayload(nodeId, snapshot, dirtySnapshot))
        setSaveStatus("saved")
      } catch {
        // Restore the dirty set on failure so the next debounce retries.
        for (const f of dirtySnapshot) dirtyRef.current.add(f)
        setSaveStatus("error")
      }
    })()
    inFlightRef.current = op
    try { await op } finally {
      if (inFlightRef.current === op) inFlightRef.current = null
    }
  }, [nodeId])

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void flushSave()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [flushSave])

  const patch = useCallback(
    (p: Partial<CharacterNodeData>) => {
      setStaged((prev) => {
        if (!prev) return prev
        const next = { ...prev, ...p }
        // Mirror to the workflow store so the canvas summary updates live
        // (counts, name, portrait thumbnail).
        updateNodeData(nodeId, p)
        return next
      })
      for (const key of Object.keys(p)) {
        if (DIRTY_TRACKED_FIELDS.has(key as DirtyTrackedField)) {
          dirtyRef.current.add(key as DirtyTrackedField)
        }
      }
      // Sanity guard against typos: any always-patched field triggers a save
      // even if it didn't go in the dirty set.
      const touchedAnyAlways = (ALWAYS_PATCH_FIELDS as readonly string[]).some((k) => k in p)
      if (touchedAnyAlways || Object.keys(p).some((k) => DIRTY_TRACKED_FIELDS.has(k as DirtyTrackedField))) {
        scheduleSave()
      }
    },
    [nodeId, updateNodeData, scheduleSave],
  )

  const ensureSaved = useCallback(async (): Promise<string> => {
    const current = stagedRef.current
    if (!current) throw new Error("Studio state not ready.")
    if (current.characterDbId) {
      // If there's a pending debounce, flush it now so the row reflects the
      // current name/description/etc. before the worker attaches new assets.
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        await flushSave()
      }
      return current.characterDbId
    }
    // Auto-assign a placeholder name on first generate so the click feels
    // instant — `characters.name` is NOT NULL and the Zod min(1) would
    // otherwise reject the insert. Prompt builders strip this exact value
    // (see PLACEHOLDER_CHARACTER_NAME in @nodaro/shared) so the literal
    // string never reaches the model. The Appearance tab dims/labels the
    // name field as a rename cue.
    const namedCurrent: CharacterNodeData = current.characterName.trim()
      ? current
      : { ...current, characterName: PLACEHOLDER_CHARACTER_NAME }
    if (namedCurrent !== current) {
      setStaged(namedCurrent)
      updateNodeData(nodeId, { characterName: namedCurrent.characterName })
    }
    // Race guard: if a parallel ensureSaved() is already creating the row,
    // wait for it instead of starting a second insert.
    if (ensureInFlightRef.current) return ensureInFlightRef.current
    const op = (async () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setSaveStatus("saving")
      // INSERT carries the full row — clear the dirty set since it's all in.
      dirtyRef.current = new Set()
      const { id: dbId } = await saveCharacter(buildInsertPayload(nodeId, namedCurrent))
      setStaged((prev) => (prev ? { ...prev, characterDbId: dbId } : prev))
      updateNodeData(nodeId, { characterDbId: dbId })
      setSaveStatus("saved")
      return dbId
    })()
    ensureInFlightRef.current = op
    try {
      return await op
    } finally {
      ensureInFlightRef.current = null
    }
  }, [nodeId, updateNodeData, flushSave])

  if (!staged) return null
  return { staged, saveStatus, patch, ensureSaved }
}
