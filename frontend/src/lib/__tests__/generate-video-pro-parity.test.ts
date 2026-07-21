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
import { isSeedance2Provider, GVP_SUPPORTED_PROVIDERS } from "@nodaro/shared"

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
 *     more expensive per run than a single generation).
 * ANYTHING else diverging is a bug. Handles are parity-by-construction
 * (generate-video-pro-handles.ts re-exports generate-video's array and
 * validator) — these assertions pin the construction itself.
 */
describe("generate-video-pro ⇄ generate-video FULL parity", () => {
  it("the handle arrays are the SAME array (parity by construction, not by copy)", () => {
    expect(GENERATE_VIDEO_PRO_INPUT_HANDLES).toBe(GENERATE_VIDEO_INPUT_HANDLES)
  })

  it("the connection validators are the SAME function", () => {
    expect(isValidGenerateVideoProConnection).toBe(isValidGenerateVideoConnection)
  })

  it("both nodes register the identical inputs list in NODE_DEFINITIONS (same names, same order)", () => {
    const gv = NODE_DEFINITIONS.find((d) => d.type === "generate-video")!
    const gvp = NODE_DEFINITIONS.find((d) => d.type === "generate-video-pro")!
    expect(gvp.inputs).toEqual(gv.inputs)
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
    // Pinned to the shared support list (2026-07-21 directive: only Seedance 2
    // and Seedance 2 Fast are offered; mini stays in the capability family but
    // out of pro selection). GVP_PROVIDERS derives from this list, so the two
    // can only diverge if the catalog is missing a blessed SKU entirely.
    expect(GVP_PROVIDERS.map((p) => p.value)).toEqual([...GVP_SUPPORTED_PROVIDERS])
    for (const p of GVP_PROVIDERS) {
      expect(isSeedance2Provider(String(p.value))).toBe(true)
    }
  })
})
