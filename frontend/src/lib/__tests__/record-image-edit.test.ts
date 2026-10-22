import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))

import { imageEditSource, recordImageEdit } from "@/lib/record-image-edit"

const JOB = "11111111-2222-4333-8444-555555555555"
const ASSET = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const EDITED = "99999999-8888-4777-8666-555555555555"

describe("imageEditSource", () => {
  it("links the job of the result showing the edited image", () => {
    const data = { generatedResults: [{ url: "https://x/a.png", jobId: JOB, timestamp: "" }] }
    expect(imageEditSource(data, "https://x/a.png")).toEqual({ sourceJobId: JOB, sourceImageUrl: "https://x/a.png" })
  })

  it("ignores local result ids", () => {
    const data = { generatedResults: [{ url: "https://x/a.png", jobId: "image-edit-1700000000000", timestamp: "" }] }
    expect(imageEditSource(data, "https://x/a.png")).toEqual({})
  })

  it("links an Upload Image node's upload when it shows that url", () => {
    const data = { url: "https://x/u.png", assetId: ASSET, generatedResults: [{ url: "https://x/u.png", jobId: "upload-1", timestamp: "" }] }
    expect(imageEditSource(data, "https://x/u.png")).toEqual({ sourceAssetId: ASSET })
    expect(imageEditSource(data, "https://x/other.png")).toEqual({})
  })
})

describe("recordImageEdit", () => {
  const fetchMock = vi.fn()
  beforeEach(() => vi.stubGlobal("fetch", fetchMock))
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  const ok = (id: string) => new Response(JSON.stringify({ data: { id } }), { status: 201 })
  const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1].body as string)

  it("records the edit with its source and design state", async () => {
    fetchMock.mockResolvedValueOnce(ok(EDITED))
    const id = await recordImageEdit({ assetId: ASSET, source: { sourceJobId: JOB }, editStateUrl: "https://r2/projects/s.json" })
    expect(id).toBe(EDITED)
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/jobs/from-upload")
    expect(bodyOf(0)).toEqual({ assetId: ASSET, sourceJobId: JOB, editStateUrl: "https://r2/projects/s.json" })
  })

  it("drops a refused source and records the edit on its own", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 })).mockResolvedValueOnce(ok(EDITED))
    expect(await recordImageEdit({ assetId: ASSET, source: { sourceJobId: JOB } })).toBe(EDITED)
    expect(bodyOf(1)).toEqual({ assetId: ASSET })
  })

  it("answers null without an asset, on a failure and on a network error", async () => {
    expect(await recordImageEdit({ assetId: null, source: {} })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }))
    expect(await recordImageEdit({ assetId: ASSET, source: {} })).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    expect(await recordImageEdit({ assetId: ASSET, source: {} })).toBeNull()
  })
})
