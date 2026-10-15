import { describe, it, expect, vi, expectTypeOf } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  paletteDirectionId,
  moodboardDirectionId,
  PALETTE_DIRECTION_PREFIX,
  MOODBOARD_DIRECTION_PREFIX,
} from "../../index.js"
import type { ColorPalette, Moodboard, GenerateImageParams, RunNodeResult } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

function call(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
}

const PID = "0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const MID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
const PALETTE: ColorPalette = {
  id: PID, name: "Harbour", colors: ["#0F4C5C", "#E3B23C"], description: null,
  createdAt: "2026-10-15T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z",
}
const BOARD: Moodboard = {
  id: MID, name: "Nordic calm", description: "Moody Nordic interiors",
  images: [{ url: "https://cdn.test/a.png", caption: "linen" }],
  createdAt: "2026-10-15T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z",
}

describe("palettes resource", () => {
  it("lists (paged), reads, creates, changes and deletes palettes", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: [PALETTE], nextCursor: "c1" }))
      .mockReturnValueOnce(mockOk(PALETTE))
      .mockReturnValueOnce(mockOk(PALETTE, 201))
      .mockReturnValueOnce(mockOk({ ...PALETTE, name: "Dusk" }))
      .mockReturnValueOnce(mockOk({ success: true }))
    const sdk = client(fetchMock)

    const page = await sdk.palettes.list({ limit: 10, cursor: "c0" })
    expect(page).toEqual({ data: [PALETTE], nextCursor: "c1" })
    expect((await sdk.palettes.get(PID)).name).toBe("Harbour")
    await sdk.palettes.create({ name: "Harbour", colors: ["#0F4C5C", "#E3B23C"] })
    expect((await sdk.palettes.update(PID, { name: "Dusk", description: null })).name).toBe("Dusk")
    await expect(sdk.palettes.delete(PID)).resolves.toBeUndefined()

    expect(call(fetchMock, 0)).toMatchObject({ url: "https://api.example.com/v1/palettes?limit=10&cursor=c0", method: "GET" })
    expect(call(fetchMock, 1)).toMatchObject({ url: `https://api.example.com/v1/palettes/${PID}`, method: "GET" })
    expect(call(fetchMock, 2)).toMatchObject({ url: "https://api.example.com/v1/palettes", method: "POST", body: { name: "Harbour", colors: ["#0F4C5C", "#E3B23C"] } })
    expect(call(fetchMock, 3)).toMatchObject({ method: "PATCH", body: { name: "Dusk", description: null } })
    expect(call(fetchMock, 4)).toMatchObject({ url: `https://api.example.com/v1/palettes/${PID}`, method: "DELETE" })
  })

  it("list() sends no query when given none", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], nextCursor: null }))
    await client(fetchMock).palettes.list()
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/palettes")
  })
})

describe("moodboards resource", () => {
  it("lists, reads, creates, changes and deletes moodboards", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: [BOARD], nextCursor: null }))
      .mockReturnValueOnce(mockOk(BOARD))
      .mockReturnValueOnce(mockOk(BOARD, 201))
      .mockReturnValueOnce(mockOk(BOARD))
      .mockReturnValueOnce(mockOk({ success: true }))
    const sdk = client(fetchMock)

    expect((await sdk.moodboards.list()).data).toEqual([BOARD])
    expect((await sdk.moodboards.get(MID)).images).toHaveLength(1)
    await sdk.moodboards.create({ name: "Nordic calm", description: "Moody", images: [{ url: "https://cdn.test/a.png", caption: "linen" }] })
    await sdk.moodboards.update(MID, { images: [{ url: "https://cdn.test/b.png" }] })
    await expect(sdk.moodboards.delete(MID)).resolves.toBeUndefined()

    expect(call(fetchMock, 0)).toMatchObject({ url: "https://api.example.com/v1/moodboards", method: "GET" })
    expect(call(fetchMock, 1)).toMatchObject({ url: `https://api.example.com/v1/moodboards/${MID}`, method: "GET" })
    expect(call(fetchMock, 2)).toMatchObject({ method: "POST", body: { name: "Nordic calm", description: "Moody", images: [{ url: "https://cdn.test/a.png", caption: "linen" }] } })
    expect(call(fetchMock, 3)).toMatchObject({ url: `https://api.example.com/v1/moodboards/${MID}`, method: "PATCH", body: { images: [{ url: "https://cdn.test/b.png" }] } })
    expect(call(fetchMock, 4)).toMatchObject({ method: "DELETE" })
  })
})

describe("using one as a generate-image direction", () => {
  it("builds the direction ids the route resolves", () => {
    expect(PALETTE_DIRECTION_PREFIX).toBe("palette:")
    expect(MOODBOARD_DIRECTION_PREFIX).toBe("moodboard:")
    expect(paletteDirectionId(PID)).toBe(`palette:${PID}`)
    expect(moodboardDirectionId(MID)).toBe(`moodboard:${MID}`)
  })

  it("sends them on direction.colorLook / direction.style, and types the warnings on the answer", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({
      jobId: "job-1",
      warnings: [{ code: "moodboard_images_not_sent", message: "2 of the 10 images…" }],
    }))
    const params: GenerateImageParams = {
      prompt: "a cabin",
      direction: { colorLook: paletteDirectionId(PID), style: moodboardDirectionId(MID) },
    }
    const out = await client(fetchMock).nodes.run("generate-image", params)
    expect(call(fetchMock).body.direction).toEqual({ colorLook: `palette:${PID}`, style: `moodboard:${MID}` })
    expectTypeOf(out).toEqualTypeOf<RunNodeResult>()
    expect((out as { warnings?: Array<{ code: string }> }).warnings?.[0].code).toBe("moodboard_images_not_sent")
  })
})
