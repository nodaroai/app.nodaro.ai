import { describe, it, expect } from "vitest"
import {
  SEEDANCE_2_CONTINUATION_REF_SEC,
  SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC,
  SEEDANCE_2_EXTEND_STITCH,
} from "../model-constants.js"

/** KIE hard-rejects r2v reference videos below the floor: "the parameter
 *  video duration (seconds) specified in the request must be greater than or
 *  equal to 1.8 for model dreamina-seedance-2-0-fast in r2v" (2026-07-13,
 *  job dbf95612 — the original 1.0s tails made every generate-video-pro
 *  continuation segment fail deterministically). Everything this platform
 *  sends as a Seedance-2 video reference cuts SEEDANCE_2_CONTINUATION_REF_SEC
 *  seconds; do NOT "optimize" it back below the floor. The private-plugin
 *  twin constants (nodaro-cloud-plugins chain.ts TAIL_SEC / bridge-math.ts
 *  MIN_REF) are guarded by that repo's r2v-ref-floor.test.ts — keep in sync. */
describe("seedance-2 continuation-reference floor (do not regress)", () => {
  it("the platform's continuation-ref length clears KIE's r2v minimum", () => {
    expect(SEEDANCE_2_CONTINUATION_REF_SEC).toBeGreaterThanOrEqual(SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC)
  })
  it("the extend node's tail IS the shared continuation-ref length (single source)", () => {
    expect(SEEDANCE_2_EXTEND_STITCH.referenceTailSeconds).toBe(SEEDANCE_2_CONTINUATION_REF_SEC)
  })
})
