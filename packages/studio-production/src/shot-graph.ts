import type { WorkflowLike as Workflow } from "./workflow-like"
import { readCast, readCastLookMap, type Cast } from "./cast"
import { readPlan } from "./scene-plan"

import type {
  Shot,
  PlanMusic,
  ProductionMusic,
  ProductionFolder,
  ProductionCut,
  ProductionFilmLook,
} from "./shot"
import type { TrashedItem } from "./trash"

import type { StoryboardSettings } from "./shot-graph-types"
import {
  readBeats,
  readLookMap,
  readPendingClips,
  readRecipe,
  readString,
  readStringArray,
  readTransition,
  readVoice,
} from "./shot-graph-read"
import { clipFromNode, stillFromNode } from "./shot-graph-read-results"
import {
  isStudioIndex,
  readCuts,
  readFolders,
  readMusic,
  readMusicPlan,
  readStoryboard,
  readTrash,
} from "./shot-graph-read-production"

/**
 * The graph <-> shots mapping — the SINGLE source of truth for how a production's
 * ordered `Shot[]` is persisted into a Nodaro workflow and rehydrated back.
 *
 * Two layers, by design (matches today's Studio.tsx, just multi-shot):
 *   - `settings.studio` (v3)  = the timeline INDEX: shot order + which node ids
 *     belong to each shot + denormalized labels + the AUDIO layer (per-shot
 *     `voice` + production `music`, which have no canvas node).
 *   - `workflow.nodes[]/edges[]` = the ACTUAL canvas nodes: one `generate-image`
 *     per still (+ one `generate-video` per clip, wired still -> clip) so the
 *     production stays editable in the Nodaro canvas and round-trips on reload.
 *
 * `serializeProduction` emits BOTH from `shots[]` (full-graph replace on every
 * save — never persist a partial slice). `parseProduction` reconstructs `shots[]`
 * from a loaded `Workflow`, preferring the v2 index and falling back to a v1/
 * legacy MIGRATION (first generate-image + first generate-video -> one Shot),
 * exactly like the old single-shot rehydrate.
 *
 * PURE: nothing here mutates its inputs (arrays are copied).
 */

// ── settings.studio shapes ──────────────────────────────────────────────────
//
// The persisted shapes live in `shot-graph-types.ts`; re-exported here so
// `shot-graph` stays the one import path for the graph <-> shots contract.
export type {
  SerializedProduction,
  StoryboardSettings,
  StudioSettingsV1,
  StudioSettingsV3,
  StudioShotEntryV2,
} from "./shot-graph-types"

// ── wire mappers ───────────────────────────────────────────────────────────
//
// One live record -> the plain JSON actually persisted; they live in
// `shot-graph-wire.ts`, re-exported here for the one import path.
export { clipResultToWire, stillResultToWire } from "./shot-graph-wire"

// ── serialize: shots[] -> { nodes, edges, settings.studio:v3 } ──────────────
//
// The canvas node/edge builders + the entry point live in `shot-graph-write.ts`.
export { serializeProduction } from "./shot-graph-write"

// ── parse: Workflow -> { shots, selectedShotId } ─────────────────────────────
//
// The narrowers over the untrusted persisted blob live in `shot-graph-read.ts`
// (scalars + the per-shot index readers), `shot-graph-read-results.ts` (the
// result lists + the node readers) and `shot-graph-read-production.ts` (the
// production-level `settings.studio` readers); `studioIndexExpectsShots` is
// re-exported from the last so `shot-graph` stays the one import path.
export { studioIndexExpectsShots } from "./shot-graph-read-production"

/**
 * `Workflow` -> `Shot[]`. PRECEDENCE:
 *  - `settings.studio.version === 2|3` -> authoritative: map each entry to a Shot,
 *    hydrating still/clip from the referenced nodes (+ inline `voice`). Entries
 *    whose image node is missing or url-less are dropped (a placeholder lost on
 *    reload — acceptable; an empty shot has no node to persist).
 *  - else (v1 OR absent) -> MIGRATE: find the FIRST generate-image node (+ the
 *    FIRST generate-video) exactly like the old Studio.tsx rehydrate, wrapped as
 *    a single Shot with a fresh uuid.
 *
 * `music` (production soundtrack) rides on the v3 index; undefined for v2/legacy.
 * Returns `[]` shots when no usable image node exists (a fresh production).
 */
export function parseProduction(wf: Workflow): {
  shots: Shot[]
  selectedShotId?: string
  music?: ProductionMusic
  shared?: boolean
  folders?: ProductionFolder[]
  storyboard?: StoryboardSettings
  cuts?: ProductionCut[]
  freecutDraftUrl?: string
  trash?: TrashedItem[]
  /** The production-wide FILM look (see StudioSettingsV3.film). */
  film?: ProductionFilmLook
  /** The project CAST (see StudioSettingsV3.cast); absent = today's behavior. */
  cast?: Cast
  /** The soundtrack PLAN (see StudioSettingsV3.musicPlan, plan-import-v2 D5). */
  musicPlan?: PlanMusic
  /** The dashboard SOFT-HIDE flag (see StudioSettingsV3.archived); every
   *  read-modify-write persister must hand it back to `serializeProduction`. */
  archived?: boolean
} {
  const nodes = wf.nodes ?? []
  const studio = (wf.settings as { studio?: unknown } | undefined)?.studio

  // ── v2/v3: the index is authoritative. ──
  if (isStudioIndex(studio)) {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const shots: Shot[] = []
    for (const entry of studio.shots) {
      const still = stillFromNode(
        entry.imageNodeId ? byId.get(entry.imageNodeId) : undefined,
      )
      const clip = clipFromNode(
        entry.videoNodeId ? byId.get(entry.videoNodeId) : undefined,
      )
      // Keep an intentional PLACEHOLDER (a storyboard shot before it's framed — it
      // references no node) so the shot list survives a reload. Drop only a LOST
      // entry: one that CLAIMS a node which has vanished (the overwrite-trap; an
      // all-lost index is caught by the hydrate's node-backed-count guard). A
      // references-mode clip has no still but IS shown (its refs are the input).
      const isPlaceholder = !entry.imageNodeId && !entry.videoNodeId
      if (!still && !clip && !isPlaceholder) continue
      const voice = readVoice(entry.voice)
      const name = readString(entry.name)
      const folderId = readString(entry.folderId)
      const startFrame = readString(entry.startFrameUrl)
      const endFrame = readString(entry.endFrameUrl)
      const directingReferenceUrls = readStringArray(entry.directingReferenceUrls)
      const directingReferenceVideoUrls = readStringArray(entry.directingReferenceVideoUrls)
      const directingReferenceAudioUrls = readStringArray(entry.directingReferenceAudioUrls)
      const pendingClips = readPendingClips(entry)
      const beats = readBeats(entry.beats)
      const scenePrompt = readString(entry.scenePrompt)
      // The SCENE's own transition node, through the same narrower a beat's
      // gets — written by the serializer above, so a field not read back here
      // would be ERASED on the next save (the readVoice lesson).
      const endTransition = readTransition(entry.endTransition)
      const look = readLookMap(entry.look)
      const castLook = readCastLookMap(entry.castLook)
      const plan = readPlan(entry.plan)
      const recipe = readRecipe(entry.recipe)
      let shot: Shot = {
        id: entry.id,
        ...(still ? { still } : {}),
        ...(clip ? { clip } : {}),
      }
      if (name) shot = { ...shot, name }
      if (folderId) shot = { ...shot, folderId }
      if (voice) shot = { ...shot, voice }
      if (startFrame) shot = { ...shot, startFrame }
      if (endFrame) shot = { ...shot, endFrame }
      if (directingReferenceUrls) shot = { ...shot, directingReferenceUrls }
      if (directingReferenceVideoUrls) shot = { ...shot, directingReferenceVideoUrls }
      if (directingReferenceAudioUrls) shot = { ...shot, directingReferenceAudioUrls }
      if (pendingClips) shot = { ...shot, pendingClips }
      if (beats) shot = { ...shot, beats }
      if (scenePrompt) shot = { ...shot, scenePrompt }
      if (endTransition) shot = { ...shot, endTransition }
      if (look) shot = { ...shot, look }
      if (castLook) shot = { ...shot, castLook }
      if (plan) shot = { ...shot, plan }
      if (recipe) shot = { ...shot, recipe }
      shots.push(shot)
    }
    // Keep the selection only if it still maps to a surviving shot.
    const selectedShotId =
      studio.selectedShotId && shots.some((s) => s.id === studio.selectedShotId)
        ? studio.selectedShotId
        : shots[0]?.id
    return {
      shots,
      selectedShotId,
      music: readMusic(studio.music),
      shared: studio.shared === true ? true : undefined,
      folders: readFolders(studio.folders),
      storyboard: readStoryboard((studio as { storyboard?: unknown }).storyboard),
      cuts: readCuts(studio as unknown as Record<string, unknown>),
      freecutDraftUrl: readString(
        (studio as { freecutDraftUrl?: unknown }).freecutDraftUrl,
      ),
      trash: readTrash((studio as { trash?: unknown }).trash),
      film: readLookMap((studio as { film?: unknown }).film),
      cast: readCast((studio as { cast?: unknown }).cast),
      musicPlan: readMusicPlan((studio as { musicPlan?: unknown }).musicPlan),
      archived:
        (studio as { archived?: unknown }).archived === true ? true : undefined,
    }
  }

  // ── v1 / legacy / absent: migrate the first still (+ first clip) to one Shot. ──
  const still = stillFromNode(nodes.find((n) => n.type === "generate-image"))
  if (!still) return { shots: [] }
  const clip = clipFromNode(nodes.find((n) => n.type === "generate-video"))
  const shot: Shot = clip
    ? { id: crypto.randomUUID(), still, clip }
    : { id: crypto.randomUUID(), still }
  return { shots: [shot], selectedShotId: shot.id }
}
