/**
 * The presentation's picture input card imports a pasted link and opens it in
 * the "Adjust image" editor, as a picked file; a link it cannot import, and a
 * video card's link, are used as they are.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const h = vi.hoisted(() => ({
  openEditor: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  editorOptions: null as null | { onComplete: (results: unknown[]) => void; onCancel?: () => void },
}))

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>()
  const stubClient = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  }
  return { ...actual, createClient: (() => stubClient) as unknown as typeof actual.createClient }
})

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, importMediaUrl: vi.fn(), discardMedia: vi.fn() }
})

vi.mock("@/components/editor/media-editor", () => ({
  useMediaEditor: (options: NonNullable<typeof h.editorOptions>) => {
    h.editorOptions = options
    return { openEditor: h.openEditor }
  },
  MediaEditorModal: () => null,
}))

vi.mock("sonner", () => ({ toast: { error: h.toastError, warning: h.toastWarning, success: vi.fn() } }))

import * as api from "@/lib/api"
import { ImageUploadCard } from "../image-upload-card"
import { VideoUploadCard } from "../video-upload-card"

const importMediaUrl = vi.mocked(api.importMediaUrl)
const discardMedia = vi.mocked(api.discardMedia)

const IMPORTED: api.ImportedMedia = {
  url: "https://r2.example.test/uploads/images/abc.jpg",
  thumbnailUrl: null,
  assetId: "asset-imported",
  mimeType: "image/jpeg",
  sizeBytes: 3,
  filename: "abc.jpg",
  width: 1,
  height: 1,
}

const base = { label: "Visual", nodeId: "n1", isFullscreen: true, inputValues: {} }

function pasteLink(link: string) {
  fireEvent.click(screen.getByText("or paste URL"))
  fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: link } })
  fireEvent.click(screen.getByText("Set"))
}

beforeEach(() => {
  h.openEditor.mockReset()
  h.toastError.mockReset()
  h.toastWarning.mockReset()
  h.editorOptions = null
  importMediaUrl.mockReset()
  discardMedia.mockReset()
  discardMedia.mockResolvedValue(undefined)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["jpg"], { type: "image/jpeg" }) }))
})

describe("ImageUploadCard — a pasted link", () => {
  it("is imported and opened in the editor, not stored as it is", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    pasteLink("https://example.test/a.jpg")

    await waitFor(() => expect(h.openEditor).toHaveBeenCalledTimes(1))
    expect(importMediaUrl).toHaveBeenCalledWith("https://example.test/a.jpg")
    const files = h.openEditor.mock.calls[0]![0] as File[]
    expect(files.map((f) => [f.name, f.type])).toEqual([["abc.jpg", "image/jpeg"]])
    expect(onUpdateInput).not.toHaveBeenCalled()
    // The copy is discarded once read back, before the editor opens.
    expect(discardMedia).toHaveBeenCalledTimes(1)
    expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url)
    expect(discardMedia.mock.invocationCallOrder[0]!).toBeLessThan(h.openEditor.mock.invocationCallOrder[0]!)

    h.editorOptions!.onCancel?.()
    expect(discardMedia).toHaveBeenCalledTimes(1)
  })

  it("takes the editor's upload, discarding nothing more", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    pasteLink("https://example.test/a.jpg")
    await waitFor(() => expect(h.openEditor).toHaveBeenCalled())

    h.editorOptions!.onComplete([{ uploadResult: { url: "https://r2.example.test/uploads/images/up.jpg" } }])
    expect(onUpdateInput).toHaveBeenCalledWith("n1", "url", "https://r2.example.test/uploads/images/up.jpg")
    expect(discardMedia).toHaveBeenCalledTimes(1)
  })

  it.each([
    "media import refused: 400 validation_error",
    "media import refused: 422 fetch_failed",
    "media import refused: 413 file_too_large",
    "media import refused: 413 storage_limit_exceeded",
    "Failed to fetch",
  ])(
    "keeps a link it could not import (%s) as it is, with one notice",
    async (failure) => {
      importMediaUrl.mockRejectedValue(new Error(failure))
      const onUpdateInput = vi.fn()
      render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
      pasteLink("https://example.test/a.svg")

      await waitFor(() => expect(onUpdateInput).toHaveBeenCalledWith("n1", "url", "https://example.test/a.svg"))
      expect(h.toastWarning).toHaveBeenCalledTimes(1)
      expect(h.toastWarning).toHaveBeenCalledWith("Added the link as it is. It couldn't be opened for adjusting.")
      expect(h.openEditor).not.toHaveBeenCalled()
      expect(h.toastError).not.toHaveBeenCalled()
    },
  )

  it("keeps the link as it is when the copy cannot be read back, discarding the copy", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob() }))
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    pasteLink("https://example.test/a.jpg")

    await waitFor(() => expect(onUpdateInput).toHaveBeenCalledWith("n1", "url", "https://example.test/a.jpg"))
    expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url)
    expect(h.openEditor).not.toHaveBeenCalled()
  })
})

describe("VideoUploadCard — a pasted link", () => {
  it("is still used as it is", () => {
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><VideoUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    pasteLink("https://example.test/clip.mp4")

    expect(onUpdateInput).toHaveBeenCalledWith("n1", "url", "https://example.test/clip.mp4")
    expect(importMediaUrl).not.toHaveBeenCalled()
    expect(h.openEditor).not.toHaveBeenCalled()
  })
})
