/**
 * The TRASH section — the bin's three operations.
 *
 * Deleting is never terminal in a production: `remove_shot`,
 * `remove_still_result` and `remove_clip_result` (the `shots` / `stills` /
 * `clips` sections) move the thing into `settings.studio.trash` instead. These
 * three are the other end of that contract — the only way back out, and the
 * ONLY two operations in the whole vocabulary that destroy a media reference
 * (which is why both carry the `D` class and never run without confirmation).
 *
 * They generalise the studio store's `restoreTrashedItem` / `purgeTrashedClip`
 * / `clearTrash` reducers one-for-one. Two differences, both forced by the move
 * off the client:
 *
 *  - The reducers answer `true`/`false` and quietly change nothing when a
 *    restore cannot land. An operation has a caller on the other side of a wire
 *    who asked for something specific, so a refusal is an {@link OpError}: an
 *    id that names no entry is `op_target_missing`, and an entry the DOCUMENT
 *    refuses (its shot deleted for good, its stored graph unparseable, its shot
 *    already back) is `op_invalid`. Either way the document is untouched, which
 *    is exactly the state the reducers left behind — the entry stays in the bin
 *    so its media is still reachable, and still purgeable.
 *  - The session UNDO STACK (`undoableTrashIds`, `undoLastDelete`) does not
 *    exist here. It is UI state scoped to one browser session; a restore over
 *    the wire names its entry by id.
 */
import { z } from "zod"

import type { Shot } from "../../shot"
import { buildClip, buildStill, clipResults, stillResults } from "../../shot"
import { parseProduction } from "../../shot-graph"
import type { TrashedItem } from "../../trash"
import type { WorkflowLike } from "../../workflow-like"
import { opError } from "../errors"
import type { Production } from "../production"
import type { OpResult, SectionClasses, SectionHandlers } from "../types"

// ── schemas (arg names verbatim from the operation table, spec §6) ──────────

export const trashOpSchemas = {
  restore_trashed: z.object({
    op: z.literal("restore_trashed"),
    /** The bin entry to put back — `TrashedItem.id`, never a position. */
    trashId: z.string(),
  }),
  purge_trashed: z.object({
    op: z.literal("purge_trashed"),
    /** The bin entry to destroy. */
    trashId: z.string(),
  }),
  clear_trash: z.object({
    op: z.literal("clear_trash"),
  }),
} as const

export const trashOpClasses: SectionClasses<typeof trashOpSchemas> = {
  restore_trashed: "S",
  // Both destroy a media reference — the only operations that do.
  purge_trashed: "D",
  clear_trash: "D",
}

// ── the reading a receipt needs ─────────────────────────────────────────────

/** The bin, always a list (a production that never deleted anything has none). */
function bin(production: Production): ReadonlyArray<TrashedItem> {
  return production.trash ?? []
}

/** The entry `trashId` names, or a refusal. */
function entryById(production: Production, trashId: string): TrashedItem {
  const entry = bin(production).find((t) => t.id === trashId)
  if (!entry) {
    throw opError("op_target_missing", `No bin entry ${trashId} in this production.`)
  }
  return entry
}

/**
 * How the entry's SHOT reads to a person — its name at deletion time when it
 * had one (the shot may since have been renamed, or deleted), else its 1-based
 * position: the shot's own place in the timeline for a result entry, the slot
 * the shot was deleted from for a shot entry.
 */
function shotLabel(production: Production, entry: TrashedItem): string {
  if (entry.shotName?.trim()) return `“${entry.shotName.trim()}”`
  const at =
    entry.kind === "shot"
      ? entry.index
      : production.shots.findIndex((s) => s.id === entry.shotId)
  return `Scene ${Math.max(0, at) + 1}`
}

/** How the entry itself reads — `clip take 2`, `image take 1`, `the scene`. */
function entryLabel(production: Production, entry: TrashedItem): string {
  const shot = shotLabel(production, entry)
  if (entry.kind === "shot") return `the scene ${shot}`
  const noun = entry.kind === "still" ? "image" : "clip"
  return `${noun} take ${entry.index + 1} of ${shot}`
}

/** The bin without `trashId` — a fresh list, the input never touched. */
function withoutEntry(
  production: Production,
  trashId: string,
): TrashedItem[] {
  return bin(production).filter((t) => t.id !== trashId)
}

/** `entry.index`, clamped into a list that may have changed length since. */
function slotFor(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}

// ── restore ─────────────────────────────────────────────────────────────────

/**
 * A whole SHOT, back on the timeline.
 *
 * The entry stores the shot as a one-shot production GRAPH, so it comes back
 * through the very `parseProduction` a load uses — the still history, the clip
 * history, the voice and the keyframes all with the fidelity a saved production
 * round-trips at, and no parallel deserializer to keep in sync.
 */
function restoreShot(
  production: Production,
  entry: Extract<TrashedItem, { kind: "shot" }>,
): Production {
  // Already back (a replayed batch, or an entry the bin kept after a manual
  // re-add) — inserting a duplicate is not what "restore" promises.
  if (production.shots.some((s) => s.id === entry.shotId)) {
    throw opError(
      "op_invalid",
      `Shot ${entry.shotId} is already on the timeline; nothing to restore.`,
    )
  }
  const parsed = parseProduction({
    id: entry.shotId,
    nodes: entry.graph.nodes,
    edges: entry.graph.edges,
    settings: entry.graph.settings,
  } as unknown as WorkflowLike).shots[0]
  // An unparseable blob can't be restored; the entry stays in the bin to be
  // purged rather than dropping a broken shot onto the timeline.
  if (!parsed) {
    throw opError(
      "op_invalid",
      `The bin entry ${entry.id} does not hold a restorable shot.`,
    )
  }
  const at = slotFor(entry.index, production.shots.length)
  return {
    ...production,
    shots: [
      ...production.shots.slice(0, at),
      parsed,
      ...production.shots.slice(at),
    ],
    // Land ON the restored shot — the user asked for it back.
    selectedShotId: parsed.id,
    trash: withoutEntry(production, entry.id),
  }
}

/**
 * One RESULT, back in its shot's history.
 *
 * The shot has to still exist — a result belongs to one, and inventing a shot
 * on the user's timeline is not what "restore" promises. The still and clip
 * halves differ only in which history they rebuild, so they share this shape:
 * aim for the original slot (a shorter history just appends), reuse the LIVE
 * shell when the shot still has one and fall back to the recorded base when the
 * deletion emptied it, and land ON the restored take.
 */
function restoreResult(
  production: Production,
  entry: Extract<TrashedItem, { kind: "still" | "clip" }>,
): Production {
  if (!production.shots.some((s) => s.id === entry.shotId)) {
    throw opError(
      "op_invalid",
      `Shot ${entry.shotId} is gone, so ${entry.kind === "still" ? "the image" : "the clip"} cannot be restored.`,
    )
  }
  const shots: Shot[] = production.shots.map((shot) => {
    if (shot.id !== entry.shotId) return shot
    if (entry.kind === "still") {
      const results = shot.still ? stillResults(shot.still) : []
      const at = slotFor(entry.index, results.length)
      const next = [...results.slice(0, at), entry.result, ...results.slice(at)]
      return { ...shot, still: buildStill(shot.still ?? entry.stillBase, next, at) }
    }
    const results = shot.clip ? clipResults(shot.clip) : []
    const at = slotFor(entry.index, results.length)
    const next = [...results.slice(0, at), entry.result, ...results.slice(at)]
    return { ...shot, clip: buildClip(shot.clip ?? entry.clipBase, next, at) }
  })
  return { ...production, shots, trash: withoutEntry(production, entry.id) }
}

// ── handlers ────────────────────────────────────────────────────────────────

export const trashHandlers: SectionHandlers<typeof trashOpSchemas> = {
  restore_trashed: (production, op): OpResult => {
    const entry = entryById(production, op.trashId)
    const summary = `Restored ${entryLabel(production, entry)}.`
    const next =
      entry.kind === "shot"
        ? restoreShot(production, entry)
        : restoreResult(production, entry)
    return { production: next, receipt: { op: "restore_trashed", summary } }
  },

  purge_trashed: (production, op): OpResult => {
    const entry = entryById(production, op.trashId)
    return {
      production: { ...production, trash: withoutEntry(production, op.trashId) },
      receipt: {
        op: "purge_trashed",
        summary: `Permanently deleted ${entryLabel(production, entry)}.`,
      },
    }
  },

  clear_trash: (production): OpResult => {
    const count = bin(production).length
    return {
      production: { ...production, trash: [] },
      receipt: {
        op: "clear_trash",
        summary: `Emptied the bin (${count} item${count === 1 ? "" : "s"} destroyed).`,
      },
      // Not a failure — just worth saying, so a caller can tell an empty
      // gesture from a destructive one.
      ...(count === 0 ? { warnings: ["The bin was already empty."] } : {}),
    }
  },
}
