// @test-watches frontend/src/nodes/**
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { NODE_CREDIT_COSTS } from "../types"

/**
 * `NODE_CREDIT_COSTS` (and its motion-transfer sibling) are the FALLBACK the
 * pre-run estimate uses when the model-cost cache has no entry for a node. They
 * are a second copy of prices whose authority lives in `model_pricing` — so they
 * drift silently, and when they drift the user is quoted a number the run will
 * not actually cost.
 *
 * They drifted exactly that way through the 2026-07-30 ×10 credit
 * re-denomination: the migration swept `STATIC_CREDIT_COSTS`, `model_pricing`,
 * `MODEL_CATALOG` and the video-analysis table, but never touched this file, so
 * every fallback quoted a tenth of the real price. Nothing failed — the estimate
 * is advisory, so there was no crash to notice.
 *
 * This pins the overlap with the catalog, which is the part that CAN be checked
 * from the frontend. It does not cover the node-type-only keys (`generate-image`
 * and friends have no catalog row); those are deliberately rough.
 */
function catalogPrices(): Map<string, number> {
  const out = new Map<string, number>()
  for (const entry of Object.values(MODEL_CATALOG)) {
    for (const p of entry?.pricing ?? []) {
      if (typeof p?.credits === "number") out.set(p.identifier, p.credits)
    }
  }
  return out
}

describe("credit estimate fallback tables track the catalog", () => {
  it("every fallback key that the catalog also prices agrees with it", () => {
    const catalog = catalogPrices()
    let compared = 0
    for (const [id, credits] of Object.entries(NODE_CREDIT_COSTS)) {
      const authoritative = catalog.get(id)
      if (authoritative === undefined) continue
      expect(
        credits,
        `NODE_CREDIT_COSTS["${id}"] = ${credits}, but MODEL_CATALOG prices it at ${authoritative}. ` +
          `The estimate would quote the user the wrong number — copy the catalog value, do not scale the old one.`,
      ).toBe(authoritative)
      compared++
    }
    // A cross-check that silently compares nothing is worse than no cross-check:
    // if the catalog shape changes and every lookup starts missing, fail here
    // rather than pass vacuously.
    expect(compared, "no keys were compared — the catalog lookup broke").toBeGreaterThan(0)
  })

  it("carries BOTH add-captions rows, with the Remotion render the dearer one", () => {
    // Add Captions prices by RENDERER, not by node: `getModelIdentifier`
    // resolves `add-captions:kinetic` for anything styled / timed /
    // transcribed / segmented and plain `add-captions` for the cheap FFmpeg
    // drawtext burn. `estimateRunCredits` looks the composite up here first, so
    // a missing key silently quoted the burn price for a Remotion run.
    //
    // MODEL_CATALOG prices models, not node-type rows, so the loop above cannot
    // reach these two — the authority is `STATIC_CREDIT_COSTS`, pinned against
    // this whole table by
    // `backend/src/lib/__tests__/frontend-credit-fallback-parity.test.ts`.
    expect(NODE_CREDIT_COSTS["add-captions"]).toBeDefined()
    expect(NODE_CREDIT_COSTS["add-captions:kinetic"]).toBeDefined()
    expect(NODE_CREDIT_COSTS["add-captions:kinetic"]).toBeGreaterThan(
      NODE_CREDIT_COSTS["add-captions"],
    )
  })

  it("the table is denominated in the CURRENT credit base, not a stale one", () => {
    // Anchored on a node whose price is well above the noise floor. At the old
    // $0.02 base this was 50; a re-denomination that forgets this file leaves it
    // at 50 and the estimate under-quotes by 10×. Expressed as dollars so the
    // assertion survives the NEXT base change instead of becoming the next
    // stale literal.
    const i2vUsd = NODE_CREDIT_COSTS["image-to-video"] * CREDIT_BASE_USD
    expect(i2vUsd).toBeCloseTo(1.0, 6)
  })
})
