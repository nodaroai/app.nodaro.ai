import type {
  DirectionFields,
  StructuredPromptFields,
  SubjectFields,
} from "@nodaro/prompts"

import type { ShotClipResult, ShotStillResult } from "./shot"
import type { SerializedProduction } from "./shot-graph"

/**
 * The production's TRASH — a recycle bin for deleted work.
 *
 * Deleting used to be terminal: the media left the timeline and the only copy of
 * that generation (and the credits behind it) was gone. Now a deletion moves the
 * thing here instead, and this list is BOTH recovery surfaces: `Ctrl+Z` restores
 * the newest entry, the Trash panel restores or permanently deletes any entry. One
 * list, so the two can never disagree about what is recoverable.
 *
 * Three things land here, because all three were unrecoverable:
 *   - a STILL result (one image out of a shot's still history),
 *   - a CLIP result (one video out of a shot's clip history), and
 *   - a whole SHOT (with its still, clip history, voice and keyframes).
 *
 * Persisted in `settings.studio.trash` (see shot-graph), so the bin survives a
 * reload the way a desktop recycle bin survives a restart. `Ctrl+Z` is
 * deliberately narrower — it only reaches deletions made in THIS session (the
 * store's session-scoped undo stack), because silently resurrecting something
 * deleted days ago on a stray keypress would be its own surprise.
 */

/**
 * One deleted CLIP result, self-contained enough to restore losslessly.
 *
 * It carries the whole {@link ShotClipResult} (its prompt, model, duration, source
 * frames and references — everything a clip-select restores) PLUS the clip-level
 * shell needed when the deletion emptied the shot's clip entirely: dropping the
 * LAST result removes `shot.clip` and its `nodeId` with it, so without
 * {@link clipBase} a restore couldn't rebuild the node the canvas graph
 * round-trips through.
 */
export interface TrashedClip {
  readonly kind: "clip"
  /** Stable id for this trash entry (`crypto.randomUUID()`). */
  readonly id: string
  /** The shot the clip was deleted from. */
  readonly shotId: string
  /** The shot's display name at deletion time — it may be renamed (or deleted)
   *  before the entry is restored, and the row still has to read sanely. */
  readonly shotName?: string
  /** Position it held in that shot's clip history; restore aims for the same slot. */
  readonly index: number
  /** ISO timestamp — the panel sorts + labels by it ("deleted 5 minutes ago"). */
  readonly deletedAt: string
  /** The clip node's identity, so an emptied clip can be rebuilt on restore. */
  readonly clipBase: {
    readonly nodeId: string
    readonly provider?: string
    readonly prompt?: string
    /** The cinematic channel travels WITH the prompt (INV-D) — without it here,
     *  restoring the LAST-deleted clip would rebuild the node with its prose but
     *  none of the catalog ids that produced it. */
    readonly direction?: DirectionFields
    readonly subject?: SubjectFields
    /** The canvas's own Path-1 structured fields — a PASSTHROUGH studio never
     *  authors and must not drop on a rebuild (see `shot.ts`). */
    readonly structured?: StructuredPromptFields
  }
  /** The deleted generation itself. */
  readonly result: ShotClipResult
}

/**
 * One deleted SHOT — the whole thing: its still history, clip history, voiceover,
 * keyframes, references, name and folder.
 *
 * Rather than inventing a second way to describe a shot, the entry stores it as a
 * standalone MINI-GRAPH: exactly what `serializeProduction` writes for a
 * production of one shot, restored by the same `parseProduction` used on load. So
 * a trashed shot round-trips with precisely the fidelity a saved production does,
 * and any field added to that machinery is covered here for free — there is no
 * parallel shot serializer to keep in sync.
 */
export interface TrashedShot {
  readonly kind: "shot"
  readonly id: string
  /** The shot's own id, so a restore can tell whether it's already back. */
  readonly shotId: string
  readonly shotName?: string
  /** Its position in the timeline; restore aims for the same slot. */
  readonly index: number
  readonly deletedAt: string
  /** The shot as a one-shot production graph (see the note above). */
  readonly graph: SerializedProduction
}

/**
 * One deleted IMAGE result — the still mirror of {@link TrashedClip}. Removing
 * the LAST result drops `shot.still` (and its `nodeId`) with it, so
 * {@link stillBase} records the node identity a restore needs to rebuild it.
 */
export interface TrashedStill {
  readonly kind: "still"
  readonly id: string
  readonly shotId: string
  readonly shotName?: string
  /** Position in that shot's image history; restore aims for the same slot. */
  readonly index: number
  readonly deletedAt: string
  /** The still node's identity, so an emptied still can be rebuilt. */
  readonly stillBase: {
    readonly nodeId: string
    readonly provider?: string
    readonly prompt?: string
    /** See {@link TrashedClip.clipBase}'s note — same INV-D reasoning. */
    readonly direction?: DirectionFields
    readonly subject?: SubjectFields
    /** The canvas's own Path-1 structured fields — a PASSTHROUGH studio never
     *  authors and must not drop on a rebuild (see `shot.ts`). */
    readonly structured?: StructuredPromptFields
  }
  readonly result: ShotStillResult
}

export type TrashedItem = TrashedClip | TrashedStill | TrashedShot

/**
 * How many entries the bin keeps. The trash rides `settings.studio` in the
 * workflow, and every debounced save REPLACES the whole graph — so an unbounded
 * bin grows the payload of every save for the rest of the production's life.
 * Culling images is the most frequent deletion there is, which is exactly what
 * made a cap necessary; 50 covers far more than the "undo that mistake" window
 * the bin exists for.
 */
export const TRASH_LIMIT = 50

/** Append one deletion, dropping the OLDEST entries past {@link TRASH_LIMIT}.
 *  Undo tolerates a pruned id (it walks past ids no longer in the bin). */
export function appendToTrash(
  trash: ReadonlyArray<TrashedItem>,
  entry: TrashedItem,
): ReadonlyArray<TrashedItem> {
  const next = [...trash, entry]
  return next.length > TRASH_LIMIT ? next.slice(next.length - TRASH_LIMIT) : next
}

/** Newest first — the order the Trash panel lists entries in (the store keeps
 *  them in append order, so this never mutates the source). */
export function trashNewestFirst(
  trash: ReadonlyArray<TrashedItem>,
): ReadonlyArray<TrashedItem> {
  return [...trash].reverse()
}

/** What the entry is, for labels and copy ("Clip" / "Shot"). */
export function trashItemNoun(item: TrashedItem): string {
  if (item.kind === "shot") return "Scene"
  return item.kind === "still" ? "Image" : "Clip"
}
