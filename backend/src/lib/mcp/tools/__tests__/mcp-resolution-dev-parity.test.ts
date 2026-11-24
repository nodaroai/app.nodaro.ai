// @test-watches backend/src/lib/mcp/tools/__tests__/fixtures/mcp-resolution-dev.json
/**
 * No size an MCP image call accepted before resolves to a different size or
 * price. The fixture is origin/dev's path, recorded from its source: MCP's
 * normaliser over each image model's sizes, then what the route prices. Here
 * the same path runs on this branch, the one forward (`mcpImageResolutionSent`:
 * 8K asked of a K-size model goes to the route as "8K") included.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { normalizeResolution } from "../../normalize.js"
import { mcpImageResolutionSent } from "../_image-resolution-sent.js"

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "mcp-resolution-dev.json"), "utf8")) as { values: string[]; table: Record<string, string> }

describe("MCP image sizes resolve and price as before", () => {
  it("every image model x every value: the same priced size and price id as dev", () => {
    const differ: string[] = []
    const forwarded: string[] = []
    let compared = 0
    for (const [key, dev] of Object.entries(fixture.table)) {
      const [id, v] = key.split("|") as [string, string]
      const m = MODEL_CATALOG[id]
      if (!m) continue
      compared++
      const edit = !m.modes.includes("t2i")
      const fitted = normalizeResolution(v, m.resolutions)
      const sent = mcpImageResolutionSent(v, id, fitted)
      const priced = resolveNormalizedImageGen({ provider: id, resolution: sent, refCount: edit ? 1 : 0, swapToI2i: !edit })
      const [devSent, devPriced, devId] = dev.split(" ; ")
      if (`${priced.resolution ?? "-"} ${priced.identifier}` !== `${devPriced} ${devId}`) differ.push(`${key}: ${devPriced} ${devId} -> ${priced.resolution ?? "-"} ${priced.identifier}`)
      if ((sent ?? "-") !== devSent) forwarded.push(key)
    }
    expect(compared).toBeGreaterThan(1500)
    expect(differ).toEqual([])
    // The only value sent differently is 8K, forwarded for the route to fit (and say so).
    expect(forwarded.every((k) => /\|8k$/i.test(k)), forwarded.join(", ")).toBe(true)
  })

  it("8K on a model whose sizes are not K sizes is sent as the normaliser fitted it (Flux 2: nothing, priced as before)", () => {
    expect(mcpImageResolutionSent("8K", "flux-2-pro", undefined)).toBeUndefined()
    expect(mcpImageResolutionSent("8K", "minimax-h3-image", "4K")).toBe("8K")
    expect(mcpImageResolutionSent("8K", "kling-image-4", "8K")).toBe("8K")
    expect(mcpImageResolutionSent("4K", "minimax-h3-image", "4K")).toBe("4K")
  })
})
