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
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  editImage,
  imageToImage,
  generateCharacter,
  saveCharacter,
  deleteCharacter,
  getCharacters,
  generateFace,
  saveFace,
  getFaces,
  deleteFace,
  generateObject,
  generateLocation,
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

function sessionWith(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

beforeEach(() => {
  mockGetSession.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// editImage
// ---------------------------------------------------------------------------

describe("editImage", () => {
  it("sends correct URL, method, and body with imageUrl", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await editImage("http://img.png")

    expect(mock).toHaveBeenCalledWith(
      "/v1/edit-image",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ imageUrl: "http://img.png" })
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes prompt and provider when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await editImage("http://img.png", "remove bg", "recraft-remove-bg")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.imageUrl).toBe("http://img.png")
    expect(body.prompt).toBe("remove bg")
    expect(body.provider).toBe("recraft-remove-bg")
  })

  it("includes auth header when session exists", async () => {
    sessionWith("tok-edit")
    const mock = mockFetchJson({ jobId: "j3" })
    vi.stubGlobal("fetch", mock)

    await editImage("http://img.png")

    const headers = mock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe("Bearer tok-edit")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Bad image" } }),
    )

    await expect(editImage("http://img.png")).rejects.toThrow("Bad image")
  })
})

// ---------------------------------------------------------------------------
// imageToImage
// ---------------------------------------------------------------------------

describe("imageToImage", () => {
  it("sends imageUrl and prompt in body", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await imageToImage("http://img.png", "make blue")

    expect(mock).toHaveBeenCalledWith(
      "/v1/image-to-image",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.imageUrl).toBe("http://img.png")
    expect(body.prompt).toBe("make blue")
  })

  it("includes provider and referenceImageUrls when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await imageToImage("http://img.png", "transform", "flux-i2i", undefined, [
      "http://ref.png",
    ])

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.provider).toBe("flux-i2i")
    expect(body.referenceImageUrls).toEqual(["http://ref.png"])
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Transform fail" } }),
    )

    await expect(imageToImage("http://img.png", "x")).rejects.toThrow(
      "Transform fail",
    )
  })
})

// ---------------------------------------------------------------------------
// generateCharacter
// ---------------------------------------------------------------------------

describe("generateCharacter", () => {
  it("sends name in body", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await generateCharacter({ name: "Hero" })

    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-character",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.name).toBe("Hero")
  })

  it("includes all optional fields", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await generateCharacter({
      name: "Villain",
      description: "Dark",
      gender: "male",
      style: "anime",
      baseOutfit: "armor",
      sourceImageUrl: "http://src.png",
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.description).toBe("Dark")
    expect(body.gender).toBe("male")
    expect(body.style).toBe("anime")
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Bad char" } }),
    )

    await expect(generateCharacter({ name: "X" })).rejects.toThrow("Bad char")
  })
})

// ---------------------------------------------------------------------------
// saveCharacter / deleteCharacter / getCharacters
// ---------------------------------------------------------------------------

describe("saveCharacter", () => {
  it("sends character data to POST /v1/characters", async () => {
    noSession()
    const mock = mockFetchJson({ id: "c1" })
    vi.stubGlobal("fetch", mock)

    const result = await saveCharacter({ nodeId: "n1", name: "Hero" })

    expect(mock).toHaveBeenCalledWith(
      "/v1/characters",
      expect.objectContaining({ method: "POST" }),
    )
    expect(result).toEqual({ id: "c1" })
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Save fail" } }),
    )

    await expect(saveCharacter({ nodeId: "n1", name: "X" })).rejects.toThrow(
      "Save fail",
    )
  })
})

describe("deleteCharacter", () => {
  it("sends DELETE with encoded characterId", async () => {
    noSession()
    const mock = mockFetchJson({ success: true })
    vi.stubGlobal("fetch", mock)

    await deleteCharacter("char-123")

    expect(mock).toHaveBeenCalledWith(
      "/v1/characters/char-123",
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(404, { error: { message: "Not found" } }),
    )

    await expect(deleteCharacter("x")).rejects.toThrow("Not found")
  })
})

describe("getCharacters", () => {
  it("sends GET with query params", async () => {
    noSession()
    const mock = mockFetchJson({ characters: [] })
    vi.stubGlobal("fetch", mock)

    await getCharacters("proj-1", "user-1")

    const url = mock.mock.calls[0][0] as string
    expect(url).toContain("/v1/characters")
    expect(url).toContain("projectId=proj-1")
    expect(url).toContain("userId=user-1")
  })

  it("sends no query params when none provided", async () => {
    noSession()
    const mock = mockFetchJson({ characters: [] })
    vi.stubGlobal("fetch", mock)

    await getCharacters()

    expect(mock.mock.calls[0][0]).toBe("/v1/characters")
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Fetch fail" } }),
    )

    await expect(getCharacters()).rejects.toThrow("Fetch fail")
  })
})

// ---------------------------------------------------------------------------
// generateFace / saveFace / getFaces / deleteFace
// ---------------------------------------------------------------------------

describe("generateFace", () => {
  it("sends name in body", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await generateFace({ name: "Alice" })

    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-face",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.name).toBe("Alice")
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Face fail" } }),
    )

    await expect(generateFace({ name: "X" })).rejects.toThrow("Face fail")
  })
})

describe("saveFace", () => {
  it("sends face data to POST /v1/faces", async () => {
    noSession()
    const mock = mockFetchJson({ id: "f1" })
    vi.stubGlobal("fetch", mock)

    const result = await saveFace({ nodeId: "n1", name: "Alice" })

    expect(mock).toHaveBeenCalledWith(
      "/v1/faces",
      expect.objectContaining({ method: "POST" }),
    )
    expect(result).toEqual({ id: "f1" })
  })
})

describe("getFaces", () => {
  it("sends GET with query params when provided", async () => {
    noSession()
    const mock = mockFetchJson({ faces: [] })
    vi.stubGlobal("fetch", mock)

    await getFaces("proj-1", "user-1")

    const url = mock.mock.calls[0][0] as string
    expect(url).toContain("projectId=proj-1")
    expect(url).toContain("userId=user-1")
  })

  it("sends no query params when none provided", async () => {
    noSession()
    const mock = mockFetchJson({ faces: [] })
    vi.stubGlobal("fetch", mock)

    await getFaces()

    expect(mock.mock.calls[0][0]).toBe("/v1/faces")
  })
})

describe("deleteFace", () => {
  it("sends DELETE with encoded faceId", async () => {
    noSession()
    const mock = mockFetchJson({ success: true })
    vi.stubGlobal("fetch", mock)

    await deleteFace("face-42")

    expect(mock).toHaveBeenCalledWith(
      "/v1/faces/face-42",
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Del fail" } }),
    )

    await expect(deleteFace("x")).rejects.toThrow("Del fail")
  })
})

// ---------------------------------------------------------------------------
// generateObject / generateLocation
// ---------------------------------------------------------------------------

describe("generateObject", () => {
  it("sends name and optional fields", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await generateObject({ name: "Sword", category: "weapon", style: "fantasy" })

    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-object",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.name).toBe("Sword")
    expect(body.category).toBe("weapon")
    expect(body.style).toBe("fantasy")
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Obj fail" } }),
    )

    await expect(generateObject({ name: "X" })).rejects.toThrow("Obj fail")
  })
})

describe("generateLocation", () => {
  it("sends name and optional fields", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await generateLocation({ name: "Castle", category: "building" })

    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-location",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.name).toBe("Castle")
    expect(body.category).toBe("building")
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Loc fail" } }),
    )

    await expect(generateLocation({ name: "X" })).rejects.toThrow("Loc fail")
  })
})
