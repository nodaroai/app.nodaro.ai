/**
 * The `stills` section, exercised — the operation twins of the studio store's
 * still-result reducers (`addShotStillResult`, `setActiveStillResult`,
 * `removeShotStillResult`, `setStillResultName`).
 *
 * Every assertion below is PORTED from the studio suite that specifies those
 * reducers — `production-store.test.ts` (`addShotStillResult` L338, `start
 * frame stickiness (#7)` L513, `setActiveStillResult` L554,
 * `removeShotStillResult` L621, `setStillResultName` L247),
 * `production-store.trash-still.test.ts`, `production-store.direction.test.ts`
 * (`addShotStillResult — INV-D on the still` L67) and
 * `production-store.import.test.ts` (the widened result carry L79, the recipe
 * consumption). Only the CALL SHAPE changes: `store.reducer(shotId, index)`
 * becomes `stillsHandlers.<op>(production, op, ctx)` and an INDEX becomes the
 * result's {@link resultKey}. The expectations themselves are untouched.
 *
 * Three places where the port could not be literal, each deliberate and
 * documented at its site:
 *  - an UNKNOWN shot / result key is an `OpError` (`op_target_missing`) where
 *    the reducer silently no-opped — the operation contract's rule 5;
 *  - a genuine no-op (an already-active pick, an unchanged name) still returns
 *    the SAME production reference, and now says so in a warning;
 *  - assertions about store-only state (`undoableTrashIds`, `restoreTrashedItem`)
 *    have no counterpart here: neither is part of the document. The undo stack
 *    is the editor's session state and restore belongs to the `trash` section.
 *
 * This module is the suite's shared HARNESS — the call-shape helpers and the
 * fixtures the port needs. The tests themselves live in three siblings, split
 * only because one file would exceed the 800-line cap:
 * `apply.stills.results.test.ts` (the section's shape, `add_still_result`,
 * start-frame stickiness, INV-D and the schemas), `apply.stills.active.test.ts`
 * (`set_active_still`, `rename_still_result`, the receipts and the refusals)
 * and `apply.stills.trash.test.ts` (`remove_still_result` and the bin).
 */
import { resultKey } from "../../../result-key"
import type { Shot, ShotStillResult } from "../../../shot"
import { stillResults } from "../../../shot"
import type { Production } from "../../production"
import { stillsHandlers } from "../../sections/stills"
import type { OpContext, OpResult } from "../../types"

// ── the harness ─────────────────────────────────────────────────────────────

/** A deterministic context — no clock, no randomness (the contract's rule 4). */
export const makeCtx = (): OpContext => {
  let n = 0
  return { now: "2026-09-06T12:00:00.000Z", mintId: () => `mint-${++n}` }
}

export let ctx = makeCtx()

export const addStill = (
  production: Production,
  shotId: string,
  result: ShotStillResult,
  atFront?: boolean,
): OpResult =>
  stillsHandlers.add_still_result(
    production,
    {
      op: "add_still_result",
      shotId,
      result,
      ...(atFront === undefined ? {} : { atFront }),
    },
    ctx,
  )

export const setActive = (
  production: Production,
  shotId: string,
  key: string,
): OpResult =>
  stillsHandlers.set_active_still(
    production,
    { op: "set_active_still", shotId, result: key },
    ctx,
  )

export const removeStill = (
  production: Production,
  shotId: string,
  key: string,
): OpResult =>
  stillsHandlers.remove_still_result(
    production,
    { op: "remove_still_result", shotId, result: key },
    ctx,
  )

export const renameStill = (
  production: Production,
  shotId: string,
  key: string,
  name: string,
): OpResult =>
  stillsHandlers.rename_still_result(
    production,
    { op: "rename_still_result", shotId, result: key, name },
    ctx,
  )

/** The urls of a shot's still history, in order. */
export const urlsOf = (production: Production, index = 0) =>
  production.shots[index]!.still?.results?.map((r) => r.url)

/** The `ResultKey` of the still result at `index` (the port of an INDEX arg). */
export const keyAt = (production: Production, shotIndex: number, index: number) =>
  resultKey(stillResults(production.shots[shotIndex]!.still!)[index]!)

/** A still-only shot fixture (stable ids for assertions). */
export const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

/** A still+clip shot fixture. */
export const stillAndClip = (id: string): Shot => ({
  ...stillOnly(id),
  clip: {
    nodeId: `generate-video-${id}`,
    url: `https://r2.example/${id}.mp4`,
    provider: "grok-i2v",
    prompt: `clip ${id}`,
    duration: 5,
  },
})

/** An empty shot — the op twin of `addShot()` (which is the `shots` section). */
export const empty = (id: string): Production => ({ shots: [{ id }] })

/** Copy a shot with a field set / cleared — the `frames` section's ops, by hand. */
export const withStartFrame = (production: Production, url?: string): Production => ({
  ...production,
  shots: production.shots.map((shot) => {
    const next = { ...shot }
    if (url) next.startFrame = url
    else delete (next as { startFrame?: string }).startFrame
    return next
  }),
})

/** Reset the minted-id counter (the original suite's trailing reset). */
export const resetCtx = (): void => {
  ctx = makeCtx()
}
