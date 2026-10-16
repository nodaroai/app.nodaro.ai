import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { Auth, NodePreset, NodePresetGroup, FactoryPresetsResult } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

/** An Auth with no credential at all — a client app showing the catalog to a visitor who is not signed in. */
const NO_TOKEN: Auth = { getToken: async () => null }

function client(fetchMock: ReturnType<typeof vi.fn>, auth: Auth = new StaticTokenAuth("t")) {
  return createClient({ baseUrl: "https://api.example.com", auth, fetch: fetchMock })
}

const PRESET: NodePreset = {
  id: "p1",
  nodeType: "generate-image",
  name: "Cinematic",
  data: { prompt: "x" },
  tags: [],
  sortOrder: 0,
  minReferences: 0,
  needsImage: false,
  previewUrl: null,
  createdAt: "",
  updatedAt: "2026-10-15T10:00:00Z",
}

const GROUP: NodePresetGroup = {
  id: "g1",
  nodeType: "generate-image",
  name: "Folder",
  kind: "folder",
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
}

/** The method, URL and JSON body of the n-th call. */
function call(fetchMock: ReturnType<typeof vi.fn>, n = 0): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string }]
  return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) }
}

describe("presets resource — reads", () => {
  it("list() GETs /v1/node-presets with a nodeType filter and unwraps `data`", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [PRESET] }))
    const out = await client(fetchMock).presets.list("generate-image")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-presets?nodeType=generate-image")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(out).toEqual([PRESET])
  })

  it("list() omits the query string when no nodeType is given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    await client(fetchMock).presets.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-presets")
  })

  it("listGroups() GETs /v1/node-preset-groups and unwraps `data`", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [GROUP] }))
    const out = await client(fetchMock).presets.listGroups("generate-image")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-preset-groups?nodeType=generate-image")
    expect(out[0]!.kind).toBe("folder")
  })

  it("listFactory() GETs /v1/node-presets/factory and returns { data } with the reference and preview fields", async () => {
    const result: FactoryPresetsResult = {
      data: [
        {
          id: "generate-image/character-board",
          name: "Character Board",
          data: {},
          minReferences: 1,
          needsImage: true,
          previewUrl: "https://app.example.com/preset-previews/generate-image/character-board.1a2b3c4d.webp",
        },
        { id: "generate-image/cinematic-portrait", name: "Cinematic Portrait", data: {}, minReferences: 0, needsImage: false, previewUrl: null },
      ],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(result))
    const out = await client(fetchMock).presets.listFactory("generate-image")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-presets/factory?nodeType=generate-image")
    expect(out).toEqual(result)
    expect(out.data.filter((p) => p.needsImage).map((p) => p.id)).toEqual(["generate-image/character-board"])
  })

  it("listFactory() works signed out: the catalog is public, so no Authorization header is sent", async () => {
    const result: FactoryPresetsResult = { data: [] }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(result))
    const out = await client(fetchMock, NO_TOKEN).presets.listFactory("generate-image")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-presets/factory?nodeType=generate-image")
    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBeUndefined()
    expect(out).toEqual(result)
  })

  it("favorites() GETs the favorite ids for a node type", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: ["generate-image/character-board", "p1"] }))
    const out = await client(fetchMock).presets.favorites("generate-image")
    expect(call(fetchMock)).toMatchObject({ method: "GET", url: "https://api.example.com/v1/node-presets/favorites?nodeType=generate-image" })
    expect(out).toEqual(["generate-image/character-board", "p1"])
  })
})

describe("presets resource — writes", () => {
  it("create() POSTs the preset (preview included) and unwraps the new row", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: PRESET }, 201))
    const input = {
      nodeType: "generate-image",
      name: "Cinematic",
      data: { prompt: "x" },
      previewUrl: "https://cdn.example.com/images/j1.png",
    }
    const out = await client(fetchMock).presets.create(input)
    expect(call(fetchMock)).toEqual({ method: "POST", url: "https://api.example.com/v1/node-presets", body: input })
    expect(out).toEqual(PRESET)
  })

  it("update() PATCHes the changes and sends expectedUpdatedAt only when given", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ data: PRESET }))
    const presets = client(fetchMock).presets
    await presets.update("p1", { name: "Renamed", previewUrl: null })
    expect(call(fetchMock, 0)).toEqual({ method: "PATCH", url: "https://api.example.com/v1/node-presets/p1", body: { name: "Renamed", previewUrl: null } })

    await presets.update("p 1", { data: { prompt: "y" } }, { expectedUpdatedAt: PRESET.updatedAt })
    expect(call(fetchMock, 1)).toEqual({
      method: "PATCH",
      url: "https://api.example.com/v1/node-presets/p%201",
      body: { data: { prompt: "y" }, expectedUpdatedAt: PRESET.updatedAt },
    })
  })

  it("delete() DELETEs, with expectedUpdatedAt as a query parameter when given", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ data: { success: true } }))
    const presets = client(fetchMock).presets
    expect(await presets.delete("p1")).toEqual({ success: true })
    expect(call(fetchMock, 0)).toMatchObject({ method: "DELETE", url: "https://api.example.com/v1/node-presets/p1" })
    await presets.delete("p1", { expectedUpdatedAt: "2026-10-15T10:00:00Z" })
    expect(call(fetchMock, 1).url).toBe("https://api.example.com/v1/node-presets/p1?expectedUpdatedAt=2026-10-15T10%3A00%3A00Z")
  })

  it("import() POSTs the presets and returns how many were imported", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { imported: 2 } }))
    const presets = [
      { nodeType: "generate-image", name: "A", data: { prompt: "a" } },
      { nodeType: "generate-image", name: "B", data: { prompt: "b" } },
    ]
    expect(await client(fetchMock).presets.import(presets)).toEqual({ imported: 2 })
    expect(call(fetchMock)).toEqual({ method: "POST", url: "https://api.example.com/v1/node-presets/import", body: { presets } })
  })

  it("reorder() POSTs positions and group moves", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { ok: true } }))
    const input = { groups: [{ id: "g1", sortOrder: 0 }], presets: [{ id: "p1", groupId: null, sortOrder: 3 }] }
    expect(await client(fetchMock).presets.reorder(input)).toEqual({ ok: true })
    expect(call(fetchMock)).toEqual({ method: "POST", url: "https://api.example.com/v1/node-presets/reorder", body: input })
  })

  it("addFavorite() POSTs; removeFavorite() DELETEs with the id url-encoded", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ data: { success: true } }))
    const presets = client(fetchMock).presets
    const favorite = { nodeType: "generate-image", presetId: "generate-image/character-board" }
    expect(await presets.addFavorite(favorite)).toEqual({ success: true })
    expect(call(fetchMock, 0)).toEqual({ method: "POST", url: "https://api.example.com/v1/node-presets/favorites", body: favorite })
    expect(await presets.removeFavorite(favorite)).toEqual({ success: true })
    expect(call(fetchMock, 1)).toMatchObject({
      method: "DELETE",
      url: "https://api.example.com/v1/node-presets/favorites?nodeType=generate-image&presetId=generate-image%2Fcharacter-board",
    })
  })

  it("createGroup() / updateGroup() / deleteGroup() reach /v1/node-preset-groups", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: GROUP }, 201))
      .mockReturnValueOnce(mockOk({ data: { ...GROUP, name: "Renamed" } }))
      .mockReturnValueOnce(mockOk({ data: { success: true } }))
    const presets = client(fetchMock).presets
    expect(await presets.createGroup({ nodeType: "generate-image", name: "Folder", kind: "section" })).toEqual(GROUP)
    expect(call(fetchMock, 0)).toEqual({
      method: "POST",
      url: "https://api.example.com/v1/node-preset-groups",
      body: { nodeType: "generate-image", name: "Folder", kind: "section" },
    })
    expect((await presets.updateGroup("g1", { name: "Renamed" })).name).toBe("Renamed")
    expect(call(fetchMock, 1)).toEqual({ method: "PATCH", url: "https://api.example.com/v1/node-preset-groups/g1", body: { name: "Renamed" } })
    expect(await presets.deleteGroup("g1")).toEqual({ success: true })
    expect(call(fetchMock, 2)).toMatchObject({ method: "DELETE", url: "https://api.example.com/v1/node-preset-groups/g1" })
  })
})
