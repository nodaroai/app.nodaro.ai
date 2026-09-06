import { describe, expect, it } from "vitest"

import type { LlmStructuredInput } from "@nodaro/sdk"
import type { LlmStructuredBody } from "@nodaro/studio-production"

/**
 * The two type pins that hold `@nodaro/studio-production` to contracts it is
 * not allowed to import.
 *
 * `@nodaro/studio-production` builds the body of `POST /v1/llm/structured` (a
 * Director run is one), but it cannot import the SDK's `LlmStructuredInput`:
 * the SDK CONSUMES the package, and the reverse edge would invert the
 * dependency direction and drag a browser client into the backend's import
 * graph. So the package declares its own structurally identical
 * `LlmStructuredBody` — and a copy with nothing holding it to the original is
 * a copy that drifts.
 *
 * The backend is the only module in the monorepo that imports BOTH, which is
 * why the pin lives here rather than in either package. It is checked by
 * `tsc --noEmit`, the gate CI runs on every PR — the assertions below are
 * deliberately type-level, with one runtime line so the file is a real test
 * rather than a lint-suppressed orphan.
 */
type Assignable<A, B> = A extends B ? true : false

const bodyIsAnSdkInput: Assignable<LlmStructuredBody, LlmStructuredInput> = true
const sdkInputIsABody: Assignable<LlmStructuredInput, LlmStructuredBody> = true

describe("@nodaro/studio-production's LLM body ≡ the SDK's", () => {
  it("is assignable in BOTH directions", () => {
    // Both directions, deliberately: one direction alone would let the wire
    // grow a field the package never learns about, or the package invent one
    // the route would reject.
    expect([bodyIsAnSdkInput, sdkInputIsABody]).toEqual([true, true])
  })
})
