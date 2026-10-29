import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, importMediaUrl: vi.fn(), discardMedia: vi.fn() }
})

import * as api from "@/lib/api"
import { fileNameForType, useLinkImport } from "../use-link-import"

const importMediaUrl = vi.mocked(api.importMediaUrl)

interface Deferred {
  resolve: (v: api.ImportedMedia) => void
  reject: (e: unknown) => void
}
const discardMedia = vi.mocked(api.discardMedia)

const IMPORTED: api.ImportedMedia = {
  url: "https://r2.example.test/uploads/images/abc.png",
  thumbnailUrl: null,
  assetId: "a",
  mimeType: "image/png",
  sizeBytes: 3,
  filename: "abc.png",
  width: 1,
  height: 1,
}

beforeEach(() => {
  importMediaUrl.mockReset()
  discardMedia.mockReset()
  discardMedia.mockResolvedValue(undefined)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["x"], { type: "image/png" }) }))
})

describe("fileNameForType", () => {
  it.each([
    ["photo.heic", "image/jpeg", "photo.jpg"],
    ["AbC123", "image/jpeg", "AbC123.jpg"],
    ["photo.jpeg", "image/jpeg", "photo.jpeg"],
    ["PHOTO.JPG", "image/jpeg", "PHOTO.JPG"],
    ["shot.png", "image/png", "shot.png"],
    ["shot.jpg", "image/png", "shot.png"],
    ["anim", "image/gif", "anim.gif"],
    ["pic.avif", "image/avif", "pic.avif"],
    ["pic.webp", "image/avif", "pic.avif"],
    ["my.photo", "image/webp", "my.photo.webp"],
    [".jpg", "image/png", "image.png"],
    ["scan.tiff", "image/jpeg", "scan.jpg"],
    ["odd.bin", "application/octet-stream", "odd.bin"],
  ])("%s as %s is named %s", (name, type, expected) => {
    expect(fileNameForType(name, type)).toBe(expected)
  })
})

describe("useLinkImport", () => {
  it("imports once while a link is already on its way", async () => {
    let resolveImport: (v: api.ImportedMedia) => void = () => {}
    importMediaUrl.mockReturnValue(new Promise((r) => { resolveImport = r }))
    const openEditor = vi.fn()
    const { result } = renderHook(() => useLinkImport())

    let first: Promise<string> = Promise.resolve("")
    let second: Promise<string> = Promise.resolve("")
    act(() => {
      first = result.current.importLink("https://example.test/a.png", openEditor)
      second = result.current.importLink("https://example.test/a.png", openEditor)
    })
    expect(result.current.isImporting).toBe(true)
    await act(async () => {
      resolveImport(IMPORTED)
      await expect(Promise.all([first, second])).resolves.toEqual(["opened", "ignored"])
    })

    expect(importMediaUrl).toHaveBeenCalledTimes(1)
    expect(openEditor).toHaveBeenCalledTimes(1)
    expect(result.current.isImporting).toBe(false)
  })

  it("discards the copy, awaited, before the editor opens on the File", async () => {
    let finishDiscard: () => void = () => {}
    discardMedia.mockReturnValue(new Promise<void>((r) => { finishDiscard = r }))
    importMediaUrl.mockResolvedValue(IMPORTED)
    const openEditor = vi.fn()
    const { result } = renderHook(() => useLinkImport())

    let pending: Promise<string> = Promise.resolve("")
    act(() => { pending = result.current.importLink("https://example.test/a.png", openEditor) })
    await vi.waitFor(() => expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url))
    expect(openEditor).not.toHaveBeenCalled()

    await act(async () => { finishDiscard(); await pending })
    expect(openEditor).toHaveBeenCalledTimes(1)
    const [file] = openEditor.mock.calls[0]![0] as File[]
    expect([file!.name, file!.type]).toEqual(["abc.png", "image/png"])
    expect(discardMedia).toHaveBeenCalledTimes(1)
  })

  it("names the File by its type: a HEIC link stored as JPEG, a link with no extension", async () => {
    const openEditor = vi.fn()
    const { result } = renderHook(() => useLinkImport())
    importMediaUrl.mockResolvedValueOnce({ ...IMPORTED, filename: "IMG_0042.HEIC", mimeType: "image/jpeg" })
    await act(async () => { await result.current.importLink("https://example.test/IMG_0042.HEIC", openEditor) })
    importMediaUrl.mockResolvedValueOnce({ ...IMPORTED, filename: "AbC123", mimeType: "image/jpeg" })
    await act(async () => { await result.current.importLink("https://cdn.example.test/AbC123", openEditor) })

    const names = openEditor.mock.calls.map((c) => (c[0] as File[]).map((f) => [f.name, f.type])[0])
    expect(names).toEqual([["IMG_0042.jpg", "image/jpeg"], ["AbC123.jpg", "image/jpeg"]])
  })

  it.each([
    ["a refusal", (settle: Deferred) => settle.reject(new Error("media import refused: 422 fetch_failed"))],
    ["a copy that cannot be read back", (settle: Deferred) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
      settle.resolve(IMPORTED)
    }],
  ])("answers ignored, not failed, for %s after the component went away", async (_label, fail) => {
    const settle = {} as Deferred
    importMediaUrl.mockReturnValue(new Promise((resolve, reject) => { settle.resolve = resolve; settle.reject = reject }))
    const { result, unmount } = renderHook(() => useLinkImport())
    let pending: Promise<string> = Promise.resolve("")
    act(() => { pending = result.current.importLink("https://example.test/a.png", vi.fn()) })
    unmount()
    fail(settle)
    await expect(pending).resolves.toBe("ignored")
  })

  it("answers failed for any refusal, opening and discarding nothing", async () => {
    importMediaUrl.mockRejectedValue(new Error("media import refused: 413 storage_limit_exceeded"))
    const openEditor = vi.fn()
    const { result } = renderHook(() => useLinkImport())
    let outcome = ""
    await act(async () => { outcome = await result.current.importLink("https://example.test/a.png", openEditor) })
    expect(outcome).toBe("failed")
    expect(openEditor).not.toHaveBeenCalled()
    expect(discardMedia).not.toHaveBeenCalled()
  })

  it("answers failed, discarding the copy, when it cannot be read back", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    const openEditor = vi.fn()
    const { result } = renderHook(() => useLinkImport())
    let outcome = ""
    await act(async () => { outcome = await result.current.importLink("https://example.test/a.png", openEditor) })
    expect(outcome).toBe("failed")
    expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url)
    expect(openEditor).not.toHaveBeenCalled()
  })

  it("opens nothing for a copy read back after the component went away, still discarding it", async () => {
    let resolveImport: (v: api.ImportedMedia) => void = () => {}
    importMediaUrl.mockReturnValue(new Promise((r) => { resolveImport = r }))
    const openEditor = vi.fn()
    const { result, unmount } = renderHook(() => useLinkImport())

    let pending: Promise<string> = Promise.resolve("")
    act(() => { pending = result.current.importLink("https://example.test/a.png", openEditor) })
    unmount()
    resolveImport(IMPORTED)

    await expect(pending).resolves.toBe("ignored")
    expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url)
    expect(openEditor).not.toHaveBeenCalled()
  })
})
