/**
 * `buildDirectingRequest`, the DOCUMENT half — the three gates it applies to the
 * shot before the wire assembly sees it.
 *
 * A sibling of `directing.test.ts` (which carries the ported hook suite) rather
 * than more of it: that file is already at the repository's file-size ceiling,
 * and these cases share none of its harness. Each of the three reproduces a
 * divergence from the seam this builder ports — `useComposerSubmit` →
 * `useHandleAnimate` → `useStartDirecting` — and each is reachable from the
 * P1.5 clip route by a provider override alone.
 */
import { describe, it, expect } from "vitest"

import { buildDirectingRequest, directingEndFrameSupported } from "../directing"
import { defaultDirectingModeFor, videoSupportsMode } from "../../model-menu"
import type { Production } from "../../ops/production"
import type { Shot } from "../../shot"

const STILL = "https://r2/still.png"

/**
 * THE DOCUMENT HALF'S OWN GATES — the two places the builder used to disagree
 * with the seam it ports (`useComposerSubmit` → `useHandleAnimate` →
 * `useStartDirecting`), each reachable from the P1.5 clip route by a provider
 * override alone.
 */
describe("buildDirectingRequest — the sticky end frame meets the catalog", () => {
  const RAIL = "https://r2/end.png"
  const OTHER = "https://r2/other.png"
  const START = "https://r2/start.png"
  const still = {
    nodeId: "generate-image-1",
    url: STILL,
    prompt: "a lighthouse",
    provider: "seedream-4",
  }
  // Reference-capable, i2v + t2v-addressable, and NO catalog "end-frame"
  // feature — the exact shape a user reaches by setting an end frame on an
  // end-frame model and then switching (the frame is sticky on the shot).
  const NO_END_FRAME = "gemini-omni-video"

  it("the fixture models are what the catalog says they are", () => {
    expect(directingEndFrameSupported(NO_END_FRAME)).toBe(false)
    expect(directingEndFrameSupported("seedance-2-5")).toBe(true)
  })

  it("keeps a rail image that happens to equal the sticky end frame", () => {
    // The dedupe removes a picture "already riding as a frame". On a model with
    // no end-frame feature the frame rides NOWHERE, so deduping against it drops
    // the user's attached reference off the wire entirely.
    const built = buildDirectingRequest(
      {
        shots: [
          {
            id: "s1",
            still,
            startFrame: START,
            endFrame: RAIL,
            directingReferenceUrls: [RAIL, OTHER],
            plan: { motion: { prompt: "she turns", input: "references" } },
          } as Shot,
        ],
      },
      "s1",
      { provider: NO_END_FRAME },
    )
    const params = built!.params as unknown as Record<string, unknown>
    expect(built!.lane).toBe("generate-video")
    expect(params.imageUrl).toBe(START)
    expect(params.referenceImageUrls).toEqual([RAIL, OTHER])
    expect(params.endFrameUrl).toBeUndefined()
  })

  it("does not let the still seed replace the rail image on an unframed shot", () => {
    const built = buildDirectingRequest(
      {
        shots: [
          {
            id: "s1",
            still,
            endFrame: RAIL,
            directingReferenceUrls: [RAIL],
            plan: { motion: { prompt: "she turns", input: "references" } },
          } as Shot,
        ],
      },
      "s1",
      { provider: NO_END_FRAME },
    )
    const params = built!.params as unknown as Record<string, unknown>
    expect(params.referenceImageUrls).toEqual([RAIL])
    expect(params.imageUrl).toBeUndefined()
    expect(params.endFrameUrl).toBeUndefined()
  })

  it("…and on an END-FRAME model the frame rides and the rail dedupes, as before", () => {
    const built = buildDirectingRequest(
      {
        shots: [
          {
            id: "s1",
            still,
            endFrame: RAIL,
            directingReferenceUrls: [RAIL],
            plan: { motion: { prompt: "she turns", input: "references" } },
          } as Shot,
        ],
      },
      "s1",
      { provider: "seedance-2-5" },
    )
    const params = built!.params as unknown as Record<string, unknown>
    expect(built!.lane).toBe("generate-video")
    expect(params.endFrameUrl).toBe(RAIL)
    expect(params.referenceImageUrls).toEqual([STILL])
  })
})

describe("buildDirectingRequest — beats own their chips", () => {
  const KIRA = {
    id: "kira",
    defaultName: "Kira",
    source: "wired-character" as const,
    url: "https://r2/kira.png",
  }
  const MULI = {
    id: "muli",
    defaultName: "Muli",
    source: "wired-character" as const,
    url: "https://r2/muli.png",
  }
  const beatShot = (): Shot =>
    ({
      id: "s1",
      still: {
        nodeId: "generate-image-1",
        url: STILL,
        prompt: "a lighthouse",
        provider: "seedream-4",
      },
      beats: [{ id: "b1", seconds: 3, text: "Kira waves.", references: [KIRA] }],
      plan: {
        motion: { prompt: "Muli walks", input: "references", references: [MULI] },
      },
    }) as Shot

  it("sends the BEAT's chips when the beats own the prose", () => {
    // One predicate switches both halves in the composer (`references:
    // beatsActive ? beatReferences : directingRefs`). The builder already folds
    // the beats into the body; the chips have to move with them, or the wire
    // says a name whose face it never sent.
    const built = buildDirectingRequest(productionWithBeats(), "s1", {
      provider: "seedance-2",
    })
    const params = built!.params as unknown as Record<string, unknown>
    expect(params.connectedReferences).toEqual([KIRA])
    expect(params.prompt).toBe("Kira ({ref:kira}) waves.")
  })

  it("persists the SAME chips on the marker", () => {
    // The marker is what a render finishing after a reload lands the clip with;
    // the scene's chips there would put someone else's references on the take.
    const built = buildDirectingRequest(productionWithBeats(), "s1", {
      provider: "seedance-2",
    })
    expect(built!.marker.references).toEqual([KIRA])
  })

  it("falls back to the scene's chips when there are no beats", () => {
    const shot = { ...beatShot() } as Shot
    delete (shot as { beats?: unknown }).beats
    const built = buildDirectingRequest({ shots: [shot] }, "s1", {
      provider: "seedance-2",
    })
    const params = built!.params as unknown as Record<string, unknown>
    expect(params.connectedReferences).toEqual([MULI])
    expect(built!.marker.references).toEqual([MULI])
  })

  it("dedupes the union by id, first use wins, in beat order", () => {
    const shot = {
      ...beatShot(),
      beats: [
        { id: "b1", seconds: 3, text: "Kira waves.", references: [KIRA] },
        { id: "b2", seconds: 3, text: "Muli walks.", references: [MULI, KIRA] },
      ],
    } as Shot
    const built = buildDirectingRequest({ shots: [shot] }, "s1", {
      provider: "seedance-2",
    })
    const params = built!.params as unknown as Record<string, unknown>
    expect(params.connectedReferences).toEqual([KIRA, MULI])
  })

  function productionWithBeats(): Production {
    return { shots: [beatShot()] }
  }
})

describe("buildDirectingRequest — described roles name themselves", () => {
  it("gives a described role's token its human word back on the wire", () => {
    const built = buildDirectingRequest(
      {
        shots: [
          {
            id: "s1",
            plan: { motion: { prompt: "@teodora-lisle walks in" } },
          } as Shot,
        ],
      },
      "s1",
      { provider: "veo3.1" },
      {
        describedReferences: [{ name: "Teodora Lisle", description: "auburn hair" }],
      },
    )
    const params = built!.params as unknown as Record<string, unknown>
    expect(params.prompt).toBe("Teodora Lisle walks in")
    expect(params.describedReferences).toEqual([
      { name: "Teodora Lisle", description: "auburn hair" },
    ])
  })

  it("leaves the MARKER's neutral prose alone — it stores what was authored", () => {
    const built = buildDirectingRequest(
      {
        shots: [
          {
            id: "s1",
            plan: { motion: { prompt: "@teodora-lisle walks in" } },
          } as Shot,
        ],
      },
      "s1",
      { provider: "veo3.1" },
      {
        describedReferences: [{ name: "Teodora Lisle", description: "auburn hair" }],
      },
    )
    expect(built!.marker.prompt).toBe("@teodora-lisle walks in")
  })
})

describe("buildDirectingRequest — the mode is clamped to the model", () => {
  const still = {
    nodeId: "generate-image-1",
    url: STILL,
    prompt: "a lighthouse",
    provider: "seedream-4",
  }
  const framed = (motion: Record<string, unknown>): Production => ({
    shots: [{ id: "s1", still, plan: { motion } } as Shot],
  })

  it("the fixture models are what the catalog says they are", () => {
    // Derived, never pinned: the clamp reads these two, so the cases below are
    // a catalog drift guard rather than a restatement of today's matrix.
    expect(videoSupportsMode("seedance-2-5", "references")).toBe(true)
    expect(defaultDirectingModeFor("seedance-2-5")).toBe("references")
    expect(videoSupportsMode("kling-turbo", "references")).toBe(false)
  })

  it("a plan with no `input` takes the MODEL's default, not a hardcoded start", () => {
    // On a references-default model the plain "frame → Animate" drives the shot
    // AS A REFERENCE; a hardcoded "start" locked it to a start keyframe instead.
    const built = buildDirectingRequest(framed({ prompt: "she turns" }), "s1", {
      provider: "seedance-2-5",
    })
    const params = built!.params as unknown as Record<string, unknown>
    expect(params.referenceImageUrls).toEqual([STILL])
    expect(params.imageUrl).toBeUndefined()
  })

  it("a stored mode the active model has no lane for is clamped away", () => {
    // `input` is a claim about the model it was authored on; a provider override
    // on the clip route is enough to make it stale.
    const built = buildDirectingRequest(
      framed({ prompt: "she turns", input: "references" }),
      "s1",
      { provider: "kling-turbo" },
    )
    const params = built!.params as unknown as Record<string, unknown>
    expect(params.connectedReferences).toBeUndefined()
    expect(params.referenceImageUrls).toBeUndefined()
    expect(params.imageUrl).toBe(STILL)
  })
})
