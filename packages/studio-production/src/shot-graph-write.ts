/**
 * SERIALIZE — `shots[]` -> `{ nodes, edges, settings.studio:v3 }`: the canvas
 * node/edge builders and the one entry point, {@link serializeProduction}.
 * PURE: nothing here mutates its inputs (arrays are copied — the deep-copies
 * live in `shot-graph-wire.ts`). `shot-graph.ts` re-exports the entry point so
 * `shot-graph` stays the one import path.
 */
import type { GenericNode, GenericEdge } from "@nodaro/shared"

import { copyCast, copyCastLook, type Cast } from "./cast"
import { isEmptyPlan } from "./scene-plan"
import {
  copyDirection,
  copyStructured,
  copySubject,
  directionSpread,
  structuredSpread,
  subjectSpread,
} from "./shot-direction"
import type {
  PlanMusic,
  ProductionCut,
  ProductionFilmLook,
  ProductionFolder,
  ProductionMusic,
  Shot,
  ShotClip,
  ShotStill,
} from "./shot"
import { clipResults, copyMusicPlan, stillResults } from "./shot"
import type { TrashedItem } from "./trash"

import type {
  SerializedProduction,
  StoryboardSettings,
  StudioShotEntryV2,
} from "./shot-graph-types"
import {
  clipResultToWire,
  copyLookMap,
  copyPlan,
  stillResultToWire,
  trashItemToWire,
} from "./shot-graph-wire"

// ── canvas node/edge builders ────────────────────────────────────────────────
//
// The Nodaro CANVAS (React Flow) needs a `position` on every node — without it
// React Flow coerces position to {0,0} and stacks all nodes at the origin, so
// the workflow renders blank ("flow not loading") — plus a stable edge `id`.
// `@nodaro/shared`'s GenericNode/GenericEdge now carry these (optional) fields,
// so we set them directly; they ride through `workflows.update` as plain JSON
// (the backend stores nodes/edges verbatim) and are read by the canvas.

// Canvas layout grid: image column → video column → combine column; one row/shot.
// Spacing is tuned to Nodaro's REAL rendered node sizes (content-driven, NOT
// NODE_W): a generate-video node renders ~655w × ~368h (16:9), generate-image
// ~220², combine ~natural video. Columns clear the widest upstream node + a gap;
// rows clear the tallest (video). Nodaro honors explicit positions verbatim on
// load (no auto-relayout unless a node is position-less), so THESE are the layout
// — emit them generously so the graph opens looking Tidy-Up'd, not piled up.
const COL_X = { image: 0, video: 340, combine: 1120 } as const
const ROW_H = 460
const NODE_W = 220
/** Stable id for the single per-production combine-videos (export) node. */
const COMBINE_NODE_ID = "combine-videos-export"

/**
 * The generate-image canvas node for a still. Carries the result + inputs (so the
 * canvas card shows the image and the rehydrate path stays valid) PLUS a canvas
 * `position`/`width`/`label`.
 */
function imageNode(still: ShotStill, row: number, label: string): GenericNode {
  // ALL of the shot's generations → the canvas node's results list (Nodaro's
  // "images strip"). `activeResultIndex` is the frame the generate-video
  // startFrame edge animates; `generatedImageUrl` mirrors it (legacy flat read).
  const results = stillResults(still)
  return {
    id: still.nodeId,
    type: "generate-image",
    position: { x: COL_X.image, y: row * ROW_H },
    width: NODE_W,
    data: {
      label,
      prompt: still.prompt,
      provider: still.provider,
      generatedImageUrl: still.url,
      generatedResults: results.map(stillResultToWire),
      activeResultIndex: still.activeIndex ?? 0,
      // The cinematic channel as IDS, so a canvas re-run folds them server-side
      // (`readDirectionFields` → `assembleImageInput`) exactly like the studio
      // run that produced this node — instead of re-reading a baked prompt.
      // PLATFORM keys only; deep-copied so the emitted node never aliases store
      // state; omitted when empty so a direction-less still stays
      // byte-identical (`stillFromNode` reads both back).
      ...directionSpread(still.direction ? copyDirection(still.direction) : undefined),
      ...subjectSpread(
        still.subject ? copySubject(still.subject) : undefined,
      ),
      // The canvas's OWN Path-1 free-text fields, handed straight back. Studio
      // authors none, but this `data` is rebuilt from a fixed field list, so a
      // key that is read (`stillFromNode`) and not written here — or written
      // and not read — is erased from a canvas-authored production on the next
      // debounced save. Same rule as the two channels above; see `shot.ts`.
      ...structuredSpread(
        still.structured ? copyStructured(still.structured) : undefined,
      ),
    },
  }
}

/**
 * The generate-video canvas node for a clip, wired AFTER its still. Keeps
 * `imageUrl` in data (the executor reads it) plus the result + canvas fields.
 * `still` is OPTIONAL: a references-mode clip has no start-frame still, so the
 * node carries no `imageUrl` (the references ride on each result instead).
 */
function videoNode(
  still: ShotStill | undefined,
  clip: ShotClip,
  row: number,
  label: string,
): GenericNode {
  // ALL of the shot's clip generations → the canvas node's results list (the
  // video mirror of imageNode). `activeResultIndex` is the active clip;
  // `generatedVideoUrl` mirrors it (legacy flat read). Each result carries the
  // source start/end frames it was generated from (spec #9c) + prompt/jobId so
  // the round-trip is symmetric (`clipFromNode` reads them back).
  const results = clipResults(clip)
  return {
    id: clip.nodeId,
    type: "generate-video",
    position: { x: COL_X.video, y: row * ROW_H },
    width: NODE_W,
    data: {
      label,
      provider: clip.provider,
      prompt: clip.prompt,
      ...(still ? { imageUrl: still.url } : {}),
      generatedVideoUrl: clip.url,
      generatedResults: results.map(clipResultToWire),
      activeResultIndex: clip.activeIndex ?? 0,
      // Persist clip length so the round-trip is symmetric (`clipFromNode` reads
      // it back) and the canvas node carries it. Only when present.
      ...(clip.duration !== undefined ? { duration: clip.duration } : {}),
      // Re-voice provenance (studio-layer): when the clip came from the voice-changer
      // revoice, persist the target voice so the round-trip is symmetric and the card
      // can label it. The voice-changer follow-up job is transient — only this final
      // video node is persisted. Absent for a plain animate so an un-revoiced clip
      // stays byte-identical.
      ...(clip.revoicedVoiceId ? { revoicedVoiceId: clip.revoicedVoiceId } : {}),
      ...(clip.revoicedVoiceName
        ? { revoicedVoiceName: clip.revoicedVoiceName }
        : {}),
      // The still side's cinematic channel, on the video node. STORED, NOT YET
      // HONORED: the platform's canvas video executors read no direction today
      // (only `generate-image` does). Node data is `z.record(z.string(),
      // z.unknown())`, so unknown keys persist verbatim — zero double-fold risk
      // precisely BECAUSE nothing reads it, and the day the platform follow-up
      // lands every already-saved production is correct with no migration.
      ...directionSpread(clip.direction ? copyDirection(clip.direction) : undefined),
      ...subjectSpread(
        clip.subject ? copySubject(clip.subject) : undefined,
      ),
      // The canvas's own Path-1 fields — the `imageNode` passthrough, mirrored.
      ...structuredSpread(
        clip.structured ? copyStructured(clip.structured) : undefined,
      ),
    },
  }
}

/**
 * still -> clip edge. The canvas generate-video START-FRAME input handle is
 * `startFrame` (NOT `imageUrl`); using the wrong handle leaves the wire visually
 * unconnected in the canvas even though the executor still resolves the image.
 */
function stillToClipEdge(still: ShotStill, clip: ShotClip): GenericEdge {
  return {
    id: `e-${still.nodeId}-${clip.nodeId}`,
    source: still.nodeId,
    target: clip.nodeId,
    sourceHandle: "image",
    targetHandle: "startFrame",
  }
}

/**
 * The combine-videos (export) node — ONE per production, ties every clip
 * together so the persisted graph is a complete, runnable production in the
 * canvas. Placed in the combine column, vertically centered on the shot rows.
 */
function combineNode(centerRow: number): GenericNode {
  return {
    id: COMBINE_NODE_ID,
    type: "combine-videos",
    position: { x: COL_X.combine, y: centerRow * ROW_H },
    data: { label: "Combine shots" },
  }
}

/**
 * clip video -> combine `in` edge. N clips fan into the one combine node; edge
 * order (shot order) is the combine order (the `in` handle is order-sensitive).
 */
function clipToCombineEdge(clip: ShotClip): GenericEdge {
  return {
    id: `e-${clip.nodeId}-${COMBINE_NODE_ID}`,
    source: clip.nodeId,
    target: COMBINE_NODE_ID,
    sourceHandle: "video",
    targetHandle: "in",
  }
}

// ── serialize: shots[] -> { nodes, edges, settings.studio:v2 } ───────────────

/**
 * Storyboard for save — copy only the fields that carry content, so an unused
 * storyboard adds nothing to `settings.studio` (and a deleted shot's orphaned map
 * key still round-trips harmlessly). Returns undefined when entirely empty.
 */
function storyboardForSave(
  s: StoryboardSettings | undefined,
  liveIds: ReadonlySet<string>,
): StoryboardSettings | undefined {
  if (!s) return undefined
  // Prune the per-shot maps to the LIVE shot ids (copy) — a removed shot leaves no
  // orphan key accumulating in the persisted blob. `undefined` when a map empties.
  const prune = <V>(m: Record<string, V> | undefined): Record<string, V> | undefined => {
    if (!m) return undefined
    const out: Record<string, V> = {}
    for (const [k, v] of Object.entries(m)) if (liveIds.has(k)) out[k] = v
    return Object.keys(out).length > 0 ? out : undefined
  }
  const scripts = prune(s.scripts)
  const breakdowns = prune(s.breakdowns)
  const seconds = prune(s.seconds)
  const out: StoryboardSettings = {
    ...(s.on ? { on: true } : {}),
    ...(s.brief && s.brief.trim() ? { brief: s.brief } : {}),
    ...(s.filmLength != null ? { filmLength: s.filmLength } : {}),
    ...(scripts ? { scripts } : {}),
    ...(breakdowns ? { breakdowns } : {}),
    ...(seconds ? { seconds } : {}),
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * `shots[]` -> `{ nodes, edges, settings.studio:v2 }`. PURE, never mutates inputs.
 *
 * Per shot WITH a still: emit a generate-image node. Per shot ALSO with a clip:
 * emit a generate-video node + a still -> clip edge. Shots with no still emit
 * nothing to the graph but DO appear in `settings.studio.shots` (placeholder).
 *
 * `shotOrder` (derived) = `shots.flatMap(s => [s.still?.nodeId, s.clip?.nodeId])`
 * with the empties filtered out — still then its clip, per shot.
 */
export function serializeProduction(
  shots: ReadonlyArray<Shot>,
  selectedShotId: string | undefined,
  music?: ProductionMusic | undefined,
  shared?: boolean | undefined,
  folders?: ReadonlyArray<ProductionFolder> | undefined,
  storyboard?: StoryboardSettings | undefined,
  cuts?: ReadonlyArray<ProductionCut> | undefined,
  trash?: ReadonlyArray<TrashedItem> | undefined,
  freecutDraftUrl?: string | undefined,
  film?: ProductionFilmLook | undefined,
  cast?: Cast | undefined,
  musicPlan?: PlanMusic | undefined,
  archived?: boolean | undefined,
): SerializedProduction {
  const nodes: GenericNode[] = []
  const edges: GenericEdge[] = []
  const entries: StudioShotEntryV2[] = []
  const shotOrder: string[] = []
  // Clips in shot order — fanned into the one combine-videos node after the loop.
  const clips: ShotClip[] = []

  shots.forEach((shot, row) => {
    const entry: StudioShotEntryV2 = { id: shot.id }
    const mutableEntry = entry as {
      -readonly [K in keyof StudioShotEntryV2]: StudioShotEntryV2[K]
    }

    // Name + folder only when set, so an un-renamed/unfiled shot stays minimal.
    if (shot.name) mutableEntry.name = shot.name
    if (shot.folderId) mutableEntry.folderId = shot.folderId

    if (shot.still) {
      nodes.push(imageNode(shot.still, row, `Shot ${row + 1} frame`))
      shotOrder.push(shot.still.nodeId)
      mutableEntry.imageNodeId = shot.still.nodeId
      mutableEntry.stillProvider = shot.still.provider
    }

    // A clip rides on its still (start-frame edge) when there is one; a
    // references-mode clip has no still, so it emits a standalone video node (no
    // edge, no imageUrl — the references live on each result).
    if (shot.clip) {
      nodes.push(videoNode(shot.still, shot.clip, row, `Shot ${row + 1} video`))
      if (shot.still) edges.push(stillToClipEdge(shot.still, shot.clip))
      shotOrder.push(shot.clip.nodeId)
      clips.push(shot.clip)
      mutableEntry.videoNodeId = shot.clip.nodeId
      mutableEntry.clipProvider = shot.clip.provider
      if (shot.clip.duration !== undefined) {
        mutableEntry.clipDuration = shot.clip.duration
      }
    }

    // Voiceover is a studio-layer object (no node), persisted inline on the
    // entry. Copy it so the serialized index can't alias the store's object.
    // The spread carries every ShotVoice field (incl. voiceType) — keep it
    // whole; enumerating fields here would silently drop new ones on save.
    if (shot.voice) {
      mutableEntry.voice = { ...shot.voice }
    }

    // Start/end-frame keyframes — studio-layer inputs (no node), persisted inline
    // so they survive reload (consumed by generate-video at animate).
    if (shot.startFrame) {
      mutableEntry.startFrameUrl = shot.startFrame
    }
    if (shot.endFrame) {
      mutableEntry.endFrameUrl = shot.endFrame
    }

    // Directing references — studio-layer inputs (no node); they survive a still
    // re-frame like the keyframes. Absent when the shot uses none.
    if (shot.directingReferenceUrls?.length) {
      mutableEntry.directingReferenceUrls = [...shot.directingReferenceUrls]
    }
    if (shot.directingReferenceVideoUrls?.length) {
      mutableEntry.directingReferenceVideoUrls = [...shot.directingReferenceVideoUrls]
    }
    if (shot.directingReferenceAudioUrls?.length) {
      mutableEntry.directingReferenceAudioUrls = [...shot.directingReferenceAudioUrls]
    }

    // In-flight animate markers (studio-layer, no node; one per concurrent
    // render) — persisted so long renders resume on reload. Copy each so the
    // index can't alias the store objects.
    if (shot.pendingClips?.length) {
      mutableEntry.pendingClips = shot.pendingClips.map((p) => ({ ...p }))
    }

    // Motion beats (editor-v2 authoring state) — copied so the index can't
    // alias the store objects; picks copied per beat.
    if (shot.look && Object.keys(shot.look).length > 0) {
      mutableEntry.look = copyLookMap(shot.look)
    }

    // The scene's CAST LOOK pins — copied so the index can't alias the store,
    // and omitted when empty so an un-pinned scene stays byte-identical.
    if (shot.castLook && Object.keys(shot.castLook).length > 0) {
      mutableEntry.castLook = copyCastLook(shot.castLook)
    }

    if (shot.beats?.length) {
      mutableEntry.beats = shot.beats.map((b) => {
        // The two LIST fields come OUT before the spread: `...b` would carry an
        // empty `[]` through by REFERENCE (the conditional adds below can add a
        // key, never remove one), aliasing the persisted index to the store's
        // array — the exact thing this serializer exists to prevent.
        const { references, directions, ...rest } = b
        return {
          ...rest,
          ...(b.picks ? { picks: { ...b.picks } } : {}),
          ...(b.transition ? { transition: { ...b.transition } } : {}),
          ...(b.characterFx ? { characterFx: { ...b.characterFx } } : {}),
          ...(references?.length ? { references: [...references] } : {}),
          ...(directions?.length
            ? { directions: directions.map((d) => ({ ...d })) }
            : {}),
        }
      })
    }

    // The scene's GENERIC PROMPT — written only when it carries something (a
    // whitespace-only draft is nothing), so a scene without one is byte-identical.
    if (shot.scenePrompt?.trim()) {
      mutableEntry.scenePrompt = shot.scenePrompt
    }

    // How the scene GOES OUT — copied like a beat's own transition, so the
    // persisted index can never alias the store's node.
    if (shot.endTransition) {
      mutableEntry.endTransition = { ...shot.endTransition }
    }

    // The scene's authored PLAN — copied so the index can't alias the store's
    // object, and written only when it carries something, so a plan-less scene
    // stays byte-identical.
    if (shot.plan && !isEmptyPlan(shot.plan)) {
      mutableEntry.plan = copyPlan(shot.plan)
    }

    // Regeneration recipe (recipe-only imports) — copied per layer so the
    // index can't alias the store objects; read back by `readRecipe`.
    if (shot.recipe) {
      mutableEntry.recipe = {
        ...(shot.recipe.framing ? { framing: { ...shot.recipe.framing } } : {}),
        ...(shot.recipe.directing
          ? {
              directing: {
                ...shot.recipe.directing,
                ...(shot.recipe.directing.directions?.length
                  ? { directions: shot.recipe.directing.directions.map((d) => ({ ...d })) }
                  : {}),
              },
            }
          : {}),
        ...(shot.recipe.voice ? { voice: { ...shot.recipe.voice } } : {}),
      }
    }

    entries.push(entry)
  })

  // combine-videos needs ≥2 clips to run; only emit the export node once the
  // production has clips to combine (a 0/1-clip production isn't exportable yet).
  if (clips.length >= 2) {
    nodes.push(combineNode((shots.length - 1) / 2))
    for (const clip of clips) edges.push(clipToCombineEdge(clip))
  }

  const storyboardSaved = storyboardForSave(
    storyboard,
    new Set(shots.map((s) => s.id)),
  )
  return {
    nodes,
    edges,
    settings: {
      studio: {
        version: 3,
        shots: entries,
        selectedShotId,
        shotOrder,
        // Soundtrack only when present (keeps the no-audio shape minimal).
        ...(music ? { music: { ...music } } : {}),
        // Share flag only when shared (keeps the private shape minimal).
        ...(shared ? { shared: true } : {}),
        // Folders only when at least one exists (copy so we don't alias state).
        ...(folders && folders.length
          ? { folders: folders.map((f) => ({ ...f })) }
          : {}),
        // Storyboard state only when it carries content (pruned copy; never aliased).
        ...(storyboardSaved ? { storyboard: storyboardSaved } : {}),
        // The saved FreeCut cut versions only once any exist (copies).
        ...(cuts && cuts.length ? { cuts: cuts.map((c) => ({ ...c })) } : {}),
        // The Save & Exit draft pointer only while one is outstanding.
        ...(freecutDraftUrl ? { freecutDraftUrl } : {}),
        // The clip recycle bin only once something has been deleted. Each entry's
        // result goes through the SAME wire mapper as a live clip result, so a
        // restored clip carries everything the original did.
        // Cast: the wire form is a plain JSON projection of the entries (the
        // reader narrows it back via readTrash), not the runtime type.
        ...(trash && trash.length
          ? { trash: trash.map(trashItemToWire) as unknown as TrashedItem[] }
          : {}),
        ...(film && Object.keys(film).length > 0
          ? { film: copyLookMap(film) }
          : {}),
        // The project cast — copied so the persisted blob never aliases store
        // state, and omitted when empty so a cast-less production round-trips
        // byte-identically (`cast: {}` must never ride).
        ...(cast && Object.keys(cast).length > 0 ? { cast: copyCast(cast) } : {}),
        // The soundtrack PLAN — copied so the persisted blob never aliases
        // store state, and omitted when absent (plan-import-v2 D5).
        ...(musicPlan ? { musicPlan: copyMusicPlan(musicPlan) } : {}),
        // The soft-hide flag only when archived (keeps the visible shape
        // minimal, exactly like `shared`). A full-graph save replaces this
        // block whole, so leaving it off here silently UNARCHIVES the
        // production on the next write (A4).
        ...(archived ? { archived: true } : {}),
      },
    },
  }
}
