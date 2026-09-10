import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  normalizeModelInput,
  validateModelInput,
  defaultResolutionFor,
} from "../model-catalog.js"

/**
 * `normalizeModelInput` is the correcting twin of `validateModelInput`, used at
 * persistence and execution boundaries where rejecting a fixable value would
 * abort a run (and take every already-billed sibling node with it).
 *
 * The load-bearing invariant is the round-trip: whatever the normalizer emits
 * MUST satisfy the validator. If those two ever disagree, a "normalized" node
 * still 400s upstream and the whole exercise is theatre.
 */

describe("normalizeModelInput", () => {
  it("leaves an already-valid combination untouched", () => {
    const out = normalizeModelInput("gpt-image-2", { aspectRatio: "16:9", resolution: "2K" })
    expect(out.aspectRatio).toBe("16:9")
    expect(out.resolution).toBe("2K")
    expect(out.adjustments).toEqual([])
  })

  it("snaps the aspect ratio that aborted the 2026-08-09 run", () => {
    // gpt-image (GPT Image 1.5) accepts 1:1 / 3:2 / 2:3 only — KIE rejects 16:9.
    const out = normalizeModelInput("gpt-image", { aspectRatio: "16:9" })
    expect(out.aspectRatio).not.toBe("16:9")
    expect(MODEL_CATALOG["gpt-image"].aspectRatios).toContain(out.aspectRatio!)
    expect(out.adjustments).toHaveLength(1)
    expect(out.adjustments[0].field).toBe("aspectRatio")
    expect(out.adjustments[0].from).toBe("16:9")
    // The reason is user-facing — it must name the alternatives.
    expect(out.adjustments[0].reason).toContain("3:2")
  })

  it("drops a lever the model does not have at all", () => {
    // Same node also carried resolution "2K"; GPT Image 1.5 has no resolution.
    const out = normalizeModelInput("gpt-image", { resolution: "2K" })
    expect(out.resolution).toBeUndefined()
    expect(out.adjustments[0]).toMatchObject({ field: "resolution", from: "2K", to: undefined })
  })

  it("canonicalizes an equivalent spelling instead of re-pricing the node", () => {
    // Flux 2 resolution reaches the payload builder as a bare megapixel count
    // ("1"); the catalog lists the display form ("1 MP"). Treating that as
    // invalid would snap it to the 2 MP default — a silent price increase on a
    // node the user configured correctly.
    const out = normalizeModelInput("flux-2-pro", { resolution: "1" })
    expect(out.resolution).toBe("1 MP")
    expect(out.adjustments).toEqual([])
    // Case drift is the same class of non-change.
    expect(normalizeModelInput("nano-banana-pro", { resolution: "4k" }).resolution).toBe("4K")
    expect(normalizeModelInput("nano-banana-pro", { resolution: "4k" }).adjustments).toEqual([])
  })

  it("does NOT treat a different unit as equivalent", () => {
    // "1" must not quietly satisfy a 1K/2K/4K model — those are different scales.
    const out = normalizeModelInput("nano-banana-pro", { resolution: "1" })
    expect(out.resolution).not.toBe("1")
    expect(MODEL_CATALOG["nano-banana-pro"].resolutions).toContain(out.resolution!)
    expect(out.adjustments).toHaveLength(1)
  })

  it("prefers the Flux 2 default over the cheapest option when snapping", () => {
    // options[0] is "0.5 MP" — snapping there would silently downgrade quality.
    const out = normalizeModelInput("flux-2-pro", { resolution: "2K" })
    expect(out.resolution).toBe(defaultResolutionFor("flux-2-pro"))
    expect(out.resolution).toBe("2 MP")
  })

  it("applies the gpt-image-2 cross-field rules after snapping", () => {
    expect(normalizeModelInput("gpt-image-2", { aspectRatio: "auto", resolution: "4K" }).resolution).toBe("1K")
    expect(normalizeModelInput("gpt-image-2", { aspectRatio: "1:1", resolution: "4K" }).resolution).toBe("2K")
  })

  // GPT Image 2.5 is NOT GPT Image 2. Its KIE docs
  // (docs.kie.ai/market/gpt/gpt-image-2-5-*) state no aspect_ratio x resolution
  // restriction, so the cross-field block above must NOT be widened to these
  // ids "for consistency" — doing so would silently downgrade a paid 4K render
  // to 1K. If GPT Image 2.5 ever documents such a limit, add it deliberately
  // and change this test in the same commit.
  it.each([
    "gpt-image-2-5-flare",
    "gpt-image-2-5-flare-i2i",
    "gpt-image-2-5-sunburst",
    "gpt-image-2-5-sunburst-i2i",
  ])("%s has NO cross-field aspect-ratio x resolution rule", (modelId) => {
    const auto4k = normalizeModelInput(modelId, { aspectRatio: "auto", resolution: "4K" })
    expect(auto4k.resolution).toBe("4K")
    expect(auto4k.adjustments).toEqual([])

    const square4k = normalizeModelInput(modelId, { aspectRatio: "1:1", resolution: "4K" })
    expect(square4k.resolution).toBe("4K")
    expect(square4k.adjustments).toEqual([])
  })

  // The four ratios 2.5 introduced are new to the platform vocabulary; the snap
  // must accept them rather than rewrite them to a neighbour.
  it.each(["27:16", "16:27", "9:8", "8:9", "21:9", "3:2"])(
    "gpt-image-2.5 keeps the newly-added ratio %s",
    (ratio) => {
      const out = normalizeModelInput("gpt-image-2-5-flare", { aspectRatio: ratio })
      expect(out.aspectRatio).toBe(ratio)
      expect(out.adjustments).toEqual([])
    },
  )

  it("passes unknown model ids through untouched (the Zod enum owns those)", () => {
    const out = normalizeModelInput("totally-fake-model", { aspectRatio: "21:9" })
    expect(out.aspectRatio).toBe("21:9")
    expect(out.adjustments).toEqual([])
  })

  it("is idempotent — normalizing twice changes nothing the second time", () => {
    const once = normalizeModelInput("gpt-image", { aspectRatio: "16:9", resolution: "2K" })
    const twice = normalizeModelInput("gpt-image", {
      aspectRatio: once.aspectRatio,
      resolution: once.resolution,
    })
    expect(twice.adjustments).toEqual([])
    expect(twice.aspectRatio).toBe(once.aspectRatio)
  })

  // -------------------------------------------------------------------------
  // The invariant. Runs over the WHOLE catalog so a model added later is
  // covered by default rather than by anyone remembering to extend a list.
  // -------------------------------------------------------------------------
  it("INVARIANT: normalized output always satisfies validateModelInput", () => {
    // Deliberately hostile inputs — a value from some OTHER model's allow-list
    // is exactly what a provider switch or a non-UI author leaves behind.
    const hostile = [
      { aspectRatio: "16:9" },
      { aspectRatio: "auto" },
      { aspectRatio: "1:1", resolution: "4K" },
      { aspectRatio: "21:9", resolution: "2K", quality: "high" },
      { resolution: "0.5 MP" },
      { quality: "basic" },
      { duration: 7 },
      { aspectRatio: "9:21", resolution: "8K", quality: "TURBO", duration: 999 },
    ]

    const failures: string[] = []
    for (const modelId of Object.keys(MODEL_CATALOG)) {
      for (const input of hostile) {
        const out = normalizeModelInput(modelId, input)
        const issue = validateModelInput(modelId, {
          aspectRatio: out.aspectRatio,
          resolution: out.resolution,
          quality: out.quality,
          duration: out.duration,
        })
        if (issue) {
          failures.push(
            `${modelId} ← ${JSON.stringify(input)} → ${JSON.stringify({
              aspectRatio: out.aspectRatio,
              resolution: out.resolution,
              quality: out.quality,
              duration: out.duration,
            })}: ${issue.message}`,
          )
        }
      }
    }

    expect(failures, `normalizeModelInput emitted values validateModelInput rejects:\n${failures.join("\n")}`).toEqual([])
  })

  it("INVARIANT: every adjustment names a real change", () => {
    for (const modelId of Object.keys(MODEL_CATALOG)) {
      const out = normalizeModelInput(modelId, {
        aspectRatio: "21:9",
        resolution: "8K",
        quality: "high",
        duration: 999,
      })
      for (const adj of out.adjustments) {
        expect(adj.from, `${modelId}/${adj.field} reported a no-op adjustment`).not.toEqual(adj.to)
        expect(adj.reason.length).toBeGreaterThan(0)
      }
    }
  })
})
