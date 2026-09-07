/**
 * The `clips` section — the studio store's clip suite, ported.
 *
 * Every assertion here comes from the studio checkout's own tests for the four
 * reducers these operations generalise (`production-store.test.ts`'s
 * `addShotClipResult` / `setActiveClipResult` / `removeShotClipResult` /
 * `setClipResultName`, `production-store.direction.test.ts`'s INV-D describe,
 * and `trash.test.ts`'s "deleting a clip fills the bin"). Only the CALL shape
 * changed — `store.reducer(shotId, index)` became
 * `clipsHandlers.<op>(production, op, ctx)`, and a result is addressed by its
 * `ResultKey` instead of its position.
 *
 * Three deliberate conversions, each mandated by `SECTIONS.md` rather than
 * chosen here, are marked CONVERTED at their site:
 *  - a reducer NO-OPS on a missing shot / clip / out-of-range index; the
 *    operation REFUSES it with `op_target_missing` (rule 5), so the "same
 *    reference" assertion becomes a throw plus "the input document is
 *    untouched";
 *  - a reducer takes an INDEX, the op a `ResultKey` (rule 2);
 *  - the two genuine no-ops (an already-active take, an unchanged name) keep
 *    their identity assertion and gain a warning.
 *
 * Seeding uses literal `Shot` objects where the studio test called a reducer
 * this lane does not own (`addShotStillResult`, `setShotStartFrame`) — the
 * seeded document is the same one those reducers would have produced.
 *
 * This module is the suite's shared HARNESS — the call-shape helpers and the
 * fixtures the port needs. The tests themselves live in three siblings, split
 * only because one file would exceed the 800-line cap:
 * `apply.clips.results.test.ts` (`add_clip_result` and INV-D),
 * `apply.clips.active.test.ts` (`set_active_clip`, `rename_clip_result` and
 * the section's tables) and `apply.clips.trash.test.ts`
 * (`remove_clip_result` and the bin).
 */
import { expect } from "vitest"

import type { Shot } from "../../../shot"
import { isOpError, OpError } from "../../errors"
import type { Production } from "../../production"
import { clipsHandlers } from "../../sections/clips"
import type { OpContext } from "../../types"

export const NOW = "2026-09-06T12:00:00.000Z"
export const ctx: OpContext = { now: NOW, mintId: () => "trash-1" }

// ── call-shape helpers (the only thing the port changes) ────────────────────

export type AddOp = Parameters<typeof clipsHandlers.add_clip_result>[1]
export type ClipResultArg = AddOp["result"]

export const prod = (shots: Shot[]): Production => ({ shots })

export const add = (
  production: Production,
  shotId: string,
  result: ClipResultArg,
  atFront?: boolean,
): Production =>
  clipsHandlers.add_clip_result(
    production,
    { op: "add_clip_result", shotId, result, atFront },
    ctx,
  ).production

export const setActive = (
  production: Production,
  shotId: string,
  result: string,
): Production =>
  clipsHandlers.set_active_clip(
    production,
    { op: "set_active_clip", shotId, result },
    ctx,
  ).production

export const removeResult = (
  production: Production,
  shotId: string,
  result: string,
): Production =>
  clipsHandlers.remove_clip_result(
    production,
    { op: "remove_clip_result", shotId, result },
    ctx,
  ).production

export const rename = (
  production: Production,
  shotId: string,
  result: string,
  name: string,
): Production =>
  clipsHandlers.rename_clip_result(
    production,
    { op: "rename_clip_result", shotId, result, name },
    ctx,
  ).production

/** Assert an operation was refused with `code`, and changed nothing. */
export function expectRefused(run: () => unknown, code: string): void {
  expect(run).toThrow(OpError)
  try {
    run()
  } catch (error) {
    expect(isOpError(error)).toBe(true)
    if (!isOpError(error)) throw error
    expect(error.code).toBe(code)
  }
}

// ── fixtures (verbatim from the studio suite) ───────────────────────────────

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

/** A shot with a still + an explicit start/end frame (the animate source). */
export const framedShot = (id: string): Shot => ({
  ...stillOnly(id),
  startFrame: `https://r2/${id}-start.png`,
  endFrame: `https://r2/${id}-end.png`,
})

/** A bare shot (the direction suite's `shotWith`). */
export const shotWith = (id: string): Shot => ({ id })

/** Set a shot's start frame the way `setShotStartFrame` (the frames lane) would. */
export const withStartFrame = (production: Production, url: string): Production => ({
  ...production,
  shots: production.shots.map((shot) => ({ ...shot, startFrame: url })),
})
