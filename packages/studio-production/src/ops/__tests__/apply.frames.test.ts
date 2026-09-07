/**
 * The `frames` section, exercised.
 *
 * A PORT of the studio store's own suite for the five reducers this section
 * generalises — `production-store.test.ts` → `describe("setShotEndFrame")`,
 * `describe("setShotDirectingReferences")` and `describe("pending clip markers
 * (add/removeShotPendingClip)")`. The `stillOnly` fixture, the marker fixture
 * and every assertion come across verbatim; only the call shape changes, from
 * `get().setShotEndFrame(id, url)` to
 * `framesHandlers.set_end_frame(production, op, ctx)`.
 *
 * Two deliberate divergences, both from the section contract rather than from
 * a change of behaviour (`SECTIONS.md` rules 2 and 5):
 *
 *  - the store CLEARS a frame with `undefined`; the op takes `url: null`,
 *    because the vocabulary crosses a JSON wire where `undefined` is not a
 *    value. The assertion that matters — that clearing DELETES the key rather
 *    than blanking it — is unchanged;
 *  - the store returns the state it was handed when the shot id (or the
 *    `jobId`) names nothing; an operation refuses with `op_target_missing`,
 *    since `applyOps` is atomic and a caller that addressed nothing has made a
 *    mistake worth reporting. The three studio "no-op for an unknown …" tests
 *    are therefore rewritten as refusals — same inputs, the refusal in place of
 *    the identity assertion.
 *
 * Some of the studio's frame tests are NOT here because they need a sibling
 * lane's handler: `setShotEndFrame` › "survives an animate" (`add_clip_result`,
 * the `clips` lane) and the whole "start frame stickiness (#7)" describe, every
 * case of which anchors or re-anchors across a generation (`add_still_result`,
 * the `stills` lane). Both belong to the integrator's cross-section suite.
 */
import { describe, expect, it } from "vitest"

import type { Shot, ShotPendingClip } from "../../shot"
import { isOpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { framesHandlers, framesOpClasses, framesOpSchemas } from "../sections/frames"

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

/** The studio suite's still-only shot fixture, verbatim (stable ids). */
const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

/** A production of the given shots — the store's `setShots([...])`. */
const production = (...shots: Shot[]): Production => ({ shots })

/** The `OpError` a call threw, or a failure if it threw something else. */
function refusal(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (!isOpError(error)) throw error
    return error
  }
  throw new Error("expected the handler to refuse this op")
}

describe("set_start_frame", () => {
  // The store has no `describe("setShotStartFrame")` of its own — the reducer
  // is the exact mirror of `setShotEndFrame`, and the studio only exercises it
  // through the stickiness suite (which needs the stills lane). These three
  // are written from the reducer, shaped like the end-frame port below.
  it("sets the start-frame target on a shot", () => {
    const before = production(stillOnly("a"))
    const result = framesHandlers.set_start_frame(
      before,
      { op: "set_start_frame", shotId: "a", url: "https://r2.example/start.png" },
      ctx,
    )

    expect(result.production.shots[0].startFrame).toBe("https://r2.example/start.png")
    expect(result.production).not.toBe(before)
    expect(before.shots[0].startFrame).toBeUndefined()
    expect(result.receipt).toEqual({
      op: "set_start_frame",
      summary: "Set the start frame of Shot 1.",
    })
  })

  it("clears the start-frame target (null drops the key)", () => {
    const before = production({
      ...stillOnly("a"),
      startFrame: "https://r2.example/start.png",
    })
    const result = framesHandlers.set_start_frame(
      before,
      { op: "set_start_frame", shotId: "a", url: null },
      ctx,
    )

    expect(result.production.shots[0].startFrame).toBeUndefined()
    expect("startFrame" in result.production.shots[0]).toBe(false)
    expect(result.receipt.summary).toBe("Cleared the start frame of Shot 1.")
  })

  it("refuses an unknown shot id", () => {
    const before = production(stillOnly("a"))
    const error = refusal(() =>
      framesHandlers.set_start_frame(
        before,
        { op: "set_start_frame", shotId: "nope", url: "https://r2.example/s.png" },
        ctx,
      ),
    )

    expect(error.code).toBe("op_target_missing")
  })
})

describe("set_end_frame", () => {
  it("sets the end-frame target on a shot", () => {
    const before = production(stillOnly("a"))
    const result = framesHandlers.set_end_frame(
      before,
      { op: "set_end_frame", shotId: "a", url: "https://r2.example/end.png" },
      ctx,
    )

    expect(result.production.shots[0].endFrame).toBe("https://r2.example/end.png")
    expect(result.production).not.toBe(before)
    expect(before.shots[0].endFrame).toBeUndefined()
    expect(result.receipt).toEqual({
      op: "set_end_frame",
      summary: "Set the end frame of Shot 1.",
    })
  })

  it("clears the end-frame target (null drops the key)", () => {
    const before = production({
      ...stillOnly("a"),
      endFrame: "https://r2.example/end.png",
    })
    const result = framesHandlers.set_end_frame(
      before,
      { op: "set_end_frame", shotId: "a", url: null },
      ctx,
    )

    expect(result.production.shots[0].endFrame).toBeUndefined()
    expect("endFrame" in result.production.shots[0]).toBe(false)
    expect(result.receipt.summary).toBe("Cleared the end frame of Shot 1.")
  })

  it("refuses an unknown shot id", () => {
    const before = production(stillOnly("a"))
    const error = refusal(() =>
      framesHandlers.set_end_frame(
        before,
        { op: "set_end_frame", shotId: "nope", url: "https://r2.example/end.png" },
        ctx,
      ),
    )

    expect(error.code).toBe("op_target_missing")
  })

  it("names a shot by its own name when it has one", () => {
    const before = production({ ...stillOnly("a"), name: "Rooftop" })
    const result = framesHandlers.set_end_frame(
      before,
      { op: "set_end_frame", shotId: "a", url: "https://r2.example/end.png" },
      ctx,
    )

    expect(result.receipt.summary).toBe("Set the end frame of Rooftop.")
  })
})

describe("set_directing_references", () => {
  it("sets and clears the directing reference urls per media kind", () => {
    let current = production(stillOnly("a"))
    current = framesHandlers.set_directing_references(
      current,
      {
        op: "set_directing_references",
        shotId: "a",
        kind: "images",
        urls: ["https://r2/r1.png", "https://r2/r2.png"],
      },
      ctx,
    ).production
    current = framesHandlers.set_directing_references(
      current,
      {
        op: "set_directing_references",
        shotId: "a",
        kind: "videos",
        urls: ["https://r2/v1.mp4"],
      },
      ctx,
    ).production
    current = framesHandlers.set_directing_references(
      current,
      {
        op: "set_directing_references",
        shotId: "a",
        kind: "audio",
        urls: ["https://r2/a1.mp3"],
      },
      ctx,
    ).production

    expect(current.shots[0].directingReferenceUrls).toEqual([
      "https://r2/r1.png",
      "https://r2/r2.png",
    ])
    expect(current.shots[0].directingReferenceVideoUrls).toEqual(["https://r2/v1.mp4"])
    expect(current.shots[0].directingReferenceAudioUrls).toEqual(["https://r2/a1.mp3"])
    // An empty list clears ONLY that kind's key (minimal shape); siblings remain.
    current = framesHandlers.set_directing_references(
      current,
      { op: "set_directing_references", shotId: "a", kind: "images", urls: [] },
      ctx,
    ).production
    expect(current.shots[0]).not.toHaveProperty("directingReferenceUrls")
    expect(current.shots[0].directingReferenceVideoUrls).toEqual(["https://r2/v1.mp4"])
  })

  it("copies the url list rather than storing the caller's array", () => {
    const urls = ["https://r2/r1.png"]
    const result = framesHandlers.set_directing_references(
      production(stillOnly("a")),
      { op: "set_directing_references", shotId: "a", kind: "images", urls },
      ctx,
    )

    expect(result.production.shots[0].directingReferenceUrls).not.toBe(urls)
    expect(result.production.shots[0].directingReferenceUrls).toEqual(urls)
  })

  it("reports how many references of which kind it set", () => {
    const set = framesHandlers.set_directing_references(
      production(stillOnly("a")),
      {
        op: "set_directing_references",
        shotId: "a",
        kind: "videos",
        urls: ["https://r2/v1.mp4", "https://r2/v2.mp4"],
      },
      ctx,
    )
    expect(set.receipt).toEqual({
      op: "set_directing_references",
      summary: "Set 2 video references on Shot 1.",
    })

    const one = framesHandlers.set_directing_references(
      production(stillOnly("a")),
      {
        op: "set_directing_references",
        shotId: "a",
        kind: "audio",
        urls: ["https://r2/a1.mp3"],
      },
      ctx,
    )
    expect(one.receipt.summary).toBe("Set 1 audio reference on Shot 1.")

    const cleared = framesHandlers.set_directing_references(
      production(stillOnly("a")),
      { op: "set_directing_references", shotId: "a", kind: "images", urls: [] },
      ctx,
    )
    expect(cleared.receipt.summary).toBe("Cleared the image references on Shot 1.")
  })

  it("refuses an unknown shot id", () => {
    const before = production(stillOnly("a"))
    const error = refusal(() =>
      framesHandlers.set_directing_references(
        before,
        { op: "set_directing_references", shotId: "nope", kind: "images", urls: ["x"] },
        ctx,
      ),
    )

    expect(error.code).toBe("op_target_missing")
  })
})

describe("pending clip markers (add/remove_pending_clip)", () => {
  const marker = (jobId: string): ShotPendingClip => ({
    jobId,
    provider: "seedance-2",
    prompt: "x",
    startedAt: 1,
  })

  /** The store's `addShotPendingClip("a", marker(jobId))`. */
  const add = (input: Production, jobId: string): Production =>
    framesHandlers.add_pending_clip(
      input,
      { op: "add_pending_clip", shotId: "a", pending: marker(jobId) },
      ctx,
    ).production

  /** The store's `removeShotPendingClip("a", jobId)`. */
  const remove = (input: Production, jobId: string): Production =>
    framesHandlers.remove_pending_clip(
      input,
      { op: "remove_pending_clip", shotId: "a", jobId },
      ctx,
    ).production

  it("ACCUMULATES one marker per in-flight animate (concurrent renders)", () => {
    let current = production(stillOnly("a"))
    current = add(current, "v1")
    current = add(current, "v2")
    expect(current.shots[0].pendingClips?.map((p) => p.jobId)).toEqual(["v1", "v2"])
  })

  it("removes ONLY the matching jobId; the last removal drops the key", () => {
    let current = production(stillOnly("a"))
    current = add(current, "v1")
    current = add(current, "v2")
    // Completing v1 must not orphan the still-running v2 (the old single-slot
    // marker cleared unconditionally, losing concurrent renders on reload).
    current = remove(current, "v1")
    expect(current.shots[0].pendingClips?.map((p) => p.jobId)).toEqual(["v2"])
    current = remove(current, "v2")
    expect(current.shots[0]).not.toHaveProperty("pendingClips")
  })

  it("stores the marker the caller handed it, verbatim", () => {
    const pending: ShotPendingClip = {
      jobId: "v1",
      provider: "seedance-2",
      prompt: "x",
      startedAt: 1,
      duration: 5,
      aspectRatio: "16:9",
    }
    const result = framesHandlers.add_pending_clip(
      production(stillOnly("a")),
      { op: "add_pending_clip", shotId: "a", pending },
      ctx,
    )

    expect(result.production.shots[0].pendingClips).toEqual([pending])
    expect(result.receipt).toEqual({
      op: "add_pending_clip",
      summary: "Added an animate marker to Shot 1.",
    })
  })

  it("is copy-on-write — the marker list the caller held is untouched", () => {
    const before = add(production(stillOnly("a")), "v1")
    const after = add(before, "v2")

    expect(after.shots).not.toBe(before.shots)
    expect(before.shots[0].pendingClips?.map((p) => p.jobId)).toEqual(["v1"])
    expect(after.shots[0].pendingClips?.map((p) => p.jobId)).toEqual(["v1", "v2"])
  })

  it("refuses an unknown shot id / an unknown jobId", () => {
    const current = add(production(stillOnly("a")), "v1")

    expect(
      refusal(() =>
        framesHandlers.add_pending_clip(
          current,
          { op: "add_pending_clip", shotId: "nope", pending: marker("v2") },
          ctx,
        ),
      ).code,
    ).toBe("op_target_missing")
    expect(
      refusal(() =>
        framesHandlers.remove_pending_clip(
          current,
          { op: "remove_pending_clip", shotId: "a", jobId: "nope" },
          ctx,
        ),
      ).code,
    ).toBe("op_target_missing")
    expect(
      refusal(() =>
        framesHandlers.remove_pending_clip(
          current,
          { op: "remove_pending_clip", shotId: "nope", jobId: "v1" },
          ctx,
        ),
      ).code,
    ).toBe("op_target_missing")
    expect(
      refusal(() =>
        framesHandlers.remove_pending_clip(
          production(stillOnly("a")),
          { op: "remove_pending_clip", shotId: "a", jobId: "v1" },
          ctx,
        ),
      ).code,
    ).toBe("op_target_missing")
  })

  it("refuses a marker that carries no job id to resume", () => {
    // The schema, not the handler: a marker with no `jobId` names nothing to
    // resume on reload, which is the whole point of persisting one.
    expect(
      framesOpSchemas.add_pending_clip.safeParse({
        op: "add_pending_clip",
        shotId: "a",
        pending: { provider: "seedance-2", prompt: "x", startedAt: 1 },
      }).success,
    ).toBe(false)
    expect(
      framesOpSchemas.add_pending_clip.safeParse({
        op: "add_pending_clip",
        shotId: "a",
        pending: marker("v1"),
      }).success,
    ).toBe(true)
  })
})

describe("the section's tables", () => {
  it("declares a schema, a handler and a class for each of the five ops", () => {
    const ops = [
      "set_start_frame",
      "set_end_frame",
      "set_directing_references",
      "add_pending_clip",
      "remove_pending_clip",
    ]
    expect(Object.keys(framesOpSchemas)).toEqual(ops)
    expect(Object.keys(framesHandlers)).toEqual(ops)
    expect(Object.keys(framesOpClasses)).toEqual(ops)
    // Frames, references and markers move no media and destroy nothing.
    expect(Object.values(framesOpClasses)).toEqual(["S", "S", "S", "S", "S"])
  })

  it("takes the reference kinds from the catalog, not a retyped list", () => {
    expect(
      framesOpSchemas.set_directing_references.safeParse({
        op: "set_directing_references",
        shotId: "a",
        kind: "sprites",
        urls: [],
      }).success,
    ).toBe(false)
  })
})
