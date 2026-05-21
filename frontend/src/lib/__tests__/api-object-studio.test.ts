import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  generateObject,
  generateObjectAsset,
  generateObjectMotion,
  saveObject,
  approveObjectMainImage,
  recaptionObject,
  restoreObject,
  deleteObject,
  permanentDeleteObject,
  getObjects,
  listArchivedObjects,
  ConcurrentModificationError,
} from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function mockFetchError(status: number, errBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(errBody),
    text: () => Promise.resolve(JSON.stringify(errBody)),
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

beforeEach(() => {
  mockGetSession.mockReset()
  noSession()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// generateObject — Phase A extensions
// ---------------------------------------------------------------------------

describe("generateObject (Phase E1)", () => {
  it("forwards count + attach + seed-prompt + expectedUpdatedAt fields", async () => {
    const mock = mockFetchJson({ jobIds: ["j1", "j2"] })
    vi.stubGlobal("fetch", mock)

    await generateObject({
      name: "Sword",
      count: 2,
      attachToObjectId: "o1",
      attachName: "candidate-A",
      seedPromptHint: "wrought iron",
      expectedUpdatedAt: "2026-05-21T10:00:00Z",
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.count).toBe(2)
    expect(body.attachToObjectId).toBe("o1")
    expect(body.attachName).toBe("candidate-A")
    expect(body.seedPromptHint).toBe("wrought iron")
    expect(body.expectedUpdatedAt).toBe("2026-05-21T10:00:00Z")
  })

  it("returns { jobIds } when backend sends multi-candidate result", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobIds: ["j1", "j2", "j3", "j4"] }))
    const result = await generateObject({ name: "X", count: 4 })
    expect("jobIds" in result && result.jobIds).toEqual(["j1", "j2", "j3", "j4"])
  })
})

// ---------------------------------------------------------------------------
// generateObjectAsset — Phase A extensions
// ---------------------------------------------------------------------------

describe("generateObjectAsset (Phase E1)", () => {
  it("forwards attachToObjectId + attachToColumn + attachName + seedPromptHint", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await generateObjectAsset({
      assetType: "angles",
      variant: "front",
      name: "front-angle",
      sourceImageUrl: "https://r2/main.png",
      attachToObjectId: "o1",
      attachToColumn: "angles",
      attachName: "front-angle",
      seedPromptHint: "studio lighting",
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.attachToObjectId).toBe("o1")
    expect(body.attachToColumn).toBe("angles")
    expect(body.attachName).toBe("front-angle")
    expect(body.seedPromptHint).toBe("studio lighting")
  })
})

// ---------------------------------------------------------------------------
// generateObjectMotion (new)
// ---------------------------------------------------------------------------

describe("generateObjectMotion", () => {
  it("POSTs /v1/generate-object-motion with body and returns { jobId }", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await generateObjectMotion({
      motionPrompt: "spin slowly",
      sourceImageUrl: "https://r2/main.png",
      name: "spin",
      provider: "kling-turbo",
      attachToObjectId: "o1",
      aspectRatio: "1:1",
    })

    expect(result).toEqual({ jobId: "j1" })
    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-object-motion",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.motionPrompt).toBe("spin slowly")
    expect(body.sourceImageUrl).toBe("https://r2/main.png")
    expect(body.provider).toBe("kling-turbo")
    expect(body.attachToObjectId).toBe("o1")
    expect(body.aspectRatio).toBe("1:1")
  })

  it("throws on error", async () => {
    vi.stubGlobal("fetch", mockFetchError(400, { error: { message: "Bad motion" } }))
    await expect(
      generateObjectMotion({
        motionPrompt: "x",
        sourceImageUrl: "https://r2/m.png",
        name: "x",
      }),
    ).rejects.toThrow(/Bad motion/)
  })
})

// ---------------------------------------------------------------------------
// saveObject (Phase A extensions)
// ---------------------------------------------------------------------------

describe("saveObject (Phase E1)", () => {
  it("forwards new Phase-A fields as a dumb pass-through (Pass 13 F-100)", async () => {
    const mock = mockFetchJson({ id: "o1", updatedAt: "2026-05-21T10:00:00Z" })
    vi.stubGlobal("fetch", mock)

    await saveObject({
      nodeId: "node-1",
      name: "Sword",
      motionClips: [{ name: "spin", url: "https://r2/spin.mp4" }],
      referencePhotos: [{ kind: "front", url: "https://r2/ref.png" }],
      canonicalDescription: "Bronze blade",
      styleLock: false,
      expectedUpdatedAt: "2026-05-21T09:00:00Z",
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.motionClips).toEqual([{ name: "spin", url: "https://r2/spin.mp4" }])
    expect(body.referencePhotos).toEqual([{ kind: "front", url: "https://r2/ref.png" }])
    expect(body.canonicalDescription).toBe("Bronze blade")
    expect(body.styleLock).toBe(false)
    expect(body.expectedUpdatedAt).toBe("2026-05-21T09:00:00Z")
  })

  it("returns { id, updatedAt } so studio can stash the next concurrency token", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ id: "o1", updatedAt: "2026-05-21T10:00:00Z" }),
    )
    const result = await saveObject({ nodeId: "n1", name: "X" })
    expect(result).toEqual({ id: "o1", updatedAt: "2026-05-21T10:00:00Z" })
  })

  it("throws ConcurrentModificationError on 409", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, {
        error: {
          code: "concurrent_modification",
          message: "Object was modified concurrently",
          updatedAt: "2026-05-21T11:00:00Z",
        },
      }),
    )
    await expect(
      saveObject({ nodeId: "n1", name: "X", expectedUpdatedAt: "2026-05-21T10:00:00Z" }),
    ).rejects.toBeInstanceOf(ConcurrentModificationError)
  })
})

// ---------------------------------------------------------------------------
// approveObjectMainImage
// ---------------------------------------------------------------------------

describe("approveObjectMainImage", () => {
  it("POSTs /v1/objects/:id/approve-main-image with candidateJobId + expectedUpdatedAt", async () => {
    const mock = mockFetchJson({
      sourceImageUrl: "https://r2/main.png",
      canonicalDescription: "A bronze compass...",
    })
    vi.stubGlobal("fetch", mock)

    const result = await approveObjectMainImage("o1", "job-1", "2026-05-21T09:00:00Z")

    expect(result).toEqual({
      sourceImageUrl: "https://r2/main.png",
      canonicalDescription: "A bronze compass...",
    })
    expect(mock).toHaveBeenCalledWith(
      "/v1/objects/o1/approve-main-image",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.candidateJobId).toBe("job-1")
    expect(body.expectedUpdatedAt).toBe("2026-05-21T09:00:00Z")
  })

  it("omits expectedUpdatedAt from body when not passed", async () => {
    const mock = mockFetchJson({ sourceImageUrl: "x", canonicalDescription: "y" })
    vi.stubGlobal("fetch", mock)

    await approveObjectMainImage("o1", "job-1")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.candidateJobId).toBe("job-1")
    expect("expectedUpdatedAt" in body).toBe(false)
  })

  it("throws ConcurrentModificationError on 409", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(409, {
        error: {
          code: "concurrent_modification",
          message: "Object was modified concurrently",
          updatedAt: "2026-05-21T11:00:00Z",
        },
      }),
    )
    await expect(
      approveObjectMainImage("o1", "job-1", "2026-05-21T10:00:00Z"),
    ).rejects.toBeInstanceOf(ConcurrentModificationError)
  })
})

// ---------------------------------------------------------------------------
// recaptionObject
// ---------------------------------------------------------------------------

describe("recaptionObject", () => {
  it("POSTs /v1/objects/:id/llm-caption (no body) and returns { canonicalDescription }", async () => {
    const mock = mockFetchJson({ canonicalDescription: "A worn brass compass..." })
    vi.stubGlobal("fetch", mock)

    const result = await recaptionObject("o1")

    expect(result).toEqual({ canonicalDescription: "A worn brass compass..." })
    expect(mock).toHaveBeenCalledWith(
      "/v1/objects/o1/llm-caption",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("throws on 502 caption_failed so the caller can surface a retry", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(502, {
        error: { code: "caption_failed", message: "Failed to caption object image" },
      }),
    )
    await expect(recaptionObject("o1")).rejects.toThrow(/Failed to caption object image/)
  })
})

// ---------------------------------------------------------------------------
// restoreObject
// ---------------------------------------------------------------------------

describe("restoreObject", () => {
  it("POSTs /v1/objects/:id/restore and returns { id, name }", async () => {
    const mock = mockFetchJson({ id: "o1", name: "Compass (restored)" })
    vi.stubGlobal("fetch", mock)

    const result = await restoreObject("o1")

    expect(result).toEqual({ id: "o1", name: "Compass (restored)" })
    expect(mock).toHaveBeenCalledWith(
      "/v1/objects/o1/restore",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("throws on 404 not_found", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { code: "not_found", message: "Not found" } }),
    )
    await expect(restoreObject("o1")).rejects.toThrow(/Not found/)
  })
})

// ---------------------------------------------------------------------------
// deleteObject (extended with permanent option)
// ---------------------------------------------------------------------------

describe("deleteObject (Phase E1)", () => {
  it("soft-deletes by default (no ?permanent query)", async () => {
    const mock = mockFetchJson({ success: true, archived: true })
    vi.stubGlobal("fetch", mock)

    const result = await deleteObject("o1")

    expect(result).toEqual({ success: true, archived: true })
    expect(mock).toHaveBeenCalledWith(
      "/v1/objects/o1",
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("hard-deletes when opts.permanent=true (?permanent=true query)", async () => {
    const mock = mockFetchJson({ success: true, permanent: true })
    vi.stubGlobal("fetch", mock)

    const result = await deleteObject("o1", { permanent: true })

    expect(result).toEqual({ success: true, permanent: true })
    expect(mock).toHaveBeenCalledWith(
      "/v1/objects/o1?permanent=true",
      expect.objectContaining({ method: "DELETE" }),
    )
  })
})

// ---------------------------------------------------------------------------
// permanentDeleteObject (wrapper around deleteObject)
// ---------------------------------------------------------------------------

describe("permanentDeleteObject", () => {
  it("delegates to deleteObject with permanent:true", async () => {
    const mock = mockFetchJson({ success: true, permanent: true })
    vi.stubGlobal("fetch", mock)

    const result = await permanentDeleteObject("o1")

    expect(result).toEqual({ success: true, permanent: true })
    expect(mock.mock.calls[0][0]).toBe("/v1/objects/o1?permanent=true")
  })
})

// ---------------------------------------------------------------------------
// getObjects (extended with archived option) + listArchivedObjects
// ---------------------------------------------------------------------------

describe("getObjects (Phase E1)", () => {
  it("omits archived query by default", async () => {
    const mock = mockFetchJson({ objects: [] })
    vi.stubGlobal("fetch", mock)

    await getObjects("p1", "u1")

    const url = mock.mock.calls[0][0] as string
    expect(url).toContain("projectId=p1")
    expect(url).toContain("userId=u1")
    expect(url).not.toContain("archived")
  })

  it("appends archived=true when opts.archived=true", async () => {
    const mock = mockFetchJson({ objects: [] })
    vi.stubGlobal("fetch", mock)

    await getObjects("p1", undefined, { archived: true })

    const url = mock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
  })
})

describe("listArchivedObjects", () => {
  it("delegates to getObjects with archived:true", async () => {
    const mock = mockFetchJson({ objects: [] })
    vi.stubGlobal("fetch", mock)

    await listArchivedObjects("p1", "u1")

    const url = mock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
    expect(url).toContain("projectId=p1")
    expect(url).toContain("userId=u1")
  })
})
