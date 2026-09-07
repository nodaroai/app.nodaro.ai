/**
 * The `frames` section — the sticky frames, the reference channels, the markers.
 *
 * Five operations, the server-side twins of `setShotStartFrame` /
 * `setShotEndFrame` / `setShotDirectingReferences` / `addShotPendingClip` /
 * `removeShotPendingClip` in the studio store (`production-store-clips.ts`).
 * What they have in common is that they write the DIRECTING INPUTS of a shot —
 * the two frames an animate is anchored between, the reference urls it is
 * steered by, and the resume markers an in-flight render leaves behind — none
 * of which is a generation and none of which touches a result history.
 *
 * The invariant this section exists to hold is that frames are **explicit and
 * sticky**: selecting a still or a clip never moves them, a new generation
 * never overwrites one a person set, and only these ops assign or clear them
 * (`CLAUDE.md`, "Editor UX invariants"). Nothing here reads the histories, so
 * nothing here can move a frame as a side effect.
 *
 * Two places these ops part company with the reducers, both from the contract
 * in `../SECTIONS.md` rather than from a change of behaviour:
 *
 *  - **A frame is cleared with `null`, not `undefined`.** The vocabulary
 *    crosses a JSON wire, where `undefined` is not a value. What clearing MEANS
 *    is unchanged: the key is dropped off a fresh copy, never blanked, so the
 *    persisted document keeps the minimal shape the codec round-trips.
 *  - **A target that names nothing throws.** The store hands back the state it
 *    was given when the shot id (or a marker's `jobId`) matches nothing, which
 *    is right for a click that raced a delete; a batch is atomic, so the same
 *    silence would apply the ops around a mis-addressed one and report success.
 *    The store's three "no-op for an unknown …" cases are refusals here.
 *
 * A no-op that names real things is not a failure: clearing a frame that was
 * already clear, or a reference channel that was already empty, returns the
 * document untouched with a warning — that is what the warnings channel is for.
 *
 * Copy-on-write throughout, and nothing ambient: a marker carries its own
 * `startedAt` (the client stamps it at submit, and it is resume context rather
 * than a fact about this batch), so no handler here reads `ctx.now`.
 */
import { z } from "zod"

import type { VideoReferenceKind } from "../../model-menu"
import type { Shot, ShotPendingClip } from "../../shot"
import { directingRefField, VIDEO_REFERENCE_KINDS } from "../../shot"
import { opError } from "../errors"
import type { Production } from "../production"
import type { SectionClasses, SectionHandlers } from "../types"

// ── the schemas (SECTIONS.md §8) ────────────────────────────────────────────

/**
 * An in-flight animate MARKER, typed as the codec's own {@link ShotPendingClip}.
 *
 * The same pattern the `shots` section uses for a plan stage, and for the same
 * reason: the marker is CAPTURE state — a dozen fields the submit path stamped
 * so a render survives a reload (the beats, the chips, the look layers, the
 * recast plan) — and no operation in this vocabulary reads any of them. A zod
 * restatement of those nested shapes would be a second spelling of five domain
 * types that drifts the first time a lever is added to one of them, so the
 * codec's interface stays the single contract and the check here is the one
 * thing the RESUME contract actually requires: a marker names the job it will
 * be resumed on, the model that is rendering, the prompt it went out with, and
 * when it started. A marker with no `jobId` names nothing to resume, which is
 * the entire point of persisting one.
 */
const pendingClipSchema = z.custom<ShotPendingClip>((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const marker = value as Record<string, unknown>
  return (
    typeof marker.jobId === "string" &&
    marker.jobId.length > 0 &&
    typeof marker.provider === "string" &&
    typeof marker.prompt === "string" &&
    typeof marker.startedAt === "number"
  )
})

export const framesOpSchemas = {
  set_start_frame: z.object({
    op: z.literal("set_start_frame"),
    shotId: z.string().min(1),
    /** `null` clears it (the store's `undefined`) — the key is dropped. */
    url: z.string().nullable(),
  }),
  set_end_frame: z.object({
    op: z.literal("set_end_frame"),
    shotId: z.string().min(1),
    /** `null` clears it (the store's `undefined`) — the key is dropped. */
    url: z.string().nullable(),
  }),
  set_directing_references: z.object({
    op: z.literal("set_directing_references"),
    shotId: z.string().min(1),
    /** The catalog's media kinds, not a retyped list — a kind added there
     *  reaches the wire without an edit here. */
    kind: z.enum(VIDEO_REFERENCE_KINDS),
    /** The whole channel, replaced. An empty list clears that kind alone. */
    urls: z.array(z.string()),
  }),
  add_pending_clip: z.object({
    op: z.literal("add_pending_clip"),
    shotId: z.string().min(1),
    pending: pendingClipSchema,
  }),
  remove_pending_clip: z.object({
    op: z.literal("remove_pending_clip"),
    shotId: z.string().min(1),
    jobId: z.string().min(1),
  }),
} as const

// ── local helpers (pure; no codec module is edited from a section) ──────────

/** The shot this op addresses, with its position — or `op_target_missing`. */
function locateShot(
  production: Production,
  shotId: string,
): { readonly shot: Shot; readonly index: number } {
  const index = production.shots.findIndex((s) => s.id === shotId)
  if (index < 0) {
    throw opError("op_target_missing", `No shot ${shotId} in this production.`)
  }
  return { shot: production.shots[index]!, index }
}

/**
 * How a shot is NAMED to a person — its own name when it has one, else
 * `Shot <n>` by its 1-based timeline position. Receipts carry no ids
 * (`SECTIONS.md`, "How a receipt reads"); this copy lives here until the
 * integrator hoists one.
 */
function shotLabel(production: Production, index: number): string {
  const name = production.shots[index]?.name?.trim()
  return name && name.length > 0 ? name : `Shot ${index + 1}`
}

/** Copy `production` with the shot at `index` replaced. Copy-on-write. */
function withShot(production: Production, index: number, shot: Shot): Production {
  return {
    ...production,
    shots: production.shots.map((s, i) => (i === index ? shot : s)),
  }
}

/**
 * Copy `shot` with ONE sticky frame SET (a url) or CLEARED (`null`) — the key
 * dropped off a fresh copy rather than blanked, so the persisted document keeps
 * the minimal shape. A clear on a shot that has no such frame returns the shot
 * unchanged (identity), exactly as the reducer does.
 */
function withFrame(
  shot: Shot,
  field: "startFrame" | "endFrame",
  url: string | null,
): Shot {
  if (url) return { ...shot, [field]: url }
  if (!shot[field]) return shot
  const next = { ...shot }
  delete (next as Record<string, unknown>)[field]
  return next
}

/**
 * Copy `shot` with ONE directing-reference channel SET (non-empty urls, copied
 * so the caller's array is never aliased) or DROPPED (empty). A local mirror of
 * the store's `withDirectingRefs` helper, which lives in the studio app and has
 * no codec equivalent; the per-kind FIELD comes from the codec's own
 * {@link directingRefField}, so the field names cannot drift from the kinds.
 */
function withDirectingRefs(
  shot: Shot,
  field: ReturnType<typeof directingRefField>,
  urls: ReadonlyArray<string>,
): Shot {
  if (urls.length > 0) return { ...shot, [field]: [...urls] }
  if (!shot[field]) return shot
  const next = { ...shot }
  delete (next as Record<string, unknown>)[field]
  return next
}

/**
 * The word a person uses for one reference of a given media kind. A total map
 * over the catalog's kinds rather than a suffix trick, so a kind added there
 * fails to compile here instead of shipping a receipt that reads "audios".
 */
const REFERENCE_NOUN: Record<VideoReferenceKind, string> = {
  images: "image",
  videos: "video",
  audio: "audio",
}

/** The markers on a shot, as a list (a shot with no in-flight render has none). */
function markers(shot: Shot): ReadonlyArray<ShotPendingClip> {
  return shot.pendingClips ?? []
}

// ── the handlers ────────────────────────────────────────────────────────────

/** `set_start_frame` / `set_end_frame` — one body, the field is the difference. */
function setFrame(
  field: "startFrame" | "endFrame",
  op: "set_start_frame" | "set_end_frame",
  noun: "start frame" | "end frame",
) {
  return (
    production: Production,
    args: { readonly shotId: string; readonly url: string | null },
  ) => {
    const { shot, index } = locateShot(production, args.shotId)
    const label = shotLabel(production, index)
    const next = withFrame(shot, field, args.url)
    const summary = args.url
      ? `Set the ${noun} of ${label}.`
      : `Cleared the ${noun} of ${label}.`
    // A clear that found nothing to clear is a no-op worth saying, not a failure.
    const warnings =
      !args.url && next === shot ? [`${label} had no ${noun}.`] : undefined
    return {
      production: withShot(production, index, next),
      receipt: { op, summary },
      ...(warnings ? { warnings } : {}),
    }
  }
}

/** The two frame handlers, built once — the field and the noun are all that
 *  separates them. */
const setStartFrame = setFrame("startFrame", "set_start_frame", "start frame")
const setEndFrame = setFrame("endFrame", "set_end_frame", "end frame")

export const framesHandlers: SectionHandlers<typeof framesOpSchemas> = {
  set_start_frame: setStartFrame,

  set_end_frame: setEndFrame,

  set_directing_references: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    const label = shotLabel(production, index)
    const noun = REFERENCE_NOUN[op.kind]
    const next = withDirectingRefs(shot, directingRefField(op.kind), op.urls)
    const summary = op.urls.length
      ? `Set ${op.urls.length} ${noun} reference${
          op.urls.length === 1 ? "" : "s"
        } on ${label}.`
      : `Cleared the ${noun} references on ${label}.`
    const warnings =
      !op.urls.length && next === shot
        ? [`${label} had no ${noun} references.`]
        : undefined
    return {
      production: withShot(production, index, next),
      receipt: { op: "set_directing_references", summary },
      ...(warnings ? { warnings } : {}),
    }
  },

  add_pending_clip: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    const label = shotLabel(production, index)
    // ACCUMULATE: animates run concurrently (the non-blocking editor), so a
    // marker is appended beside its siblings and never replaces one.
    const next: Shot = { ...shot, pendingClips: [...markers(shot), op.pending] }
    return {
      production: withShot(production, index, next),
      receipt: {
        op: "add_pending_clip",
        summary: `Added an animate marker to ${label}.`,
      },
    }
  },

  remove_pending_clip: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    const label = shotLabel(production, index)
    const remaining = markers(shot).filter((p) => p.jobId !== op.jobId)
    if (remaining.length === markers(shot).length) {
      throw opError(
        "op_target_missing",
        `No animate marker ${op.jobId} on ${label}.`,
      )
    }
    // Only the completing render's own marker goes; the last one's removal
    // drops the key (the minimal persisted shape).
    const next: Shot = { ...shot }
    if (remaining.length > 0) {
      ;(next as { pendingClips?: ReadonlyArray<ShotPendingClip> }).pendingClips =
        remaining
    } else {
      delete (next as { pendingClips?: ReadonlyArray<ShotPendingClip> }).pendingClips
    }
    return {
      production: withShot(production, index, next),
      receipt: {
        op: "remove_pending_clip",
        summary: `Removed an animate marker from ${label}.`,
      },
    }
  },
}

// ── the classes ─────────────────────────────────────────────────────────────
//
// All five are safe. A frame and a reference channel are INPUTS to the next
// generation — assigning or clearing one spends nothing and destroys no media
// (the results they point at are the histories', untouched here), and a marker
// is bookkeeping for a render that is already running.

export const framesOpClasses: SectionClasses<typeof framesOpSchemas> = {
  set_start_frame: "S",
  set_end_frame: "S",
  set_directing_references: "S",
  add_pending_clip: "S",
  remove_pending_clip: "S",
}
