import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, VIDEO_GEN_PROVIDERS, normalizeVideoRequestParams } from "@nodaro/shared"
import { normalizeVideoInput } from "../normalize.js"
import { snapAspectRatioToken } from "../../../providers/video/aspect-ratio.js"

/**
 * There are TWO video normalizers: `normalizeVideoRequestParams` (routes +
 * orchestrator) and `lib/mcp/normalize.ts`'s `normalizeVideoInput` (the MCP
 * generation verbs). A ratio the routes snap but MCP forwards is still an
 * "Invalid aspect ratio setting" from the provider — and a ratio the two snap
 * DIFFERENTLY is a silently different render depending on which door the
 * request came through (R6). So this asserts the same VALUE from both, not
 * mere membership.
 */
const CANDIDATE_OFF_LIST = ["9:21", "5:4", "4:5", "21:9", "3:2", "1:1"]

describe("every catalogued video provider snaps an off-list aspect ratio identically in both normalizers", () => {
  const withAspects = VIDEO_GEN_PROVIDERS.filter((p) => (MODEL_CATALOG[p]?.aspectRatios?.length ?? 0) > 0)

  it("covers a meaningful number of providers (fails loudly if the filter breaks)", () => {
    expect(withAspects.length).toBeGreaterThan(10)
  })

  for (const provider of withAspects) {
    const allowed = MODEL_CATALOG[provider]!.aspectRatios as readonly string[]
    const offList = CANDIDATE_OFF_LIST.find((r) => !allowed.includes(r))
    if (!offList) continue

    it(`${provider}: both normalizers snap ${offList} to the same supported ratio`, () => {
      const route = normalizeVideoRequestParams(provider, { aspectRatio: offList })
      const mcp = normalizeVideoInput({ model: provider, aspect_ratio: offList }, {}, provider)
      expect(allowed, `${provider} forwarded ${offList} unchanged (route lane)`).toContain(route.aspectRatio)
      expect(allowed, `${provider} forwarded ${offList} unchanged (MCP lane)`).toContain(mcp.aspectRatio)
      expect(mcp.aspectRatio, `${provider}: route says ${route.aspectRatio}, MCP says ${mcp.aspectRatio}`).toBe(route.aspectRatio)
    })
  }
})

/**
 * The THIRD reader of the same math: the provider adapters snap at the last
 * mile through `snapAspectRatioToken` (Task 8's Seedance chokepoint, Task 6's
 * `snapLtxInput`). `normalizeVideoRequestParams` re-implements the log-space
 * comparison because it lives in `packages/shared` and cannot import a backend
 * module — so this pins the two implementations to one answer. Three
 * normalizers, one value; that is the whole point of the ruling.
 *
 * The adapters snap against their OWN concrete list (a passthrough token like
 * "adaptive" is not a ratio), so the comparison drops those the same way.
 */
describe("the shared normalizer agrees with the provider adapters' snapAspectRatioToken", () => {
  const withAspects = VIDEO_GEN_PROVIDERS.filter((p) => (MODEL_CATALOG[p]?.aspectRatios?.length ?? 0) > 0)

  for (const provider of withAspects) {
    const allowed = MODEL_CATALOG[provider]!.aspectRatios as readonly string[]
    const concrete = allowed.filter((a) => a.includes(":"))
    if (concrete.length === 0) continue

    it(`${provider}: every off-list candidate snaps to the adapter's answer`, () => {
      for (const offList of CANDIDATE_OFF_LIST) {
        if (allowed.includes(offList)) continue
        const shared = normalizeVideoRequestParams(provider, { aspectRatio: offList }).aspectRatio
        const adapter = snapAspectRatioToken(offList, concrete)
        expect(shared, `${provider} ${offList}: shared says ${shared}, adapter says ${adapter}`).toBe(adapter)
      }
    })
  }
})
