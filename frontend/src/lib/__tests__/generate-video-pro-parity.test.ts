import { describe, it, expect } from "vitest"
import {
  GENERATE_VIDEO_INPUT_HANDLES,
  isValidGenerateVideoConnection,
} from "../generate-video-handles"
import {
  GENERATE_VIDEO_PRO_INPUT_HANDLES,
  isValidGenerateVideoProConnection,
} from "../generate-video-pro-handles"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { GVP_PROVIDERS } from "@/components/editor/config-panels/model-options"
import { isSeedance2Provider, isMinimaxH3Provider, isGvpSupportedProvider, GVP_SUPPORTED_PROVIDERS, GVP_EXTEND_PROVIDERS } from "@nodaro/shared/models"

/**
 * FULL-PARITY GUARD (2026-07-14 directive, after two rounds of missed
 * handles): Generate Video Pro must expose EXACTLY Generate Video's inputs —
 * same ids, same names, same accepts semantics. Its ONLY sanctioned deltas:
 *  1. durations beyond a single model call (the multi-segment stitch);
 *  2. the Seedance-2-family-only provider set;
 *  3. `videoReferences` carries the Extend Source semantic (limit 1 in
 *     handle-limits.ts) — the long-video counterpart of a style video ref;
 *  4. no mention→start-frame promotion (identity refs must ride EVERY
 *     segment, so they always stay references);
 *  5. no repeat-×N strip chip (a multi-segment stitch is orders of magnitude
 *     more expensive per run than a single generation);
 *  6. an `audio` input, a soundtrack over the stitched result (decided
 *     2026-10-28: Generate Video dropped it for a Merge Video & Audio node).
 * ANYTHING else diverging is a bug. Handles are parity-by-construction
 * (generate-video-pro-handles.ts builds its array FROM generate-video's and
 * re-exports its validator) — these assertions pin the construction itself.
 */
describe("generate-video-pro ⇄ generate-video FULL parity", () => {
  it("the pro handles are generate-video's, in order, plus only sanctioned delta #6 (`audio`)", () => {
    expect(GENERATE_VIDEO_PRO_INPUT_HANDLES.filter((h) => h !== "audio")).toEqual([...GENERATE_VIDEO_INPUT_HANDLES])
    expect(GENERATE_VIDEO_PRO_INPUT_HANDLES).toContain("audio")
    expect(GENERATE_VIDEO_INPUT_HANDLES).not.toContain("audio")
  })

  it("the connection validators are the SAME function", () => {
    expect(isValidGenerateVideoProConnection).toBe(isValidGenerateVideoConnection)
  })

  it("both nodes register the same inputs list in NODE_DEFINITIONS (same names, same order, pro adding `audio`)", () => {
    const gv = NODE_DEFINITIONS.find((d) => d.type === "generate-video")!
    const gvp = NODE_DEFINITIONS.find((d) => d.type === "generate-video-pro")!
    expect(gvp.inputs.filter((h) => h !== "audio")).toEqual(gv.inputs)
    expect(gvp.inputs).toEqual([...GENERATE_VIDEO_PRO_INPUT_HANDLES])
    expect(gvp.outputs).toEqual(gv.outputs)
  })

  it("every handle answers identically for a representative producer matrix", () => {
    const isPicker = (t: string) => t === "mood" || t === "person" || t === "setting"
    const producers = [
      "text-prompt", "generate-image", "upload-image", "generate-video", "upload-video",
      "text-to-speech", "generate-music", "character", "object", "location",
      "mood", "camera-motion", "lens", "list",
    ]
    for (const handle of GENERATE_VIDEO_INPUT_HANDLES) {
      for (const producer of producers) {
        expect(isValidGenerateVideoProConnection(handle, producer, isPicker)).toBe(
          isValidGenerateVideoConnection(handle, producer, isPicker),
        )
      }
    }
  })

  it("sanctioned delta #2: the pro provider set is EXACTLY the supported SKUs", () => {
    // GVP_PROVIDERS is VIDEO_GEN_MODELS filtered by the shared predicate, so
    // this pins membership AND order against the shared derivation. It is the
    // guard that catches a SKU the backend advertises but the picker cannot
    // render: kling-3-omni passes every capability check yet was pulled from
    // VIDEO_GEN_MODELS (no working dispatch path), and this assertion is what
    // surfaced it — it is now excluded at the source via
    // VIDEO_PROVIDERS_WITHOUT_DISPATCH, keeping both sides equal.
    expect(GVP_PROVIDERS.map((p) => p.value)).toEqual([...GVP_SUPPORTED_PROVIDERS])
  })

  it("sanctioned delta #2b: transport tiers are derived, not assumed", () => {
    // REPLACES the old "every blessed SKU is Seedance-2 or MiniMax-H3" pin
    // (2026-08-05). That encoded the real invariant *blessed ⇒ rides the shared
    // r2v input resolver*, which stopped holding when the pro node opened to
    // every reference-image i2v model. The invariant splits in two:
    //
    //   blessed         ⇒ takes a start still + reference images (keyframes)
    //   extend-eligible ⇒ ALSO takes an r2v continuation tail  (⊂ blessed)
    //
    // The extend tier is still exactly the shared-input-resolver family, which
    // is what the old assertion was really protecting — so assert it there.
    for (const p of GVP_EXTEND_PROVIDERS) {
      expect(isSeedance2Provider(String(p)) || isMinimaxH3Provider(String(p))).toBe(true)
    }
    for (const p of GVP_PROVIDERS) {
      expect(isGvpSupportedProvider(String(p.value))).toBe(true)
    }
    // And the tiers are genuinely different — a blessed SKU outside the r2v
    // family exists, which is the whole point of the change.
    expect(GVP_EXTEND_PROVIDERS.length).toBeLessThan(GVP_PROVIDERS.length)
  })
})
