import { describe, it, expect } from "vitest"

import {
  VIDEO_MODEL_ALLOWLIST,
  videoReferenceSupported,
  videoSupportsEndFrame,
} from "../model-menu"
import {
  chooseVideoLane,
  directingLaneShotInputs,
  videoProviderFoldsLoneEndFrame,
} from "../video-lane"

/**
 * The lane chooser is the ONE place that decides which platform video endpoint a
 * directing run goes to. Real catalog ids keep these a drift guard: the branches
 * are derived from `TEXT_TO_VIDEO_PROVIDERS` / `videoProviderRequiresImage` /
 * `videoReferenceSupported`, never from a hand-kept list, so a catalog change
 * that moves a model between families moves these expectations with it.
 */

const P = {
  hasStartFrame: false,
  hasRefs: false,
  hasEndFrame: false,
  hasPrompt: true,
} as const

describe("chooseVideoLane — a start frame is the image-to-video lane", () => {
  it("sends any run WITH a start frame to generate-video", () => {
    for (const provider of ["seedance-2-5", "veo3.1", "kling-3-omni", "kling-master"]) {
      expect(chooseVideoLane({ ...P, provider, hasStartFrame: true })).toBe(
        "generate-video",
      )
      // …refs and the end frame ride along; the server folds them (it writes the
      // first/last-frame note itself), so the lane doesn't change.
      expect(
        chooseVideoLane({ ...P, provider, hasStartFrame: true, hasRefs: true }),
      ).toBe("generate-video")
    }
  })

  it("keeps a frames run on generate-video even with NO prompt (its prompt is optional)", () => {
    expect(
      chooseVideoLane({
        provider: "seedance-2-5",
        hasStartFrame: true,
        hasRefs: false,
        hasEndFrame: false,
        hasPrompt: false,
      }),
    ).toBe("generate-video")
  })
})

describe("chooseVideoLane — references without a start frame", () => {
  it("uses text-to-video on a t2v-addressable model (seedance-2-5)", () => {
    expect(
      chooseVideoLane({ ...P, provider: "seedance-2-5", hasRefs: true }),
    ).toBe("text-to-video")
  })

  it("stays on generate-video when the model is image-required but ref-capable (kling-3-omni)", () => {
    // The route's ref-only exemption (`hasMultimodalRef`) is what lets this run
    // through without an imageUrl; /v1/text-to-video would 400 `image_required`.
    expect(
      chooseVideoLane({ ...P, provider: "kling-3-omni", hasRefs: true }),
    ).toBe("generate-video")
  })

  it("stays on generate-video for a model the t2v route's provider enum does not carry (grok-i2v)", () => {
    // grok-i2v is NOT in TEXT_TO_VIDEO_PROVIDERS even though it isn't on the
    // image-required guard — `provider: z.enum(TEXT_TO_VIDEO_PROVIDERS)` would
    // reject it. Membership, not the guard alone, is the lane's admission test.
    expect(chooseVideoLane({ ...P, provider: "grok-i2v", hasRefs: true })).toBe(
      "generate-video",
    )
  })

  it("takes the image-to-video lane when an END frame rides with them (seedance-2-5)", () => {
    // Owner ruling 2026-09-04 — "refs + start/end frame → references WITH the
    // frames". Only `/v1/generate-video` has an `endFrameUrl` field; the
    // references are what admit the frame-less run (`hasMultimodalRef`), and the
    // seedance / minimax-h3 / wan family folds a lone last frame INTO the
    // references with the server-written closing-frame note. Without this the
    // run would take the text-to-video lane and the end frame would vanish.
    expect(
      chooseVideoLane({
        ...P,
        provider: "seedance-2-5",
        hasRefs: true,
        hasEndFrame: true,
      }),
    ).toBe("generate-video")
  })

  it("still has NO lane for an end frame + references on a model with no reference support (kling-master)", () => {
    // The end-frame branch buys nothing a reference-less provider can use: the
    // references are what the route's exemption reads, so kling-master stays
    // exactly as it was — a disabled CTA, not a 400.
    expect(
      chooseVideoLane({
        ...P,
        provider: "kling-master",
        hasRefs: true,
        hasEndFrame: true,
      }),
    ).toBeNull()
  })

  it("stays on generate-video when there is no prompt (that lane's prompt is required)", () => {
    // A chips-only submit with no prose: /v1/text-to-video needs `prompt` min(1),
    // so the references run goes to the lane whose prompt is optional instead of
    // becoming a disabled CTA.
    expect(
      chooseVideoLane({
        provider: "seedance-2-5",
        hasStartFrame: false,
        hasRefs: true,
        hasEndFrame: false,
        hasPrompt: false,
      }),
    ).toBe("generate-video")
  })

  it("has NO lane for an image-required model with no reference support (kling-master)", () => {
    expect(
      chooseVideoLane({ ...P, provider: "kling-master", hasRefs: true }),
    ).toBeNull()
  })
})

describe("chooseVideoLane — an END frame with no start frame", () => {
  // ROLLOUT-GATED. A LONE last frame used to be RESOLVER-legal but ROUTE-illegal
  // (the gate read `referenceImageUrls` before the resolver folded the frame in),
  // so studio handed the picture back as a reference to buy it a ride. The route
  // takes an `endFrameUrl` with no `imageUrl` now — but only where the model
  // actually FOLDS it, which is NOT the same set as "carries image references":
  // VEO ships `[imageUrl, endFrameUrl]` verbatim and kling-3-omni's generic KIE
  // path sends `end_frame` with no image param. Both families are enumerated from
  // the catalog here so a model that changes families changes these expectations.
  const endFrameRefModels = VIDEO_MODEL_ALLOWLIST.filter(
    (p) => videoSupportsEndFrame(p) && videoReferenceSupported(p),
  )
  const folding = endFrameRefModels.filter((p) => videoProviderFoldsLoneEndFrame(p))
  const nonFolding = endFrameRefModels.filter(
    (p) => !videoProviderFoldsLoneEndFrame(p),
  )

  it("splits the end-frame + reference-capable models into two real families", () => {
    // Names, so an empty partition can never make the loops below vacuous.
    expect(folding).toEqual(expect.arrayContaining(["seedance-2-5"]))
    expect(nonFolding).toEqual(
      expect.arrayContaining(["veo3.1", "veo3", "kling-3-omni"]),
    )
  })

  it("opens the image-to-video lane ALONE only on a model that folds it", () => {
    for (const provider of folding) {
      expect(chooseVideoLane({ ...P, provider, hasEndFrame: true })).toBe(
        "generate-video",
      )
    }
    for (const provider of nonFolding) {
      // Nothing to fold the frame into: the run lands exactly where it would
      // have without one, rather than on a lane whose gate would 400 it.
      expect(chooseVideoLane({ ...P, provider, hasEndFrame: true })).toBe(
        chooseVideoLane({ ...P, provider }),
      )
      expect(
        chooseVideoLane({ ...P, provider, hasEndFrame: true }),
      ).not.toBe("generate-video")
    }
  })

  it("rides BESIDE references on every reference-capable model (rule 2a)", () => {
    // The references are what admit the frame-less run (`hasMultimodalRef`), so
    // this half never needed the fold — and a non-folding VEO run must keep it.
    for (const provider of endFrameRefModels) {
      expect(
        chooseVideoLane({ ...P, provider, hasRefs: true, hasEndFrame: true }),
      ).toBe("generate-video")
    }
  })
})

describe("chooseVideoLane — neither frames nor references", () => {
  it("uses text-to-video for a prompt-only run on a t2v model (veo3)", () => {
    expect(chooseVideoLane({ ...P, provider: "veo3" })).toBe("text-to-video")
  })

  it("has NO lane without a prompt", () => {
    expect(
      chooseVideoLane({ ...P, provider: "veo3", hasPrompt: false }),
    ).toBeNull()
  })

  it("has NO lane on an image-required model (kling-master)", () => {
    expect(chooseVideoLane({ ...P, provider: "kling-master" })).toBeNull()
  })
})

describe("directingLaneShotInputs — what the shot contributes, per input mode", () => {
  const still = "https://r2/still.png"
  const start = "https://r2/start.png"

  it("frames modes animate from the explicit start frame, else the still", () => {
    for (const mode of ["start", "start-end"] as const) {
      expect(
        directingLaneShotInputs({
          mode,
          provider: "seedance-2-5",
          startFrame: start,
          stillUrl: still,
          hasRailReferences: true,
        }),
      ).toEqual({ startFrameUrl: start, hasRefs: false })
      expect(
        directingLaneShotInputs({
          mode,
          provider: "seedance-2-5",
          stillUrl: still,
          hasRailReferences: false,
        }),
      ).toEqual({ startFrameUrl: still, hasRefs: false })
    }
  })

  it("frames modes have no start frame on a model that can't take one", () => {
    expect(
      directingLaneShotInputs({
        mode: "start",
        provider: "wan-2.7-t2v",
        stillUrl: still,
        hasRailReferences: false,
      }),
    ).toEqual({ startFrameUrl: undefined, hasRefs: false })
  })

  it("References mode sends ONLY an explicit start frame — the still stays a reference seed", () => {
    expect(
      directingLaneShotInputs({
        mode: "references",
        provider: "seedance-2-5",
        startFrame: start,
        stillUrl: still,
        hasRailReferences: false,
      }),
    ).toEqual({ startFrameUrl: start, hasRefs: false })
    expect(
      directingLaneShotInputs({
        mode: "references",
        provider: "seedance-2-5",
        stillUrl: still,
        hasRailReferences: false,
      }),
    ).toEqual({ startFrameUrl: undefined, hasRefs: true })
  })

  it("References mode counts the rail media", () => {
    expect(
      directingLaneShotInputs({
        mode: "references",
        provider: "seedance-2-5",
        hasRailReferences: true,
      }),
    ).toEqual({ startFrameUrl: undefined, hasRefs: true })
  })

  it("Text mode contributes nothing — a pure prompt run even when the shot has a still", () => {
    expect(
      directingLaneShotInputs({
        mode: "text",
        provider: "seedance-2-5",
        startFrame: start,
        stillUrl: still,
        hasRailReferences: true,
      }),
    ).toEqual({ startFrameUrl: undefined, hasRefs: false })
  })
})
