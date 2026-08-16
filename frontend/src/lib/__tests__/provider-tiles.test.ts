import { describe, it, expect } from "vitest"
import { PROVIDER_META, providerTiles } from "@/lib/provider-tiles"

// The Install-health grid used to render a hand-copied list of six providers
// while the counter derived from the backend's `keys` — nodaro.ai lived
// outside both as a banner boolean. The tiles now come from the backend's
// `keys` in its order, so a provider the backend reports can never be missing
// from the grid, and nodaro.ai is one of them.
describe("providerTiles", () => {
  const keys = { nodaro: true, kie: false, replicate: false, anthropic: false, gemini: false, elevenlabs: false, fal: false }

  it("renders one tile per backend key, in backend order, nodaro.ai first", () => {
    const tiles = providerTiles(keys, "oauth")
    expect(tiles.map((t) => t.id)).toEqual(["nodaro", "kie", "replicate", "anthropic", "gemini", "elevenlabs", "fal"])
    expect(tiles[0]).toMatchObject({ id: "nodaro", name: "nodaro.ai", present: true })
  })

  it("says how nodaro.ai is authenticated", () => {
    expect(providerTiles(keys, "oauth")[0].state).toBe("connected")
    expect(providerTiles(keys, "env")[0].state).toBe("key set")
    expect(providerTiles({ ...keys, nodaro: false }, null)[0].state).toBe("missing")
  })

  it("names the two ways to light the nodaro.ai tile", () => {
    const meta = PROVIDER_META.nodaro
    expect(meta.env).toMatch(/NODARO_API_KEY/)
    expect(meta.env).toMatch(/Connect/i)
  })

  it("keeps plain set/missing for API-key providers", () => {
    const tiles = providerTiles({ ...keys, kie: true }, null)
    expect(tiles.find((t) => t.id === "kie")).toMatchObject({ name: "KIE.ai", env: "KIE_API_KEY", present: true, state: "set" })
    expect(tiles.find((t) => t.id === "fal")).toMatchObject({ present: false, state: "missing" })
  })

  it("still shows a provider the frontend has no label for (visible, not silent)", () => {
    const tiles = providerTiles({ ...keys, brandnew: true }, null)
    const tile = tiles.find((t) => t.id === "brandnew")!
    expect(tile.name).toBe("brandnew")
    expect(tile.env).toBe("BRANDNEW")
    expect(tile.present).toBe(true)
  })
})
