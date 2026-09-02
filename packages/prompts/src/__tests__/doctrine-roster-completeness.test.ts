import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared"
import { getPromptDoctrine } from "../provider-prompt-doctrine.js"

/**
 * The badge's truthfulness guarantee (Cine build-brief §7 — never overclaim):
 * every video GENERATION model is either doctrine-covered or DELIBERATELY
 * generic. A new video model that is neither fails this test — forcing the
 * author to write a sourced doctrine or consciously add it to the generic
 * set with a reason.
 */

/** Models deliberately left WITHOUT a doctrine, with the reason. */
const DELIBERATELY_GENERIC: ReadonlyMap<string, string> = new Map([
  // Older ByteDance engine (pre-Seedance-2 surface: single image, no refs/audio
  // levers) — mapping the Seedance family doctrine would overclaim.
  ["bytedance-lite", "older engine, different surface"],
  ["bytedance-pro", "older engine, different surface"],
  ["bytedance-pro-fast", "older engine, different surface"],
  // Hailuo pre-H3 tiers: single-image i2v without the multimodal reference
  // surface the H3 doctrine teaches.
  ["hailuo-2.3", "pre-H3 tier without the multimodal surface"],
  ["hailuo-2.3-pro", "pre-H3 tier without the multimodal surface"],
  ["hailuo-standard", "pre-H3 tier without the multimodal surface"],
  // Legacy/simple tiers with no vendor guidance beyond the platform default.
  ["minimax", "legacy 5s tier, no vendor guide"],
  ["seedance", "legacy Seedance 1.x, superseded"],
  ["ltx-2.3-fast", "no vendor prompt guide published"],
  ["ltx-2.3-pro", "no vendor prompt guide published"],
  ["sora2", "roster utility — no first-party guide via KIE"],
  ["sora2-pro", "roster utility — no first-party guide via KIE"],
])

/** Utility modes that are driven by inputs, not prose prompting — doctrine
 *  coverage isn't meaningful for them (spec excludes them from the roster). */
const UTILITY_ONLY_MODES = new Set(["extend", "motion-transfer", "lip-sync", "video-upscale", "v2v", "video-analysis", "video-audit"])

describe("doctrine roster completeness", () => {
  const videoGenerationIds = Object.values(MODEL_CATALOG)
    .filter((m) => m.kind === "video")
    .filter((m) => m.modes?.some((mode) => (mode === "t2v" || mode === "i2v") && !UTILITY_ONLY_MODES.has(mode)))
    .map((m) => m.id)

  it("covers every video generation model — or lists it as deliberately generic", () => {
    const uncovered = videoGenerationIds.filter(
      (id) => getPromptDoctrine(id) === undefined && !DELIBERATELY_GENERIC.has(id),
    )
    expect(
      uncovered,
      `New video model(s) with neither a doctrine nor a deliberate-generic entry: ${uncovered.join(", ")}. ` +
        "Write a sourced doctrine or add to DELIBERATELY_GENERIC with a reason.",
    ).toEqual([])
  })

  it("the deliberate-generic set stays honest (no entry that is actually covered)", () => {
    for (const id of DELIBERATELY_GENERIC.keys()) {
      expect(getPromptDoctrine(id), `${id} is covered — remove it from DELIBERATELY_GENERIC`).toBeUndefined()
    }
  })
})
