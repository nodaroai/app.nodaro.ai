import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

const rights = vi.hoisted(() => ({ confirm: vi.fn(), declaration: vi.fn() }))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, importMediaUrl: vi.fn(), discardMedia: vi.fn() }
})

// The platform's side of a confirmation: the real box store and declaration
// module run above it, so a changed declaration really unticks every box.
vi.mock("@/lib/nodaro-client", () => ({
  nodaroClient: { contentRights: { confirm: rights.confirm, declaration: rights.declaration } },
}))

import * as api from "@/lib/api"
import { __resetContentRightsForTests } from "@/lib/content-rights"
import { clearNodeLinkRights, isNodeLinkRightsTicked, tickNodeLinkRights } from "@/lib/node-link-rights"
import { fileNameForType, useLinkImport } from "../use-link-import"

const importMediaUrl = vi.mocked(api.importMediaUrl)

interface Deferred {
  resolve: (v: api.ImportedMedia) => void
  reject: (e: unknown) => void
}
const discardMedia = vi.mocked(api.discardMedia)

const NODE = "img-1"
const LINK = "https://example.test/a.png"

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
  __resetContentRightsForTests()
  importMediaUrl.mockReset()
  discardMedia.mockReset()
  discardMedia.mockResolvedValue(undefined)
  rights.declaration.mockReset()
  rights.declaration.mockResolvedValue({ version: 1, text: "The declaration." })
  rights.confirm.mockReset()
  rights.confirm.mockResolvedValue({ id: "conf-1", expiresAt: "2026-11-05T12:00:00Z" })
  tickNodeLinkRights(NODE, LINK)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["x"], { type: "image/png" }) }))
})
afterEach(() => clearNodeLinkRights())

async function importOnce(link = LINK, openEditor = vi.fn()): Promise<string> {
  const { result } = renderHook(() => useLinkImport(NODE))
  let outcome = ""
  await act(async () => {
    outcome = await result.current.importLink(link, openEditor)
  })
  return outcome
}

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
    const { result } = renderHook(() => useLinkImport(NODE))

    let first: Promise<string> = Promise.resolve("")
    let second: Promise<string> = Promise.resolve("")
    act(() => {
      first = result.current.importLink(LINK, openEditor)
      second = result.current.importLink(LINK, openEditor)
    })
    expect(result.current.isImporting).toBe(true)
    await vi.waitFor(() => expect(importMediaUrl).toHaveBeenCalled())
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
    const { result } = renderHook(() => useLinkImport(NODE))

    let pending: Promise<string> = Promise.resolve("")
    act(() => { pending = result.current.importLink(LINK, openEditor) })
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
    const { result } = renderHook(() => useLinkImport(NODE))
    tickNodeLinkRights(NODE, "https://example.test/IMG_0042.HEIC")
    importMediaUrl.mockResolvedValueOnce({ ...IMPORTED, filename: "IMG_0042.HEIC", mimeType: "image/jpeg" })
    await act(async () => { await result.current.importLink("https://example.test/IMG_0042.HEIC", openEditor) })
    tickNodeLinkRights(NODE, "https://cdn.example.test/AbC123")
    importMediaUrl.mockResolvedValueOnce({ ...IMPORTED, filename: "AbC123", mimeType: "image/jpeg" })
    await act(async () => { await result.current.importLink("https://cdn.example.test/AbC123", openEditor) })

    const names = openEditor.mock.calls.map((c) => (c[0] as File[]).map((f) => [f.name, f.type])[0])
    expect(names).toEqual([["IMG_0042.jpg", "image/jpeg"], ["AbC123.jpg", "image/jpeg"]])
  })

  it.each([
    ["a refusal", (settle: Deferred) => settle.reject(new api.MediaImportError(422, "fetch_failed"))],
    ["a copy that cannot be read back", (settle: Deferred) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
      settle.resolve(IMPORTED)
    }],
  ])("answers ignored, not failed, for %s after the component went away", async (_label, fail) => {
    const settle = {} as Deferred
    importMediaUrl.mockReturnValue(new Promise((resolve, reject) => { settle.resolve = resolve; settle.reject = reject }))
    const { result, unmount } = renderHook(() => useLinkImport(NODE))
    let pending: Promise<string> = Promise.resolve("")
    act(() => { pending = result.current.importLink(LINK, vi.fn()) })
    await vi.waitFor(() => expect(importMediaUrl).toHaveBeenCalled())
    unmount()
    fail(settle)
    await expect(pending).resolves.toBe("ignored")
  })

  it.each([
    ["a full storage", new api.MediaImportError(413, "storage_limit_exceeded")],
    ["an unreachable link", new api.MediaImportError(422, "fetch_failed")],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("answers failed for %s (the link is kept as it is), opening and discarding nothing", async (_label, error) => {
    importMediaUrl.mockRejectedValue(error)
    const openEditor = vi.fn()
    expect(await importOnce(LINK, openEditor)).toBe("failed")
    expect(openEditor).not.toHaveBeenCalled()
    expect(discardMedia).not.toHaveBeenCalled()
  })

  it("answers failed, discarding the copy, when it cannot be read back", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    const openEditor = vi.fn()
    expect(await importOnce(LINK, openEditor)).toBe("failed")
    expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url)
    expect(openEditor).not.toHaveBeenCalled()
  })

  it.each([
    ["the site's policy", "import_source_disabled"],
    ["the account's measures", "imports_blocked"],
    ["a confirmation it did not accept", "rights_confirmation_used"],
  ])("answers refused when the platform refuses the import (%s): the link is not kept", async (_label, code) => {
    importMediaUrl.mockRejectedValue(new api.MediaImportError(403, code))
    expect(await importOnce()).toBe("refused")
  })
})

describe("useLinkImport — an import of someone's link waits for its content rights box", () => {
  it("confirms the link right before importing it, and imports under that confirmation", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    expect(await importOnce()).toBe("opened")
    expect(rights.confirm).toHaveBeenCalledWith({ url: LINK, declarationVersion: 1 })
    expect(importMediaUrl).toHaveBeenCalledWith(LINK, { confirmationId: "conf-1" })
    expect(rights.confirm.mock.invocationCallOrder[0]!).toBeLessThan(importMediaUrl.mock.invocationCallOrder[0]!)
  })

  it("a tick is one import's: once the import was tried, the box is unticked", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    await importOnce()
    expect(isNodeLinkRightsTicked(NODE, LINK)).toBe(false)
    importMediaUrl.mockRejectedValue(new api.MediaImportError(422, "fetch_failed"))
    tickNodeLinkRights(NODE, LINK)
    await importOnce()
    expect(isNodeLinkRightsTicked(NODE, LINK)).toBe(false)
  })

  it.each([
    ["not ticked", () => clearNodeLinkRights()],
    ["ticked for another link", () => tickNodeLinkRights(NODE, "https://example.test/other.png")],
    ["ticked on another node", () => { clearNodeLinkRights(); tickNodeLinkRights("img-2", LINK) }],
  ])("a box %s fetches nothing and answers unconfirmed", async (_label, arrange) => {
    arrange()
    const { result } = renderHook(() => useLinkImport(NODE))
    let outcome = ""
    await act(async () => { outcome = await result.current.importLink(LINK, vi.fn()) })

    expect(outcome).toBe("unconfirmed")
    expect(rights.confirm).not.toHaveBeenCalled()
    expect(importMediaUrl).not.toHaveBeenCalled()
    expect(result.current.isImporting).toBe(false)
  })

  it("a declaration changed before the confirmation fetches nothing, unticks every box, and answers unconfirmed (never failed)", async () => {
    tickNodeLinkRights("img-2", "https://example.test/b.png")
    rights.confirm.mockRejectedValueOnce({ code: "rights_confirmation_stale" })
    const openEditor = vi.fn()
    expect(await importOnce(LINK, openEditor)).toBe("unconfirmed")
    expect(importMediaUrl).not.toHaveBeenCalled()
    expect(openEditor).not.toHaveBeenCalled()
    expect(isNodeLinkRightsTicked(NODE, LINK)).toBe(false)
    expect(isNodeLinkRightsTicked("img-2", "https://example.test/b.png")).toBe(false)
  })

  it("a declaration changed between the confirmation and the import unticks every box and answers unconfirmed", async () => {
    tickNodeLinkRights("img-2", "https://example.test/b.png")
    importMediaUrl.mockRejectedValue(new api.MediaImportError(403, "rights_confirmation_stale"))
    expect(await importOnce()).toBe("unconfirmed")
    expect(isNodeLinkRightsTicked("img-2", "https://example.test/b.png")).toBe(false)
    // The declaration is read again, for the box to show the current text.
    await vi.waitFor(() => expect(rights.declaration).toHaveBeenCalledTimes(2))
  })

  it("a confirmation refused for another reason answers failed, fetching nothing", async () => {
    rights.confirm.mockRejectedValueOnce(new Error("refused"))
    expect(await importOnce()).toBe("failed")
    expect(importMediaUrl).not.toHaveBeenCalled()
  })
})
