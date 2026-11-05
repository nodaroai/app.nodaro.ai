/**
 * The presentation's picture input card imports a pasted link and opens it in
 * the "Adjust image" editor, as a picked file. An import of someone's link, so
 * Set waits for the content rights box under the link, ticked for that link on
 * this card, and the import confirms the declaration for itself. A link it
 * cannot import, and a video card's link, are used as they are.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, renderHook, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const h = vi.hoisted(() => ({
  openEditor: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  editorOptions: null as null | { onComplete: (results: unknown[]) => void; onCancel?: () => void },
}))
const rights = vi.hoisted(() => ({ confirm: vi.fn(), declaration: vi.fn() }))

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

// The platform's side of a confirmation: the real box store and declaration
// module run above it, so a changed declaration really unticks the box.
vi.mock("@/lib/nodaro-client", () => ({
  nodaroClient: { contentRights: { confirm: rights.confirm, declaration: rights.declaration } },
}))

vi.mock("@/components/content-rights/rights-declaration-box", () => ({
  RightsDeclarationBox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input type="checkbox" aria-label="rights" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

vi.mock("@/components/editor/media-editor", () => ({
  useMediaEditor: (options: NonNullable<typeof h.editorOptions>) => {
    h.editorOptions = options
    return { openEditor: h.openEditor }
  },
  MediaEditorModal: () => null,
}))

vi.mock("sonner", () => ({ toast: { error: h.toastError, warning: h.toastWarning, success: vi.fn() } }))

import * as api from "@/lib/api"
import { __resetContentRightsForTests } from "@/lib/content-rights"
import { clearNodeLinkRights, isNodeLinkRightsTicked } from "@/lib/node-link-rights"
import { ImageUploadCard } from "../image-upload-card"
import { useMediaUpload } from "../shared"
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

const setButton = () => screen.getByText("Set").closest("button") as HTMLButtonElement
const rightsBox = () => screen.queryByRole("checkbox", { name: "rights" }) as HTMLInputElement | null
const urlBox = () => screen.getByPlaceholderText("https://...") as HTMLInputElement

function typeLink(link: string) {
  fireEvent.click(screen.getByText("or paste URL"))
  fireEvent.change(urlBox(), { target: { value: link } })
}

/** Type the link, tick its box when the card shows one, and press Set. */
function pasteLink(link: string) {
  typeLink(link)
  const box = rightsBox()
  if (box) fireEvent.click(box)
  fireEvent.click(setButton())
}

beforeEach(() => {
  __resetContentRightsForTests()
  h.openEditor.mockReset()
  h.toastError.mockReset()
  h.toastWarning.mockReset()
  rights.declaration.mockReset()
  rights.declaration.mockResolvedValue({ version: 1, text: "The declaration." })
  rights.confirm.mockReset()
  rights.confirm.mockResolvedValue({ id: "conf-1", expiresAt: "2026-11-05T12:00:00Z" })
  h.editorOptions = null
  importMediaUrl.mockReset()
  discardMedia.mockReset()
  discardMedia.mockResolvedValue(undefined)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["jpg"], { type: "image/jpeg" }) }))
})
afterEach(() => clearNodeLinkRights())

describe("ImageUploadCard — a pasted link", () => {
  it("is imported under a confirmation for it and opened in the editor, not stored as it is", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    pasteLink("https://example.test/a.jpg")

    await waitFor(() => expect(h.openEditor).toHaveBeenCalledTimes(1))
    expect(rights.confirm).toHaveBeenCalledWith({ url: "https://example.test/a.jpg", declarationVersion: 1 })
    expect(importMediaUrl).toHaveBeenCalledWith("https://example.test/a.jpg", { confirmationId: "conf-1" })
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

describe("ImageUploadCard — Set waits for the content rights box", () => {
  it("shows the box, unticked, under a typed link, with Set disabled until it is ticked for that link on this card", () => {
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={vi.fn()} /></MemoryRouter>)
    typeLink("https://example.test/a.jpg")
    expect(rightsBox()?.checked).toBe(false)
    expect(setButton().disabled).toBe(true)

    fireEvent.click(rightsBox()!)
    expect(isNodeLinkRightsTicked("n1", "https://example.test/a.jpg")).toBe(true)
    expect(setButton().disabled).toBe(false)

    fireEvent.change(urlBox(), { target: { value: "https://example.test/b.jpg" } })
    expect(rightsBox()?.checked).toBe(false)
    expect(setButton().disabled).toBe(true)
  })

  it("Enter with the box unticked imports nothing and keeps the link in the box", async () => {
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    typeLink("https://example.test/a.jpg")
    fireEvent.keyDown(urlBox(), { key: "Enter" })
    await new Promise((r) => setTimeout(r, 0))

    expect(rights.confirm).not.toHaveBeenCalled()
    expect(importMediaUrl).not.toHaveBeenCalled()
    expect(onUpdateInput).not.toHaveBeenCalled()
    expect(urlBox().value).toBe("https://example.test/a.jpg")
  })

  it.each([
    ["before the confirmation", () => rights.confirm.mockRejectedValueOnce({ code: "rights_confirmation_stale" })],
    ["between the confirmation and the import", () => importMediaUrl.mockRejectedValueOnce(new api.MediaImportError(403, "rights_confirmation_stale"))],
  ])("a declaration changed %s stores nothing and says nothing: the link waits in the box, unticked, with Set disabled", async (_label, arrange) => {
    arrange()
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    pasteLink("https://example.test/a.jpg")

    await waitFor(() => expect(urlBox().value).toBe("https://example.test/a.jpg"))
    expect(rightsBox()?.checked).toBe(false)
    expect(setButton().disabled).toBe(true)
    expect(onUpdateInput).not.toHaveBeenCalled()
    expect(h.toastWarning).not.toHaveBeenCalled()
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it("a link the platform refuses to import is not used, and the card says so", async () => {
    importMediaUrl.mockRejectedValue(new api.MediaImportError(403, "import_source_disabled"))
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><ImageUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    pasteLink("https://example.test/a.jpg")

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("This link can't be added."))
    expect(onUpdateInput).not.toHaveBeenCalled()
    expect(h.toastWarning).not.toHaveBeenCalled()
    expect(h.openEditor).not.toHaveBeenCalled()
  })
})

describe("useMediaUpload — which links carry the box", () => {
  const options = { nodeId: "n1", isFullscreen: true, inputValues: {}, onUpdateInput: vi.fn() }

  it("a picture link does; a video or audio link, used as it is and never imported, does not", () => {
    const picture = renderHook(() => useMediaUpload({ ...options, mimePrefix: "image/" }), { wrapper: MemoryRouter })
    act(() => picture.result.current.setUrlValue("https://example.test/a.jpg"))
    expect(picture.result.current.rights).toBeDefined()

    for (const mimePrefix of ["video/", "audio/"] as const) {
      const media = renderHook(() => useMediaUpload({ ...options, mimePrefix }), { wrapper: MemoryRouter })
      act(() => media.result.current.setUrlValue("https://example.test/clip.mp4"))
      expect(media.result.current.rights).toBeUndefined()
    }
  })
})

describe("VideoUploadCard — a pasted link", () => {
  it("is still used as it is, with no box", () => {
    const onUpdateInput = vi.fn()
    render(<MemoryRouter><VideoUploadCard {...base} onUpdateInput={onUpdateInput} /></MemoryRouter>)
    typeLink("https://example.test/clip.mp4")
    expect(rightsBox()).toBeNull()
    fireEvent.click(setButton())

    expect(onUpdateInput).toHaveBeenCalledWith("n1", "url", "https://example.test/clip.mp4")
    expect(importMediaUrl).not.toHaveBeenCalled()
    expect(h.openEditor).not.toHaveBeenCalled()
  })
})
