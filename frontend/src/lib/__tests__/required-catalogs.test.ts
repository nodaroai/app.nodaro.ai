import { afterEach, describe, expect, it, vi } from "vitest"
import { getPerson } from "@nodaro/prompts/person"
import { getPickerCatalog, PICKER_CATALOGS } from "@nodaro/prompts/picker-catalogs"
import { bootstrapCatalogs, __resetCatalogBootstrapForTests } from "../catalog-bootstrap"
import { curatedNodeDefaults } from "../curated-node-defaults"
import { NODE_DEFINITIONS } from "@/types/nodes"

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  __resetCatalogBootstrapForTests()
  vi.unstubAllGlobals()
})

function requireCuration() {
  window.__NODARO_RUNTIME__ = { surface: { catalogs: { required: true, factoryPresets: false } } }
}

describe("required deployment catalogs", () => {
  it("withholds stock choices before the request resolves and after failure", async () => {
    requireCuration()
    let fail!: (reason: Error) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise((_resolve, reject) => { fail = reject })))
    const done = bootstrapCatalogs()
    expect(fetch).toHaveBeenCalledWith("/v1/catalogs?detail=full", expect.objectContaining({ cache: "no-store" }))
    expect(getPerson("woman")).toBeUndefined()
    expect(getPickerCatalog("setting")?.options).toHaveLength(0)
    expect(getPickerCatalog("character-motion")?.dimensions?.every((d) => d.options.length === 0)).toBe(true)
    fail(new Error("offline"))
    await done
    expect(getPerson("stylish-influencer")).toBeUndefined()
    expect(getPickerCatalog("setting")?.options).toHaveLength(0)
  })

  it.each([{ curated: false }, { curated: true, data: [PICKER_CATALOGS[0]] }])(
    "keeps choices withheld for an incomplete response: %j", async (payload) => {
      requireCuration()
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })))
      await bootstrapCatalogs()
      expect(getPerson("woman")).toBeUndefined()
      expect(getPickerCatalog("setting")?.options).toHaveLength(0)
    },
  )

  it("uses the offered male default and removes the bundled female voice", async () => {
    requireCuration()
    const data = PICKER_CATALOGS.map((c) => c.catalogId === "person" ? {
      ...c, dimensions: c.dimensions?.map((d) => ({ ...d, options: d.options.filter((o) => o.id !== "stylish-influencer" && o.id !== "woman") })),
    } : c)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ curated: true, data }) })))
    await bootstrapCatalogs()
    const person = NODE_DEFINITIONS.find((d) => d.type === "person")!.defaultData
    expect(curatedNodeDefaults("person", person).type).toBe("man")
    const speech = NODE_DEFINITIONS.find((d) => d.type === "text-to-speech")!.defaultData
    expect(curatedNodeDefaults("text-to-speech", speech)).toMatchObject({ voiceId: "" })
    expect(curatedNodeDefaults("text-to-speech", speech).voiceDisplayName).toBeUndefined()
    const nested = { direction: { type: "woman" }, subject: { type: "stylish-influencer" }, prompt: "unchanged" }
    expect(curatedNodeDefaults("generate-image", nested)).toEqual({ direction: {}, subject: {}, prompt: "unchanged" })
    expect(nested.subject.type).toBe("stylish-influencer")
  })

  it("leaves stock defaults unchanged on an unrestricted deployment", () => {
    const data = { type: "stylish-influencer" }
    expect(curatedNodeDefaults("person", data)).toBe(data)
  })
})
