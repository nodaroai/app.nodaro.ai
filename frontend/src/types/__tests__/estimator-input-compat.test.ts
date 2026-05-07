import { describe, it, expectTypeOf } from "vitest"
import type {
  LoopVideoEstimatorInput,
  TrimVideoEstimatorInput,
  CombineVideosEstimatorInput,
} from "@nodaro/shared"
import type {
  LoopVideoData,
  TrimVideoData,
  CombineVideosData,
} from "@/types/nodes"

/** Compile-time only: if frontend types drift such that they no longer
 *  satisfy the estimator's expected input shape, the build fails here.
 *  No runtime assertions — vitest's expectTypeOf is type-level. */
describe("estimator input compat", () => {
  it("LoopVideoData satisfies LoopVideoEstimatorInput", () => {
    expectTypeOf<LoopVideoData>().toMatchTypeOf<LoopVideoEstimatorInput>()
  })
  it("TrimVideoData satisfies TrimVideoEstimatorInput", () => {
    expectTypeOf<TrimVideoData>().toMatchTypeOf<TrimVideoEstimatorInput>()
  })
  it("CombineVideosData satisfies CombineVideosEstimatorInput", () => {
    expectTypeOf<CombineVideosData>().toMatchTypeOf<CombineVideosEstimatorInput>()
  })
})
