import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CharacterNameTakenError, getCharacter, getCharacters, saveCharacter } from "@/lib/api"
import { mergeCharacterDetailIntoNodeData } from "@/lib/character-node-data"
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
 *  an UPDATE so the user sees them persist immediately.
 *
 *  `referencePhotos` and `seedPrompt` are user-controlled — the worker never
 *  writes them, so they live here alongside the identity fields. */
const ALWAYS_PATCH_FIELDS = [
  "characterName", "description", "gender", "style", "baseOutfit", "voice", "personality",
  "referencePhotos", "seedPrompt", "person", "wardrobe", "identityLock",
] as const

/** Fields that the WORKER can also write to. The frontend sends them on
 *  UPDATE only when the user explicitly mutated them locally (delete, rename,
 *  import, polled completion). Skipping them otherwise prevents a race where
 *  the debounce save sends a stale array and overwrites a worker append.
 *
 *  `canonicalDescription` is worker-written by the approve-portrait route's
 *  auto-caption step; `realLifeRefsByVariant` is also dirty-tracked so the
 *  per-variant ref cache can land alongside an asset append without races. */
type DirtyTrackedField =
  | "sourceImageUrl"
  | "canonicalDescription"
  | "realLifeRefsByVariant"
  | "expressions"
  | "poses"
  | "angles"
  | "bodyAngles"
  | "lightingVariations"
  | "motions"

const DIRTY_TRACKED_FIELDS: ReadonlySet<DirtyTrackedField> = new Set([
  "sourceImageUrl",
  "canonicalDescription",
  "realLifeRefsByVariant",
  "expressions",
  "poses",
  "angles",
  "bodyAngles",
  "lightingVariations",
  "motions",
])

export type SaveStatus = "idle" | "saving" | "saved" | "error"

export type StudioPendingJobSeed = {
  jobId: string
  assetType: "expressions" | "poses" | "angles" | "bodyAngles" | "lighting" | "motions"
  name: string
}

export interface CharacterStudioState {
  /** Canvas node id that opened this studio — i.e. the source character node.
   *  Tabs use this when injecting assets onto the canvas so the new node lands
   *  near its source, and the "default asset" feature is per-canvas-node. */
  nodeId: string
  staged: CharacterNodeData
  /** Saves are async; this surfaces the latest result for a status indicator. */
  saveStatus: SaveStatus
  /** In-flight generation jobs returned by the most recent refetch on open,
   *  to be seeded into useCharacterStudioJobs so spinners reappear after a
   *  page close. Modal consumes once via useEffect; the array is stable per
   *  refetch so the seeding effect runs exactly once. */
  initialPendingJobs: StudioPendingJobSeed[] | null
  /** In-flight `generate-character` jobs found on this character row at
   *  open-time. The Appearance tab seeds its candidate grid from this and
   *  resumes polling so spinners reappear when the user re-opens the modal
   *  mid-generation. */
  initialPortraitCandidates: ReadonlyArray<{ jobId: string; status: string; progress: number; url?: string }>
  /** Recently-completed `generate-character` jobs (within 7 days, max 5,
   *  excluding the currently-approved portrait). Seeds the previous-
   *  candidates strip so the user can re-approve an earlier candidate. */
  initialPreviousCandidates: ReadonlyArray<{ jobId: string; url: string; createdAt: string }>
  /** Shallow merge into staged, mirror to canvas, and schedule a debounced PATCH. */
  patch: (p: Partial<CharacterNodeData>) => void
  /** Functional variant of `patch` — the updater receives the FRESHEST staged
   *  state and returns the partial to merge. Use this when the new value is
   *  DERIVED from the current array (e.g. removing one item by URL): the
   *  object-form `patch` captures a render-time snapshot, so a concurrent
   *  poll-driven append that lands during an `await` gets clobbered when the
   *  snapshot is written back. patchWith computes from `prev`, so it survives. */
  patchWith: (updater: (prev: CharacterNodeData) => Partial<CharacterNodeData>) => void
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
    bodyAngles: d.bodyAngles,
    motions: d.motions,
    voice: d.voice,
    person: d.person,
    wardrobe: d.wardrobe,
    personality: d.personality,
    referencePhotos: d.referencePhotos,
    seedPrompt: d.seedPrompt,
    canonicalDescription: d.canonicalDescription,
    realLifeRefsByVariant: d.realLifeRefsByVariant,
    identityLock: d.identityLock,
  }
}

function buildUpdatePayload(nodeId: string, d: CharacterNodeData, dirty: Set<DirtyTrackedField>) {
  // Always-send identity fields. The route requires `name` (Zod min 1) and
  // `nodeId`, plus voice/personality/referencePhotos/seedPrompt are
  // frontend-managed only so safe to always include.
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
    person: d.person,
    wardrobe: d.wardrobe,
    personality: d.personality,
    referencePhotos: d.referencePhotos,
    seedPrompt: d.seedPrompt,
    identityLock: d.identityLock,
  }
  // Dirty-only fields (worker also writes these — only send what the user
  // changed in this debounce window to avoid clobbering worker appends).
  if (dirty.has("sourceImageUrl")) payload.sourceImageUrl = d.sourceImageUrl || undefined
  if (dirty.has("expressions")) payload.expressions = d.expressions
  if (dirty.has("poses")) payload.poses = d.poses
  if (dirty.has("angles")) payload.angles = d.angles
  if (dirty.has("bodyAngles")) payload.bodyAngles = d.bodyAngles
  if (dirty.has("lightingVariations")) payload.lightingVariations = d.lightingVariations
  if (dirty.has("motions")) payload.motions = d.motions
  if (dirty.has("canonicalDescription")) payload.canonicalDescription = d.canonicalDescription
  if (dirty.has("realLifeRefsByVariant")) payload.realLifeRefsByVariant = d.realLifeRefsByVariant
  return payload
}

export function useCharacterStudio(nodeId: string): CharacterStudioState | null {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const [staged, setStaged] = useState<CharacterNodeData | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const [initialPendingJobs, setInitialPendingJobs] = useState<StudioPendingJobSeed[] | null>(null)
  const [initialPortraitCandidates, setInitialPortraitCandidates] = useState<CharacterStudioState["initialPortraitCandidates"]>([])
  const [initialPreviousCandidates, setInitialPreviousCandidates] = useState<CharacterStudioState["initialPreviousCandidates"]>([])

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
    let cancelled = false
    void (async () => {
      try {
        let dbId = initial.characterDbId
        if (!dbId) {
          // Unlinked node: if its name matches an existing character (names are
          // unique per user), ADOPT that character so its assets load — instead
          // of showing an empty new character that also can't be saved (the
          // name is taken). A no-op for genuinely-new (placeholder/blank) names.
          const nm = initial.characterName?.trim()
          if (!nm || nm === PLACEHOLDER_CHARACTER_NAME) return
          const { characters } = await getCharacters()
          if (cancelled) return
          const match = characters.find((c) => (c.name ?? "").trim().toLowerCase() === nm.toLowerCase())
          if (!match) return
          dbId = match.id
          updateNodeData(nodeId, { characterDbId: dbId })
        }
        const fresh = await getCharacter(dbId)
        if (cancelled) return
        setStaged((prev) => {
          if (!prev) return prev
          // Single source of truth for the DETAIL→node-data mapping — shared
          // with every library→canvas load site (see character-node-data.ts).
          // Stamp characterDbId so an adopted (was-unlinked) node is now linked.
          const merged = { ...mergeCharacterDetailIntoNodeData(prev, fresh), characterDbId: dbId }
          updateNodeData(nodeId, merged)
          return merged
        })
        // Surface any in-flight jobs found by the backend so the modal can
        // re-hydrate spinner cards. Empty array is fine; the modal's seeding
        // effect no-ops when there's nothing to track.
        setInitialPendingJobs(fresh.pendingJobs ?? [])
        // Portrait-candidate rehydration: in-flight `generate-character` jobs
        // and the recently-completed-unapproved set. The Appearance tab seeds
        // its candidate grid + previous strip from these, and resumes polling
        // on any pending/running candidate so the user sees spinners come back
        // when re-opening the modal mid-generation.
        setInitialPortraitCandidates(fresh.portraitCandidates ?? [])
        setInitialPreviousCandidates(fresh.previousCandidates ?? [])
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
      } catch (e) {
        if (e instanceof CharacterNameTakenError) {
          // Surface the conflict; keep the user's typing in local state so they
          // can edit. Don't re-add `characterName` to dirty — let the next
          // character-name patch trigger a save attempt instead of looping.
          toast.error(e.message)
          // Drop only the FAILED field (the name that collided) from the retry
          // set so we don't loop on it — the next character-name edit re-flags
          // it. Previously this deleted "sourceImageUrl" (a copy-paste slip),
          // silently dropping an unrelated unsaved portrait-image edit.
          dirtySnapshot.delete("characterName" as never)
          // The fields that DIDN'T fail are still unsaved; flag them as dirty
          // so the next debounce flushes them on subsequent edits.
          for (const f of dirtySnapshot) dirtyRef.current.add(f)
          setSaveStatus("error")
          return
        }
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

  // Dirty-field tracking + debounced-save scheduling, shared by `patch` (object
  // form) and `patchWith` (functional form). Idempotent (Set add + timer reset)
  // so it's safe to call inside a setStaged updater, which React may
  // double-invoke under StrictMode.
  const trackPatch = useCallback(
    (p: Partial<CharacterNodeData>) => {
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
    [scheduleSave],
  )

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
      trackPatch(p)
    },
    [nodeId, updateNodeData, trackPatch],
  )

  // Functional patch: computes the partial from the FRESHEST staged state via
  // the setStaged reducer (NOT a render snapshot), so a removal-by-URL can't
  // clobber an append that a 2s job poll committed during an `await` gap.
  const patchWith = useCallback(
    (updater: (prev: CharacterNodeData) => Partial<CharacterNodeData>) => {
      setStaged((prev) => {
        if (!prev) return prev
        const p = updater(prev)
        // Mirror to canvas + track dirty fields from the freshly-computed
        // partial. Both side effects are idempotent under StrictMode's
        // double-invoke (same as `patch`'s updateNodeData call above).
        updateNodeData(nodeId, p)
        trackPatch(p)
        return { ...prev, ...p }
      })
    },
    [nodeId, updateNodeData, trackPatch],
  )

  /** Link this (unlinked) node to an EXISTING character row and load its assets.
   *  Used when a name collision (or open-time name match) reveals the character
   *  already exists — names are unique per user, so the collision IS the row.
   *  Clears the dirty set: the merged data is the DB's, not pending user edits. */
  const adoptCharacter = useCallback(async (dbId: string): Promise<string> => {
    updateNodeData(nodeId, { characterDbId: dbId })
    const fresh = await getCharacter(dbId)
    dirtyRef.current = new Set()
    setStaged((prev) => {
      if (!prev) return prev
      const merged = { ...mergeCharacterDetailIntoNodeData(prev, fresh), characterDbId: dbId }
      updateNodeData(nodeId, merged)
      return merged
    })
    setInitialPendingJobs(fresh.pendingJobs ?? [])
    setInitialPortraitCandidates(fresh.portraitCandidates ?? [])
    setInitialPreviousCandidates(fresh.previousCandidates ?? [])
    setSaveStatus("saved")
    return dbId
  }, [nodeId, updateNodeData])

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
    } catch (e) {
      // The insert collided on name (the user typed a name they already own
      // before clicking Generate). Names are unique per user, so this IS their
      // existing character — ADOPT it (link the node + load its assets) and
      // return its id so the in-flight generation proceeds against it, instead
      // of dead-ending on "pick a different name".
      if (e instanceof CharacterNameTakenError) {
        if (e.existingId) {
          const adoptedName = stagedRef.current?.characterName?.trim()
          const dbId = await adoptCharacter(e.existingId)
          toast.success(adoptedName ? `Loaded your existing "${adoptedName}".` : "Loaded your existing character.")
          return dbId
        }
        toast.error(e.message)
        setSaveStatus("error")
      }
      throw e
    } finally {
      ensureInFlightRef.current = null
    }
  }, [nodeId, updateNodeData, flushSave, adoptCharacter])

  if (!staged) return null
  return {
    nodeId,
    staged,
    saveStatus,
    initialPendingJobs,
    initialPortraitCandidates,
    initialPreviousCandidates,
    patch,
    patchWith,
    ensureSaved,
  }
}
