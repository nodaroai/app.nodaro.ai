import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { NodePreset, FactoryPresetsResult } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

describe("presets resource", () => {
  it("list() GETs /v1/node-presets with a nodeType filter and unwraps `data`", async () => {
    const preset: NodePreset = {
      id: "p1",
      nodeType: "generate-image",
      name: "Cinematic",
      data: { prompt: "x" },
      tags: [],
      sortOrder: 0,
      createdAt: "",
      updatedAt: "",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [preset] }))
    const out = await client(fetchMock).presets.list("generate-image")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-presets?nodeType=generate-image")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(out).toEqual([preset])
  })

  it("list() omits the query string when no nodeType is given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    await client(fetchMock).presets.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-presets")
  })

  it("listGroups() GETs /v1/node-preset-groups and unwraps `data`", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ data: [{ id: "g1", nodeType: "generate-image", name: "Folder", kind: "folder", sortOrder: 0, createdAt: "", updatedAt: "" }] }),
    )
    const out = await client(fetchMock).presets.listGroups("generate-image")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-preset-groups?nodeType=generate-image")
    expect(out[0]!.kind).toBe("folder")
  })

  it("listFactory() GETs /v1/node-presets/factory and returns { data }", async () => {
    const result: FactoryPresetsResult = {
      data: [{ id: "generate-image/cinematic-portrait", name: "Cinematic Portrait", data: {} }],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(result))
    const out = await client(fetchMock).presets.listFactory("generate-image")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/node-presets/factory?nodeType=generate-image")
    expect(out).toEqual(result)
    expect(out.data[0]!.id).toBe("generate-image/cinematic-portrait")
  })
})
