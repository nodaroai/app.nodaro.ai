import { describe, expect, it } from "vitest"
import { VIDEO_MODE_ALIASES } from "@nodaro/shared"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../models.js"

/**
 * Guard: the unified Generate Video picker shows ONE row per split-id model and
 * remaps base→mode id at execution via `resolveVideoProviderForMode`. That remap
 * can only route to a real KIE endpoint if every alias id is an actual key in the
 * right per-mode KIE map. KIE keys i2v and t2v off DIFFERENT ids in DIFFERENT
 * maps, so a wrong id silently resolves to `undefined` → the job crashes with
 * "Unknown model". This test fails fast if the shared alias registry ever drifts
 * from the backend KIE maps (typo, renamed model, removed endpoint).
 */
describe("VIDEO_MODE_ALIASES resolve to real KIE models", () => {
  it("every group's i2v id is a key in KIE_VIDEO_MODELS (image-to-video)", () => {
    for (const g of VIDEO_MODE_ALIASES) {
      expect(
        KIE_VIDEO_MODELS[g.i2v],
        `i2v id '${g.i2v}' is missing from KIE_VIDEO_MODELS`,
      ).toBeDefined()
    }
  })

  it("every group's t2v id is a key in KIE_TEXT_TO_VIDEO_MODELS (text-to-video)", () => {
    for (const g of VIDEO_MODE_ALIASES) {
      expect(
        KIE_TEXT_TO_VIDEO_MODELS[g.t2v],
        `t2v id '${g.t2v}' is missing from KIE_TEXT_TO_VIDEO_MODELS`,
      ).toBeDefined()
    }
  })
})
