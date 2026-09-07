/**
 * The `clips` section — a shot's VIDEO history.
 *
 * Four operations, the server-side twins of `addShotClipResult` /
 * `setActiveClipResult` / `removeShotClipResult` (`production-store-clips.ts`)
 * and `setClipResultName` (`production-store-stills.ts`, where the rename lives
 * because it is the same edit one history over). A shot's clip is one
 * `generate-video` node with a list of takes under it: appending never replaces
 * (the editor is non-blocking, so two renders can land at once), the clip level
 * MIRRORS the active take, and a lone take collapses to the minimal legacy
 * shape only when it carries nothing that shape cannot hold.
 *
 * The asymmetry with `stills`, and the reason this file is not a copy of that
 * one: **stepping the active take restores the INPUTS it was made from.** A
 * still's history is a gallery — picking a past frame moves nothing. A clip's
 * is a record of renders, and each take stores the start/end frames or the
 * reference rail it was animated from (#9c, D27), so selecting one puts the
 * shot back into the setup that produced it. `set_active_clip` is the only
 * operation in either section that writes fields outside its own history.
 *
 * Three things this file does differently from the reducers it generalises, all
 * mandated by `../SECTIONS.md` rather than chosen here:
 *
 *  - **A missing target throws.** The reducers no-op on an unknown shot, a
 *    shot with no clip and an out-of-range index — right for a click that raced
 *    a delete, wrong for a batch, which is atomic: the same silence would apply
 *    the ops around a mis-addressed one and report success. A GENUINE no-op
 *    that names real things (the already-active take, an unchanged name) stays
 *    a no-op and gains a warning.
 *  - **A take is addressed by `ResultKey`, never by index.** Two writers hold
 *    one production open by design, so a position is stale the moment either
 *    appends; the handler resolves the key to the index the reducer wanted.
 *  - **Nothing ambient.** The bin entry's id and timestamp come from
 *    `ctx.mintId` / `ctx.now`, never `crypto.randomUUID()` / `new Date()`.
 *
 * Pure and copy-on-write throughout.
 */
import { z } from "zod"

import type { ConnectedReference } from "@nodaro/shared"

import { resultKey } from "../../result-key"
import { readBeats, readTransition } from "../../shot-graph-read"
import { buildClip, clipResults } from "../../shot"
import type {
  LookSelectionMap,
  Shot,
  ShotBeat,
  ShotClip,
  ShotClipResult,
  ShotRecipe,
  ShotTransition,
} from "../../shot"
import { readVoiceDirections, type VoiceDirection } from "../../voice-direction"
import {
  carryDirection,
  carryStructured,
  resultDirection,
} from "../../shot-direction"
import { appendToTrash, type TrashedClip } from "../../trash"
import { opError } from "../errors"
import type { Production } from "../production"
import type { OpContext, SectionClasses, SectionHandlers } from "../types"

// ── schema helpers ──────────────────────────────────────────────────────────

/**
 * The payload of an append: a take, plus the two CLIP-level provenance fields a
 * re-voiced append carries (`production-store-state.ts` L312 declares exactly
 * this intersection).
 */
export type ClipResultInput = ShotClipResult & {
  readonly revoicedVoiceId?: string
  readonly revoicedVoiceName?: string
}

/**
 * `pickerKey → catalog id`, or a multi-pick list of them — the still section's
 * own shape, copied rather than imported (rule 7: a section never reaches into
 * another section's file). The `.readonly()` arm is what makes the parsed args
 * a {@link LookSelectionMap} instead of a mutable look-alike.
 */
const lookSelectionMap = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()).readonly()]),
)

/** The platform-keyed Person / Styling / prop bag. Its numeric arm is real
 *  (`customAge`), which is the only thing that separates it from a look map. */
const subjectFields = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()).readonly(), z.number()]),
)

/** A bound `@`-chip carried on a take, passed through UNTOUCHED — the four
 *  fields that make a reference a reference; the thirty-odd provenance fields
 *  beside them ride along as they came, so this cannot drift from the
 *  platform's interface the way a hand-built object schema would. */
const connectedReference = z.custom<ConnectedReference>((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.defaultName === "string" &&
    typeof v.source === "string" &&
    typeof v.url === "string"
  )
}, "Not a connected reference.")

/**
 * The three STRUCTURED channels a take carries that a still has no mirror of —
 * the timed shots, the `/` voice-direction cues and the way out.
 *
 * Their gate is the codec's OWN reader rather than a zod restatement, for the
 * reason `shots`' plan stages have one: a beat carries ten fields (references,
 * picks, an incoming transition, a Character FX node, its own cues) and a zod
 * copy of that vocabulary would be a second spelling that drifts the first time
 * a lever is added. `readBeats` / `readVoiceDirections` / `readTransition` are
 * what a reloaded workflow narrows the same blob through, so "the operation
 * accepts it" and "the document can hold it" are ONE answer. The empty array is
 * let through explicitly: those readers report emptiness as `undefined`, and
 * `buildTake`'s omit-when-empty already says what an empty list means.
 */
const readable = <T>(
  read: (value: unknown) => unknown,
  message: string,
): z.ZodType<T> =>
  z.custom<T>((value) => read(value) !== undefined, message)

const beatList = z.custom<ReadonlyArray<ShotBeat>>(
  (value) => Array.isArray(value) && (value.length === 0 || readBeats(value) !== undefined),
  "Not a beat list.",
)

const voiceDirectionList = z.custom<ReadonlyArray<VoiceDirection>>(
  (value) =>
    Array.isArray(value) &&
    (value.length === 0 || readVoiceDirections(value) !== undefined),
  "Not a voice-direction list.",
)

const shotTransition = readable<ShotTransition>(readTransition, "Not a transition.")

/**
 * ONE landing render — {@link ShotClipResult} on the wire, field by field.
 *
 * The still section states its result the same way and for the same reason: the
 * handler's `buildTake` narrows by PRESENCE (`result.x ? { x } : {}`), never by
 * TYPE, so whatever the schema lets past is what lands in the document, rides
 * the CAS write and is serialized onto the canvas `generate-video` node. A
 * predicate that checked only "an object with a string url" let a `duration:
 * "5"` mirror onto the clip, turned a `beats: "abc"` into `["a","b","c"]`, made
 * a `jobId: 5` take unaddressable by its own {@link ResultKey} — and, worst,
 * let `[...result.references]` throw a `TypeError` out of a handler, which
 * `apply.ts` defines as a bug in this package (a 500 the caller retries instead
 * of the 400 it deserves).
 *
 * `url` is `.min(1)`: it is the fallback half of a take's {@link ResultKey}, so
 * a blank one is a take nothing in the same batch could address.
 */
const clipResultSchema = z.object({
  url: z.string().min(1),
  jobId: z.string().optional(),
  name: z.string().optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  provider: z.string().optional(),
  duration: z.number().optional(),
  startFrameUrl: z.string().optional(),
  endFrameUrl: z.string().optional(),
  referenceImageUrls: z.array(z.string()).readonly().optional(),
  referenceVideoUrls: z.array(z.string()).readonly().optional(),
  referenceAudioUrls: z.array(z.string()).readonly().optional(),
  references: z.array(connectedReference).readonly().optional(),
  directions: voiceDirectionList.optional(),
  beats: beatList.optional(),
  scenePrompt: z.string().optional(),
  endTransition: shotTransition.optional(),
  freecutProjectUrl: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  promptFormat: z.literal(2).optional(),
  look: lookSelectionMap.optional(),
  filmLook: lookSelectionMap.optional(),
  sceneLook: lookSelectionMap.optional(),
  subject: subjectFields.optional(),
  // The two CLIP-level fields a re-voiced append carries with its take.
  revoicedVoiceId: z.string().optional(),
  revoicedVoiceName: z.string().optional(),
})

/** The parsed argument IS a {@link ClipResultInput} — asserted here rather than
 *  hoped for, so a field added to the codec's type without a line above fails
 *  `tsc` in this file instead of being erased on the way to the graph. */
const clipResultInput: z.ZodType<ClipResultInput> = clipResultSchema

// ── the schemas (arg names and shapes verbatim from SECTIONS.md §7) ─────────

export const clipsOpSchemas = {
  add_clip_result: z.object({
    op: z.literal("add_clip_result"),
    shotId: z.string().min(1),
    result: clipResultInput,
    /** Insert as take #1 and show it — the continuity opening. */
    atFront: z.boolean().optional(),
  }),
  set_active_clip: z.object({
    op: z.literal("set_active_clip"),
    shotId: z.string().min(1),
    /** `ResultKey` — the take's `jobId`, else its `url`. */
    result: z.string().min(1),
  }),
  remove_clip_result: z.object({
    op: z.literal("remove_clip_result"),
    shotId: z.string().min(1),
    result: z.string().min(1),
  }),
  rename_clip_result: z.object({
    op: z.literal("rename_clip_result"),
    shotId: z.string().min(1),
    result: z.string().min(1),
    /** Blank once trimmed CLEARS the name (back to the derived "Take N"). */
    name: z.string(),
  }),
} as const

// ── classes ─────────────────────────────────────────────────────────────────
//
// Only the removal is a delete, and it is trash-backed: the take moves to the
// bin with the node identity needed to rebuild the clip, so nothing a render
// spent credits on is destroyed here. `purge_trashed` / `clear_trash` are the
// only operations that destroy media references.

export const clipsOpClasses: SectionClasses<typeof clipsOpSchemas> = {
  add_clip_result: "S",
  set_active_clip: "S",
  remove_clip_result: "D",
  rename_clip_result: "S",
}

// ── local helpers ───────────────────────────────────────────────────────────
//
// The last two are the store's `production-store-helpers.ts` pair, copied here
// because the codec has no equivalent and a section may not reach into another
// section's file (rule 7). Both are the studio functions verbatim, minus the
// store's `directingRefField` indirection — this file names the three fields
// directly because `set_active_clip` writes all three at once.

/** The shot with this id, with its index, or a refusal naming it. */
function requireShot(
  production: Production,
  shotId: string,
): { shot: Shot; index: number } {
  const index = production.shots.findIndex((s) => s.id === shotId)
  const shot = production.shots[index]
  if (!shot) {
    throw opError("op_target_missing", `No shot ${shotId} in this production.`)
  }
  return { shot, index }
}

/**
 * How the user sees a shot: its name when it has one, else its 1-based timeline
 * position. Never an id — receipts are prose (SECTIONS.md).
 *
 * The name is TRIMMED before it counts, the way every other derivation of a
 * shot's display name trims (`shotDisplayName`, `clipTakeDisplayName`): a shot
 * named `"   "` is a shot with no name, and reading it straight produced
 * `"Added take 1 to    ."` — a receipt naming nothing.
 */
function shotLabel(shot: Shot, index: number): string {
  return shot.name?.trim() || `Shot ${index + 1}`
}

/** How the user sees a take: its 1-based position in the clip's history. */
function takeLabel(resultIndex: number): string {
  return `take ${resultIndex + 1}`
}

/**
 * The shot, its clip, its takes and the position of the addressed one — the
 * resolution every operation but the append performs first.
 *
 * A shot with no clip and a key that names no take are both
 * `op_target_missing`: the reducers no-op on either, and an operation may not
 * (see the header).
 */
function requireTake(
  production: Production,
  shotId: string,
  key: string,
): {
  shot: Shot
  shotIndex: number
  clip: ShotClip
  results: ReadonlyArray<ShotClipResult>
  index: number
} {
  const { shot, index: shotIndex } = requireShot(production, shotId)
  const clip = shot.clip
  if (!clip) {
    throw opError(
      "op_target_missing",
      `${shotLabel(shot, shotIndex)} has no clip.`,
    )
  }
  const results = clipResults(clip)
  const index = results.findIndex((r) => resultKey(r) === key)
  if (index < 0) {
    throw opError(
      "op_target_missing",
      `No take ${key} on ${shotLabel(shot, shotIndex)}.`,
    )
  }
  return { shot, shotIndex, clip, results, index }
}

/** Replace one shot, copy-on-write. */
function withShotAt(
  production: Production,
  index: number,
  shot: Shot,
): Production {
  const shots = [...production.shots]
  shots[index] = shot
  return { ...production, shots }
}

/** Set (or CLEAR) one directing-reference field — the key dropped, never
 *  blanked, so the serialized shape stays minimal. */
function withDirectingRefs(
  shot: Shot,
  field:
    | "directingReferenceUrls"
    | "directingReferenceVideoUrls"
    | "directingReferenceAudioUrls",
  urls: ReadonlyArray<string> | undefined,
): Shot {
  if (urls && urls.length > 0) return { ...shot, [field]: [...urls] }
  if (!shot[field]) return shot
  const copy = { ...shot }
  delete (copy as Record<string, unknown>)[field]
  return copy
}

/** Drop a CONSUMED recipe layer off a shot (recipe-only imports): a landing
 *  clip consumes `directing` — real work must replace the stored regeneration
 *  inputs, or a stale recipe would shadow it forever. A recipe-less shot
 *  returns UNCHANGED (identity), so every ordinary path pays nothing. */
function consumeRecipe(shot: Shot, layer: "directing"): Shot {
  if (!shot.recipe?.[layer]) return shot
  const rest: ShotRecipe = { ...shot.recipe }
  delete (rest as Record<string, unknown>)[layer]
  const next: Shot = { ...shot }
  if (Object.keys(rest).length > 0) {
    ;(next as { recipe?: ShotRecipe }).recipe = rest
  } else {
    delete (next as { recipe?: ShotRecipe }).recipe
  }
  return next
}

/**
 * The take this append stores — every optional field of `ShotClipResult`,
 * copied one by one.
 *
 * Enumerated on purpose, and the enumeration is load-bearing: a field this
 * builder skips is silently ERASED before it ever reaches the graph, so the
 * live editor shows chips and a reload restores flat text. Arrays and the
 * transition are COPIED, never aliased — the take lands in a document the
 * caller still holds a reference to.
 *
 * `startFrameUrl`/`endFrameUrl` fall back to the shot's CURRENT frames (#9c):
 * the take records what it was animated from. References mode COEXISTS with
 * both frames (D27 — the server folds a lone last frame into the references),
 * so a references take records its rail AND its frames, on one rule for every
 * mode. Absent ones are omitted so a frame-less take stays minimal.
 */
function buildTake(shot: Shot, result: ClipResultInput): ShotClipResult {
  const referenceImageUrls = result.referenceImageUrls?.length
    ? result.referenceImageUrls
    : undefined
  const startFrameUrl = result.startFrameUrl ?? shot.startFrame
  const endFrameUrl = result.endFrameUrl ?? shot.endFrame
  return {
    url: result.url,
    ...(result.jobId ? { jobId: result.jobId } : {}),
    ...(result.prompt ? { prompt: result.prompt } : {}),
    ...(result.negativePrompt ? { negativePrompt: result.negativePrompt } : {}),
    // Per-take model + length (the video mirror of a still result's provider) —
    // restored into the directing composer on take-select.
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.duration !== undefined ? { duration: result.duration } : {}),
    ...(startFrameUrl ? { startFrameUrl } : {}),
    ...(endFrameUrl ? { endFrameUrl } : {}),
    ...(referenceImageUrls
      ? { referenceImageUrls: [...referenceImageUrls] }
      : {}),
    ...(result.referenceVideoUrls?.length
      ? { referenceVideoUrls: [...result.referenceVideoUrls] }
      : {}),
    ...(result.referenceAudioUrls?.length
      ? { referenceAudioUrls: [...result.referenceAudioUrls] }
      : {}),
    // The bound `@`-entity chips and the `/` voice-direction chips — kept on the
    // take so both REBUILD on select / reload instead of degrading to text.
    ...(result.references?.length ? { references: [...result.references] } : {}),
    ...(result.directions?.length ? { directions: [...result.directions] } : {}),
    ...(result.freecutProjectUrl
      ? { freecutProjectUrl: result.freecutProjectUrl }
      : {}),
    // The name, the SHOTS this take was authored from, the scene prompt it was
    // made under and the way out it was folded with — without them, selecting a
    // past take restores its prose under whatever is standing now.
    ...(result.name ? { name: result.name } : {}),
    ...(result.beats?.length ? { beats: [...result.beats] } : {}),
    ...(result.scenePrompt ? { scenePrompt: result.scenePrompt } : {}),
    ...(result.endTransition
      ? { endTransition: { ...result.endTransition } }
      : {}),
    ...(result.aspectRatio ? { aspectRatio: result.aspectRatio } : {}),
    ...(result.resolution ? { resolution: result.resolution } : {}),
    // The prompt-format marker + its ids (omit-when-empty: a `look: {}` would
    // read as "an armed selection of nothing" on restore).
    ...(result.promptFormat !== undefined
      ? { promptFormat: result.promptFormat }
      : {}),
    ...(result.look && Object.keys(result.look).length
      ? { look: result.look }
      : {}),
    ...(result.filmLook && Object.keys(result.filmLook).length
      ? { filmLook: result.filmLook }
      : {}),
    ...(result.sceneLook && Object.keys(result.sceneLook).length
      ? { sceneLook: result.sceneLook }
      : {}),
    ...(result.subject && Object.keys(result.subject).length
      ? { subject: result.subject }
      : {}),
  }
}

/**
 * The existing takes, with the RE-EXPANSION BACKFILL applied.
 *
 * A lone first take collapses to the bare `{ url }` shape, so its model and
 * length survive only at the CLIP level (which was seeded from it). The clip
 * level now MIRRORS the active take, so appending a second would move it — and
 * the first take's provider/duration would be gone from the document entirely
 * (stepping back to the 5s original would show the new take's 1.9s). Copy them
 * back onto the re-expanded first take, only where absent there and present on
 * the clip.
 */
function reexpanded(clip: ShotClip | undefined): ReadonlyArray<ShotClipResult> {
  const raw = clip ? clipResults(clip) : []
  if (raw.length !== 1 || !clip) return raw
  return raw.map((r) => ({
    ...r,
    ...(r.provider === undefined && clip.provider
      ? { provider: clip.provider }
      : {}),
    ...(r.duration === undefined && clip.duration !== undefined
      ? { duration: clip.duration }
      : {}),
  }))
}

// ── the handlers ────────────────────────────────────────────────────────────

export const clipsHandlers: SectionHandlers<typeof clipsOpSchemas> = {
  /**
   * Append a rendered take to the shot's clip (creating it on the first).
   *
   * The node id is STABLE per shot, so every take accumulates under ONE
   * `generate-video` node, and a clip may grow on a shot with no still: a
   * references-mode take has no start frame, the rail IS the input.
   *
   * The clip base is ASYMMETRIC — `prompt` falls back to the existing clip's —
   * and the cinematic channel travels WITH the prompt (INV-D). So a promptless
   * append (the re-voice chain) INHERITS the clip's direction rather than
   * clearing it; a prompt-bearing marked take rebases both; an unmarked one
   * clears direction while rebasing prompt, because its prose has the clauses
   * baked in and live ids beside it would fold them twice.
   */
  add_clip_result: (production, op, _ctx) => {
    const { shot, index: shotIndex } = requireShot(production, op.shotId)
    const prev = reexpanded(shot.clip)
    const take = buildTake(shot, op.result)
    const results = op.atFront ? [take, ...prev] : [...prev, take]
    const activeIndex = op.atFront ? 0 : results.length - 1
    // Direction is rebased by EXACTLY the expression that rebases `prompt`.
    const clipDirection =
      op.result.prompt !== undefined
        ? resultDirection(op.result, "video")
        : carryDirection(shot.clip ?? {})
    const clip = buildClip(
      {
        nodeId: shot.clip?.nodeId ?? `generate-video-${op.shotId}`,
        provider: shot.clip?.provider ?? op.result.provider,
        prompt: op.result.prompt ?? shot.clip?.prompt,
        ...clipDirection,
        duration: shot.clip?.duration ?? op.result.duration,
        // A caller-supplied voice (a re-voiced append) WINS; else the existing
        // clip's is preserved (a plain append after a re-voice keeps the voice).
        revoicedVoiceId: op.result.revoicedVoiceId ?? shot.clip?.revoicedVoiceId,
        revoicedVoiceName:
          op.result.revoicedVoiceName ?? shot.clip?.revoicedVoiceName,
      },
      results,
      activeIndex,
    )
    // A landing clip CONSUMES the recipe's directing layer (recipe-only imports).
    const next = consumeRecipe({ ...shot, clip }, "directing")
    return {
      production: withShotAt(production, shotIndex, next),
      receipt: {
        op: "add_clip_result",
        summary: `Added ${takeLabel(activeIndex)} to ${shotLabel(
          shot,
          shotIndex,
        )}.`,
      },
    }
  },

  /**
   * Show a past take — and put the shot back into the setup that made it.
   *
   * The ONE asymmetry with `set_active_still`, which moves nothing: a take made
   * from KEYFRAMES restores its start/end frames and clears any stale reference
   * rail; a take made from REFERENCES restores every reference kind plus the
   * end frame it was made with (D27), and clears a stale end frame when it
   * recorded none. A frame the take did not store is never clobbered with
   * `undefined` — the user's live pin stands.
   */
  set_active_clip: (production, op, _ctx) => {
    const { shot, shotIndex, clip, results, index } = requireTake(
      production,
      op.shotId,
      op.result,
    )
    const label = `${takeLabel(index)} of ${shotLabel(shot, shotIndex)}`
    if (index === (clip.activeIndex ?? 0)) {
      return {
        production,
        receipt: { op: "set_active_clip", summary: `Selected ${label}.` },
        warnings: [`${label} was already showing.`],
      }
    }
    const picked = results[index]!
    let next: Shot = { ...shot, clip: buildClip(clip, results, index) }
    // A take used references if it carried references of ANY kind (a
    // video-/audio-only reference take has no image refs).
    const hasRefs =
      (picked.referenceImageUrls?.length ?? 0) > 0 ||
      (picked.referenceVideoUrls?.length ?? 0) > 0 ||
      (picked.referenceAudioUrls?.length ?? 0) > 0
    if (hasRefs) {
      next = withDirectingRefs(
        next,
        "directingReferenceUrls",
        picked.referenceImageUrls,
      )
      next = withDirectingRefs(
        next,
        "directingReferenceVideoUrls",
        picked.referenceVideoUrls,
      )
      next = withDirectingRefs(
        next,
        "directingReferenceAudioUrls",
        picked.referenceAudioUrls,
      )
      if (picked.endFrameUrl) {
        next = { ...next, endFrame: picked.endFrameUrl }
      } else if (next.endFrame) {
        next = { ...next }
        delete (next as { endFrame?: string }).endFrame
      }
    } else {
      if (picked.startFrameUrl) next = { ...next, startFrame: picked.startFrameUrl }
      if (picked.endFrameUrl) next = { ...next, endFrame: picked.endFrameUrl }
      // Clear stale references (every kind) from the previously-active
      // references take — the restored setup reflects THIS take only.
      next = withDirectingRefs(next, "directingReferenceUrls", undefined)
      next = withDirectingRefs(next, "directingReferenceVideoUrls", undefined)
      next = withDirectingRefs(next, "directingReferenceAudioUrls", undefined)
    }
    const restored = hasRefs
      ? " (restored its references)"
      : picked.startFrameUrl || picked.endFrameUrl
        ? " (restored its frames)"
        : ""
    return {
      production: withShotAt(production, shotIndex, next),
      receipt: {
        op: "set_active_clip",
        summary: `Selected ${label}${restored}.`,
      },
    }
  },

  /**
   * Delete a take — to the BIN, never off the end of the world.
   *
   * The entry carries the take losslessly plus the clip NODE's identity, so a
   * restore rebuilds the clip even when this was its last take. The active
   * index is repaired the way the reducer repairs it: removing a take before it
   * shifts it left, removing the active one (or one after) clamps into the new
   * range; the last removal clears the clip and leaves the still standing.
   */
  remove_clip_result: (production, op, ctx) => {
    const { shot, shotIndex, clip, results, index } = requireTake(
      production,
      op.shotId,
      op.result,
    )
    const entry: TrashedClip = {
      kind: "clip",
      id: ctx.mintId(),
      shotId: op.shotId,
      ...(shot.name ? { shotName: shot.name } : {}),
      index,
      deletedAt: ctx.now,
      clipBase: {
        nodeId: clip.nodeId,
        ...(clip.provider ? { provider: clip.provider } : {}),
        ...(clip.prompt ? { prompt: clip.prompt } : {}),
        // The cinematic channel travels WITH the prompt (INV-D); `structured`
        // is the canvas's own passthrough and rides unconditionally.
        ...carryDirection(clip),
        ...carryStructured(clip),
      },
      result: results[index]!,
    }
    const remaining = [...results.slice(0, index), ...results.slice(index + 1)]
    let next: Shot
    if (remaining.length === 0) {
      next = { ...shot }
      delete (next as { clip?: ShotClip }).clip
    } else {
      const prevActive = clip.activeIndex ?? 0
      const nextActive =
        prevActive > index
          ? prevActive - 1
          : Math.min(prevActive, remaining.length - 1)
      next = { ...shot, clip: buildClip(clip, remaining, nextActive) }
    }
    const withShot = withShotAt(production, shotIndex, next)
    return {
      production: {
        ...withShot,
        trash: [...appendToTrash(production.trash ?? [], entry)],
      },
      receipt: {
        op: "remove_clip_result",
        summary: `Deleted ${takeLabel(index)} of ${shotLabel(
          shot,
          shotIndex,
        )} (in the bin).`,
        ids: [entry.id],
      },
    }
  },

  /**
   * Name a take, or clear its name.
   *
   * Takes of one shot share a start frame, so their thumbnails are identical —
   * the name is how you tell them apart beyond the length badge. Blank once
   * trimmed DROPS the key, reverting to the derived "Take N"; `buildClip`'s
   * keep-predicate retains a lone NAMED take's list, so the name cannot
   * collapse away on the next reload.
   */
  rename_clip_result: (production, op, _ctx) => {
    const { shot, shotIndex, clip, results, index } = requireTake(
      production,
      op.shotId,
      op.result,
    )
    const trimmed = op.name.trim()
    const label = `${takeLabel(index)} of ${shotLabel(shot, shotIndex)}`
    if ((results[index]!.name ?? "") === trimmed) {
      return {
        production,
        receipt: {
          op: "rename_clip_result",
          summary: trimmed
            ? `Renamed ${label} to “${trimmed}”.`
            : `Cleared the name of ${label}.`,
        },
        warnings: [
          trimmed
            ? `${label} was already called “${trimmed}”.`
            : `${label} had no name.`,
        ],
      }
    }
    const nextResults = results.map((r, i) => {
      if (i !== index) return r
      const copy = { ...r }
      if (trimmed) copy.name = trimmed
      else delete (copy as { name?: string }).name
      return copy
    })
    const next: Shot = {
      ...shot,
      clip: buildClip(clip, nextResults, clip.activeIndex ?? 0),
    }
    return {
      production: withShotAt(production, shotIndex, next),
      receipt: {
        op: "rename_clip_result",
        summary: trimmed
          ? `Renamed ${label} to “${trimmed}”.`
          : `Cleared the name of ${label}.`,
      },
    }
  },
}
