/**
 * The `clips` section — `set_active_clip`, `rename_clip_result` and the
 * section's own tables.
 *
 * One of three siblings carrying the ported clip suite; the harness, and the
 * doc comment that explains the port, live in
 * `./helpers/clips-fixtures.ts`. The assertions here are untouched.
 */

import { describe, expect, it } from "vitest"
import type { Production } from "../production"
import { clipsHandlers, clipsOpClasses, clipsOpSchemas } from "../sections/clips"

import {
  add,
  ctx,
  expectRefused,
  prod,
  rename,
  setActive,
  stillOnly,
  withStartFrame,
} from "./helpers/clips-fixtures"

describe("set_active_clip (setActiveClipResult)", () => {
  /**
   * Seed THREE clip results from DIFFERENT frames. The FIRST result's frames are
   * lost to the legacy collapse (single → minimal, like a still's first
   * prompt/refs), so the restorable history is results[1] + results[2].
   */
  const seedThreeFramed = (): Production => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/1.mp4", startFrameUrl: "https://r2/start1.png" })
    p = add(p, "a", {
      url: "https://r2/2.mp4",
      startFrameUrl: "https://r2/start2.png",
      endFrameUrl: "https://r2/end2.png",
    })
    p = add(p, "a", {
      url: "https://r2/3.mp4",
      startFrameUrl: "https://r2/start3.png",
      endFrameUrl: "https://r2/end3.png",
    })
    return p
  }

  it("picks an existing clip as active (updates url)", () => {
    let p = seedThreeFramed() // active = 2
    p = setActive(p, "a", "https://r2/2.mp4")
    const clip = p.shots[0].clip
    expect(clip?.activeIndex).toBe(1)
    expect(clip?.url).toBe("https://r2/2.mp4")
  })

  it("restores the shot's start/end frames to the picked clip's source frames (#9c)", () => {
    let p = seedThreeFramed() // active = 2 (result 3's frames)
    p = setActive(p, "a", "https://r2/2.mp4")
    // Stepping back to clip 2 brings back the frames IT was made from.
    expect(p.shots[0].startFrame).toBe("https://r2/start2.png")
    expect(p.shots[0].endFrame).toBe("https://r2/end2.png")
  })

  it("leaves the shot's frames unchanged when the picked clip stored none (no clobber)", () => {
    let p = prod([stillOnly("a")])
    // A frame-less first + second result (neither captures frames), then a third
    // WITH frames so the list survives. results[1] stored no frames.
    p = add(p, "a", { url: "https://r2/1.mp4" })
    p = add(p, "a", { url: "https://r2/2.mp4" })
    p = add(p, "a", {
      url: "https://r2/3.mp4",
      startFrameUrl: "https://r2/start3.png",
    })
    p = withStartFrame(p, "https://r2/live.png") // user pins a live frame
    // Selecting result 1 (which stored NO frames) leaves the live frame untouched.
    p = setActive(p, "a", "https://r2/2.mp4")
    expect(p.shots[0].startFrame).toBe("https://r2/live.png")
  })

  it("is a no-op for the already-active take; REFUSES an unknown key", () => {
    // CONVERTED: the reducer no-ops on BOTH an already-active index and an
    // out-of-range one. Addressed by key, the second is a target that does not
    // exist — refused (rule 5); the first stays the identity no-op it was.
    const p = seedThreeFramed() // active = 2
    const already = clipsHandlers.set_active_clip(
      p,
      { op: "set_active_clip", shotId: "a", result: "https://r2/3.mp4" },
      ctx,
    )
    expect(Object.is(p, already.production)).toBe(true)
    expect(already.warnings?.length).toBeGreaterThan(0)

    expectRefused(() => setActive(p, "a", "https://r2/9.mp4"), "op_target_missing")
  })

  it("REFUSES a shot with no clip / an unknown id", () => {
    // CONVERTED from "is a no-op for a shot with no clip / unknown id".
    const p = prod([stillOnly("a")])
    expectRefused(() => setActive(p, "a", "https://r2/1.mp4"), "op_target_missing")
    expectRefused(() => setActive(p, "nope", "https://r2/1.mp4"), "op_target_missing")
    expect(p.shots[0].clip).toBeUndefined()
  })

  it("restores the input MODE + references when stepping between frames/references clips", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/1.mp4" }) // collapses
    p = add(p, "a", {
      url: "https://r2/2.mp4",
      startFrameUrl: "https://r2/start2.png",
      endFrameUrl: "https://r2/end2.png",
    }) // frames-mode
    p = add(p, "a", {
      url: "https://r2/3.mp4",
      referenceImageUrls: ["https://r2/ref1.png"],
    }) // references-mode (active)

    // Step to the keyframe clip → its start/end frame restored.
    p = setActive(p, "a", "https://r2/2.mp4")
    expect(p.shots[0].startFrame).toBe("https://r2/start2.png")
    expect(p.shots[0].endFrame).toBe("https://r2/end2.png")

    // Step to the references clip → references restored, and the stale end frame
    // is dropped (references drop the end frame).
    p = setActive(p, "a", "https://r2/3.mp4")
    expect(p.shots[0].directingReferenceUrls).toEqual(["https://r2/ref1.png"])
    expect(p.shots[0].endFrame).toBeUndefined()

    // Step BACK to the frames clip → references cleared, end frame restored
    // (the restored setup reflects only the now-active clip).
    p = setActive(p, "a", "https://r2/2.mp4")
    expect(p.shots[0].directingReferenceUrls).toBeUndefined()
    expect(p.shots[0].endFrame).toBe("https://r2/end2.png")
  })

  it("restores BOTH the references and the end frame of a take made with them (D27)", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/1.mp4" }) // collapses
    p = add(p, "a", {
      url: "https://r2/2.mp4",
      referenceImageUrls: ["https://r2/ref1.png"],
      endFrameUrl: "https://r2/end2.png",
    })

    p = setActive(p, "a", "https://r2/1.mp4")
    expect(p.shots[0].endFrame).toBeUndefined()

    p = setActive(p, "a", "https://r2/2.mp4")
    expect(p.shots[0].directingReferenceUrls).toEqual(["https://r2/ref1.png"])
    expect(p.shots[0].endFrame).toBe("https://r2/end2.png")
  })
})

describe("rename_clip_result (setClipResultName)", () => {
  // A framed shot with one clip take — the video mirror of the still seed. The
  // still + anchored start frame are what `addShotStillResult` would have left.
  const seedClip = (id: string): Production =>
    add(
      prod([
        {
          id,
          still: {
            nodeId: `generate-image-${id}`,
            url: "https://r2/still.png",
            provider: "p",
            prompt: "q",
          },
          startFrame: "https://r2/still.png",
        },
      ]),
      id,
      { url: "https://r2/take1.mp4", provider: "seedance-2", duration: 5 },
    )

  it("sets a trimmed TAKE name + KEEPS a lone named take's list", () => {
    let p = seedClip("a")
    p = rename(p, "a", "https://r2/take1.mp4", "  Crash into frame  ")
    const clip = p.shots[0].clip
    expect(clip?.results?.[0]?.name).toBe("Crash into frame")
    // A lone NAMED take must keep its results list (else the name collapses away
    // on the next buildClip — the same invariant stills pin).
    expect(clip?.results).toHaveLength(1)
  })

  it("clears the name on a blank value (reverts to the derived Take N)", () => {
    let p = seedClip("a")
    p = rename(p, "a", "https://r2/take1.mp4", "Crash")
    p = rename(p, "a", "https://r2/take1.mp4", "   ") // blank → clear
    const clip = p.shots[0].clip
    // The take keeps its list either way (it records the frame it was animated
    // from), so clearing the name clears the FIELD, not the shape.
    expect(clip?.results).toHaveLength(1)
    expect(clip?.results?.[0]?.name).toBeUndefined()
    expect(clip?.url).toBe("https://r2/take1.mp4")
  })

  it("is immutable + a no-op for an unchanged name; REFUSES an unknown shot / key", () => {
    // CONVERTED: the unchanged-name no-op keeps its identity assertion; the
    // out-of-range index and the unknown shot become refusals (rule 5).
    let p = seedClip("a")
    p = rename(p, "a", "https://r2/take1.mp4", "Crash")
    const before = p
    const unchanged = clipsHandlers.rename_clip_result(
      p,
      { op: "rename_clip_result", shotId: "a", result: "https://r2/take1.mp4", name: "Crash" },
      ctx,
    )
    expect(Object.is(before, unchanged.production)).toBe(true)
    expect(unchanged.warnings?.length).toBeGreaterThan(0)

    expectRefused(() => rename(p, "a", "https://r2/nope.mp4", "X"), "op_target_missing")
    expectRefused(() => rename(p, "nope", "https://r2/take1.mp4", "X"), "op_target_missing")
  })
})

describe("the section's tables", () => {
  it("declares a class for every schema, and a handler for every one", () => {
    expect(Object.keys(clipsOpClasses)).toEqual(Object.keys(clipsOpSchemas))
    expect(Object.keys(clipsHandlers)).toEqual(Object.keys(clipsOpSchemas))
    expect(clipsOpClasses.remove_clip_result).toBe("D") // the only delete
    expect(clipsOpClasses.add_clip_result).toBe("S")
    expect(clipsOpClasses.set_active_clip).toBe("S")
    expect(clipsOpClasses.rename_clip_result).toBe("S")
  })

  it("parses each op's args", () => {
    expect(
      clipsOpSchemas.set_active_clip.parse({
        op: "set_active_clip",
        shotId: "a",
        result: "job-1",
      }),
    ).toEqual({ op: "set_active_clip", shotId: "a", result: "job-1" })
    expect(() =>
      clipsOpSchemas.add_clip_result.parse({
        op: "add_clip_result",
        shotId: "a",
        result: { noUrl: true },
      }),
    ).toThrow()
  })
})
