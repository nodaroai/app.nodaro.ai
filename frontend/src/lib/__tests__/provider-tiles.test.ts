import { describe, it, expect } from "vitest"
import { PROVIDER_META, providerTiles, cloudCoverageSummary, groupProviderTiles, type ProviderMeta, type ProviderTileInput } from "@/lib/provider-tiles"

// The Install-health grid renders the backend's provider list — keys +
// sources + meta from /v1/setup/status. The backend owns WHICH providers
// exist and what each covers; this module turns that into tile states and
// the coverage banner. Older backends (keys only) still render.
const keys = { nodaro: false, kie: false, replicate: false, anthropic: false, gemini: false, elevenlabs: false, fal: false, heygen: false, beeble: false, apify: false }
const meta = {
  nodaro: { name: "nodaro.ai", env: "NODARO_API_KEY", whereToGet: "app.nodaro.ai", powers: "every model", cloudCovered: false },
  kie: { name: "KIE.ai", env: "KIE_API_KEY", whereToGet: "kie.ai", powers: "media", cloudCovered: true },
  replicate: { name: "Replicate", env: "REPLICATE_API_TOKEN", whereToGet: "replicate.com", powers: "flux", cloudCovered: true },
  anthropic: { name: "Anthropic", env: "ANTHROPIC_API_KEY", whereToGet: "console.anthropic.com", powers: "llm", cloudCovered: true },
  gemini: { name: "Google Gemini", env: "GEMINI_API_KEY", whereToGet: "aistudio.google.com", powers: "llm", cloudCovered: true },
  elevenlabs: { name: "ElevenLabs", env: "ELEVENLABS_API_KEY", whereToGet: "elevenlabs.io", powers: "speech", cloudCovered: true },
  fal: { name: "fal.ai", env: "FAL_KEY", whereToGet: "fal.ai", powers: "fal", cloudCovered: true },
  heygen: { name: "HeyGen", env: "HEYGEN_API_KEY", whereToGet: "heygen.com", powers: "AI Avatar", cloudCovered: false },
  beeble: { name: "Beeble", env: "BEEBLE_API_KEY", whereToGet: "beeble.ai", powers: "Relight & Switch node (SwitchX)", cloudCovered: false },
  apify: { name: "Apify", env: "APIFY_API_TOKEN", whereToGet: "apify.com", powers: "Web Scrape node", cloudCovered: false },
}
const none = Object.fromEntries(Object.keys(keys).map((k) => [k, null])) as Record<string, null>

function input(over: Partial<ProviderTileInput> = {}): ProviderTileInput {
  return { keys, sources: none, meta, ...over }
}

describe("providerTiles", () => {
  it("renders one tile per backend key, in backend order, with the backend's labels", () => {
    const tiles = providerTiles(input())
    expect(tiles.map((t) => t.id)).toEqual(Object.keys(keys))
    expect(tiles.find((t) => t.id === "heygen")).toMatchObject({ name: "HeyGen", env: "HEYGEN_API_KEY", powers: "AI Avatar", cloudCovered: false, state: "missing" })
  })

  it("derives the state from the source: env / app / oauth / missing", () => {
    const tiles = providerTiles(
      input({
        keys: { ...keys, kie: true, fal: true, nodaro: true },
        sources: { ...none, kie: "env", fal: "app", nodaro: "oauth" },
      }),
    )
    expect(tiles.find((t) => t.id === "kie")?.state).toBe("set (env)")
    expect(tiles.find((t) => t.id === "fal")?.state).toBe("set (app)")
    expect(tiles.find((t) => t.id === "nodaro")?.state).toBe("connected")
    expect(tiles.find((t) => t.id === "gemini")?.state).toBe("missing")
  })

  it("nodaro.ai via an env or app key reads 'key set', not 'connected'", () => {
    expect(providerTiles(input({ keys: { ...keys, nodaro: true }, sources: { ...none, nodaro: "env" } }))[0].state).toBe("key set (env)")
    expect(providerTiles(input({ keys: { ...keys, nodaro: true }, sources: { ...none, nodaro: "app" } }))[0].state).toBe("key set (app)")
  })

  it("only an env-managed key is read-only in the UI (env wins)", () => {
    const tiles = providerTiles(input({ keys: { ...keys, kie: true, fal: true }, sources: { ...none, kie: "env", fal: "app" } }))
    expect(tiles.find((t) => t.id === "kie")?.editable).toBe(false)
    expect(tiles.find((t) => t.id === "fal")?.editable).toBe(true)
    expect(tiles.find((t) => t.id === "gemini")?.editable).toBe(true)
  })

  it("falls back to the local label map for an older backend that sends keys only", () => {
    const tiles = providerTiles({ keys: { kie: true, brandnew: false }, sources: undefined, meta: undefined })
    expect(tiles[0]).toMatchObject({ id: "kie", name: PROVIDER_META.kie.name, env: "KIE_API_KEY", state: "set" })
    // Unknown id: visible, not silent.
    expect(tiles[1]).toMatchObject({ id: "brandnew", name: "brandnew", env: "BRANDNEW", state: "missing" })
  })
})

describe("cloudCoverageSummary — what connecting nodaro.ai actually clears", () => {
  it("counts the missing tiles the connection covers, and names the ones it does not", () => {
    const summary = cloudCoverageSummary(providerTiles(input()))
    // 10 tiles missing; the connection covers 6 (not itself, not HeyGen / Beeble / Apify).
    expect(summary.coveredMissing).toBe(6)
    expect(summary.uncoveredMissing.map((t) => t.id)).toEqual(["heygen", "beeble", "apify"])
  })

  it("stops counting a tile once its key is set", () => {
    const summary = cloudCoverageSummary(providerTiles(input({ keys: { ...keys, kie: true }, sources: { ...none, kie: "env" } })))
    expect(summary.coveredMissing).toBe(5)
  })
})

describe("groupProviderTiles — core keys vs. keys that exist for specific nodes", () => {
  it("groups by the backend's scope, and falls back to the local map when the backend sends none", () => {
    // Backend meta with scope: the three node-specific keys sit apart.
    const scoped = Object.fromEntries(
      Object.entries(meta).map(([id, m]) => [id, { ...m, scope: ["heygen", "beeble", "apify"].includes(id) ? "node" : "core" }]),
    ) as Record<string, ProviderMeta>
    const groups = groupProviderTiles(providerTiles(input({ meta: scoped })))
    expect(groups.core.map((t) => t.id)).toEqual(["nodaro", "kie", "replicate", "anthropic", "gemini", "elevenlabs", "fal"])
    expect(groups.nodeSpecific.map((t) => t.id)).toEqual(["heygen", "beeble", "apify"])
    // Older backend (meta without scope): the local map decides.
    const fallback = groupProviderTiles(providerTiles(input()))
    expect(fallback.nodeSpecific.map((t) => t.id)).toEqual(["heygen", "beeble", "apify"])
    // An id nobody knows is core (visible in the main grid, never hidden).
    const unknown = groupProviderTiles(providerTiles({ keys: { brandnew: false } }))
    expect(unknown.core.map((t) => t.id)).toEqual(["brandnew"])
    expect(unknown.nodeSpecific).toEqual([])
  })
})
