/**
 * A link typed into the upload image node's URL box is imported into the
 * person's storage, read back as a File and opened in the "Adjust image"
 * editor, as a picked file is. An import of someone's link, so it waits for
 * the content rights box under the link, ticked for that link on this node
 * (ticking it starts the import), and confirms the declaration for that one
 * import. The editor works from that in-memory File, so the imported copy is
 * discarded as soon as it is read back, before the editor opens, and whatever
 * the editor then does discards nothing more. A link that cannot be imported,
 * for any reason, is added as it is (as before links were imported) with one
 * notice; a link whose box is not ticked is not added at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"

const h = vi.hoisted(() => ({
  updateNodeData: vi.fn(),
  openEditor: vi.fn(),
  moderate: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  editorOptions: null as null | { onComplete: (results: unknown[]) => void; onCancel?: () => void },
}))
const rights = vi.hoisted(() => ({ confirm: vi.fn(), declaration: vi.fn() }))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))

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

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/hooks/use-handle-connections", () => ({ useHandleConnections: () => [] }))

vi.mock("../base-node", () => ({
  BaseNode: ({ children }: { children: React.ReactNode }) => <div data-testid="base-node">{children}</div>,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({ updateNodeData: h.updateNodeData, openImageEdit: () => {}, edges: [], nodes: [] }),
}))

vi.mock("@/hooks/use-upstream-url", () => ({ useUpstreamUrl: () => {} }))

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    upload: vi.fn(),
    isUploading: false,
    uploadError: null,
    clearError: vi.fn(),
    storageExceeded: { exceeded: false, usedBytes: 0, quotaBytes: 0, tier: "" },
    clearStorageExceeded: vi.fn(),
  }),
}))

vi.mock("@/components/editor/media-editor", () => ({
  useMediaEditor: (options: NonNullable<typeof h.editorOptions>) => {
    h.editorOptions = options
    return { openEditor: h.openEditor }
  },
  MediaEditorModal: () => null,
}))

vi.mock("sonner", () => ({ toast: { warning: h.toastWarning, error: h.toastError, success: vi.fn(), info: vi.fn() } }))

vi.mock("../upload-moderation", () => ({
  useUploadModeration: () => ({ moderate: h.moderate }),
  UploadModerationOverlay: () => null,
}))

vi.mock("@/hooks/use-full-resolution", () => ({ useFullResolution: () => false }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({ useResultAspectRatio: () => ({ aspectRatio: 1, onLoadDimensions: () => {} }) }))
vi.mock("@/hooks/use-upstream-image-aspect", () => ({ useUpstreamImageAspect: () => undefined }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: () => null }))
vi.mock("@/ee/components/credits/StorageExceededModal", () => ({ StorageExceededModal: () => null }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/components/editor/save-to-library-button", () => ({ SaveToLibraryButton: () => null }))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: { image: "" }, TEXT_HANDLE_COLOR: "" }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))

import * as api from "@/lib/api"
import { __resetContentRightsForTests } from "@/lib/content-rights"
import { clearNodeLinkRights, isNodeLinkRightsTicked, tickNodeLinkRights } from "@/lib/node-link-rights"
import { UploadImageNode } from "../upload-image-node"

const importMediaUrl = vi.mocked(api.importMediaUrl)
const discardMedia = vi.mocked(api.discardMedia)

const LINK = "https://example.test/photos/cat.png"
const CONFIRMED = { confirmationId: "conf-1" }
const IMPORTED: api.ImportedMedia = {
  url: "https://r2.example.test/uploads/images/abc.png",
  thumbnailUrl: null,
  assetId: "asset-imported",
  mimeType: "image/png",
  sizeBytes: 3,
  filename: "cat.png",
  width: 10,
  height: 20,
}

function renderNode() {
  const props = { id: "node-1", data: { label: "Upload Image" }, selected: false } as unknown as NodeProps
  return render(<UploadImageNode {...props} />)
}

const urlBox = () => screen.getByPlaceholderText("or paste image URL...") as HTMLInputElement
const rightsBox = () => screen.queryByRole("checkbox", { name: "rights" }) as HTMLInputElement | null

function typeLink(link = LINK) {
  fireEvent.change(urlBox(), { target: { value: link } })
}

/** Type the link and tick its box: the tick starts the import. */
function submitLink(link = LINK) {
  typeLink(link)
  fireEvent.click(rightsBox()!)
}

beforeEach(() => {
  __resetContentRightsForTests()
  h.updateNodeData.mockReset()
  h.openEditor.mockReset()
  h.moderate.mockReset()
  h.toastWarning.mockReset()
  h.toastError.mockReset()
  rights.declaration.mockReset()
  rights.declaration.mockResolvedValue({ version: 1, text: "The declaration." })
  rights.confirm.mockReset()
  rights.confirm.mockResolvedValue({ id: "conf-1", expiresAt: "2026-11-05T12:00:00Z" })
  h.editorOptions = null
  importMediaUrl.mockReset()
  discardMedia.mockReset()
  discardMedia.mockResolvedValue(undefined)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["png"], { type: "image/png" }) }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearNodeLinkRights()
})

describe("UploadImageNode — a link opens the Adjust image editor", () => {
  it("imports the link, reads the copy back and opens the editor with one File", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    renderNode()
    submitLink()

    await waitFor(() => expect(h.openEditor).toHaveBeenCalledTimes(1))
    expect(importMediaUrl).toHaveBeenCalledWith(LINK, CONFIRMED)
    expect(fetch).toHaveBeenCalledWith(IMPORTED.url)
    const files = h.openEditor.mock.calls[0]![0] as File[]
    expect(files).toHaveLength(1)
    expect(files[0]).toBeInstanceOf(File)
    expect(files[0]!.name).toBe("cat.png")
    expect(files[0]!.type).toBe("image/png")
    // The link is no longer stored as-is.
    expect(h.updateNodeData).not.toHaveBeenCalledWith("node-1", expect.objectContaining({ externalUrl: LINK }))
  })

  it("discards the imported copy once it is read back, before the editor opens", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    renderNode()
    submitLink()
    await waitFor(() => expect(h.openEditor).toHaveBeenCalled())

    expect(discardMedia).toHaveBeenCalledTimes(1)
    expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url)
    expect(discardMedia.mock.invocationCallOrder[0]!).toBeLessThan(h.openEditor.mock.invocationCallOrder[0]!)
  })

  it("Cancel in the editor discards nothing more and adds nothing", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    renderNode()
    submitLink()
    await waitFor(() => expect(h.openEditor).toHaveBeenCalled())

    h.editorOptions!.onCancel?.()
    expect(discardMedia).toHaveBeenCalledTimes(1)
    expect(h.updateNodeData).not.toHaveBeenCalledWith("node-1", expect.objectContaining({ url: expect.anything() }))
  })

  it("takes the editor's upload as the node's picture, discarding nothing more", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    renderNode()
    submitLink()
    await waitFor(() => expect(h.openEditor).toHaveBeenCalled())

    const uploaded = "https://r2.example.test/uploads/images/cropped.png"
    h.editorOptions!.onComplete([{
      uploadResult: { url: uploaded, thumbnailUrl: null, assetId: "asset-upload", category: "image", filename: "cat.png", mimeType: "image/png", sizeBytes: 2, metadata: { width: 5, height: 5 }, r2Key: "k" },
    }])
    expect(h.updateNodeData).toHaveBeenCalledWith("node-1", expect.objectContaining({ url: uploaded, assetId: "asset-upload", externalUrl: "" }))
    expect(h.moderate).toHaveBeenCalledWith(uploaded)
    expect(discardMedia).toHaveBeenCalledTimes(1)
  })

  const NOTICE = "Added the link as it is. It couldn't be opened for adjusting."

  function expectStoredAsIs(link = LINK) {
    expect(h.updateNodeData).toHaveBeenCalledWith("node-1", expect.objectContaining({
      url: link,
      externalUrl: link,
      r2Url: "",
      assetId: "",
      uploadError: "",
      activeResultIndex: 0,
      generatedResults: [expect.objectContaining({ url: link })],
    }))
    expect(h.moderate).toHaveBeenCalledWith(link)
    expect(h.toastWarning).toHaveBeenCalledTimes(1)
    expect(h.toastWarning).toHaveBeenCalledWith(NOTICE)
    expect(h.openEditor).not.toHaveBeenCalled()
  }

  it.each([
    [400, "validation_error"],
    [422, "fetch_failed"],
    [413, "file_too_large"],
    [413, "storage_limit_exceeded"],
    [500, "internal_error"],
  ])("a %i %s refusal keeps the link as it is, with one notice", async (status, code) => {
    const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
    importMediaUrl.mockImplementation(actual.importMediaUrl)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ error: { code, message: "Couldn't fetch that URL: getaddrinfo ENOTFOUND" } }),
    }))
    renderNode()
    submitLink()

    await waitFor(() => expectStoredAsIs())
    expect(discardMedia).not.toHaveBeenCalled()
  })

  it("a request that never reaches the platform keeps the link as it is", async () => {
    const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
    importMediaUrl.mockImplementation(actual.importMediaUrl)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    renderNode()
    submitLink()

    await waitFor(() => expectStoredAsIs())
  })

  it("keeps a Pinterest link as its original, as before, and confirms the link it fetches", async () => {
    importMediaUrl.mockRejectedValue(new Error("media import refused: 422 fetch_failed"))
    renderNode()
    submitLink("https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg")

    await waitFor(() => expectStoredAsIs("https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg"))
    expect(rights.confirm).toHaveBeenCalledWith({ url: "https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg", declarationVersion: 1 })
    expect(importMediaUrl).toHaveBeenCalledWith("https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg", CONFIRMED)
  })

  it("a copy that cannot be read back is discarded and the link kept as it is", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob() }))
    renderNode()
    submitLink()

    await waitFor(() => expectStoredAsIs())
    expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url)
  })

  it("a refusal after the node was removed keeps nothing and says nothing", async () => {
    let refuse: (e: unknown) => void = () => {}
    importMediaUrl.mockReturnValue(new Promise((_r, reject) => { refuse = reject }))
    const { unmount } = renderNode()
    submitLink()
    unmount()
    refuse(new Error("media import refused: 422 fetch_failed"))

    await new Promise((r) => setTimeout(r, 0))
    expect(h.updateNodeData).not.toHaveBeenCalled()
    expect(h.toastWarning).not.toHaveBeenCalled()
    expect(h.moderate).not.toHaveBeenCalled()
  })

  it("a copy read back after the node was removed is discarded and opens nothing", async () => {
    let resolveImport: (v: api.ImportedMedia) => void = () => {}
    importMediaUrl.mockReturnValue(new Promise((r) => { resolveImport = r }))
    const { unmount } = renderNode()
    submitLink()
    unmount()
    resolveImport(IMPORTED)

    await waitFor(() => expect(discardMedia).toHaveBeenCalledWith(IMPORTED.url))
    expect(h.openEditor).not.toHaveBeenCalled()
    expect(h.updateNodeData).not.toHaveBeenCalled()
  })
})

describe("UploadImageNode — a link waits for its content rights box", () => {
  it("shows the box, unticked, only once a link is typed", () => {
    renderNode()
    expect(rightsBox()).toBeNull()
    typeLink()
    expect(rightsBox()?.checked).toBe(false)
  })

  it("Enter or leaving the box with the box unticked imports nothing and adds nothing; the link stays", async () => {
    renderNode()
    typeLink()
    fireEvent.keyDown(urlBox(), { key: "Enter" })
    fireEvent.blur(urlBox())
    await new Promise((r) => setTimeout(r, 0))

    expect(rights.confirm).not.toHaveBeenCalled()
    expect(importMediaUrl).not.toHaveBeenCalled()
    expect(h.updateNodeData).not.toHaveBeenCalled()
    expect(h.toastWarning).not.toHaveBeenCalled()
    expect(urlBox().value).toBe(LINK)
  })

  it("ticking the box starts the import under a confirmation for that link; once tried, the box is unticked for the next link", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    renderNode()
    submitLink()

    await waitFor(() => expect(h.openEditor).toHaveBeenCalled())
    expect(rights.confirm).toHaveBeenCalledWith({ url: LINK, declarationVersion: 1 })
    expect(rights.confirm.mock.invocationCallOrder[0]!).toBeLessThan(importMediaUrl.mock.invocationCallOrder[0]!)
    expect(isNodeLinkRightsTicked("node-1", LINK)).toBe(false)
    typeLink()
    expect(rightsBox()?.checked).toBe(false)
  })

  it("a link the platform refuses to import is not added, and the node says so", async () => {
    importMediaUrl.mockRejectedValue(new api.MediaImportError(403, "import_source_disabled"))
    renderNode()
    submitLink()

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("This link can't be added."))
    expect(h.updateNodeData).not.toHaveBeenCalled()
    expect(h.toastWarning).not.toHaveBeenCalled()
    expect(h.openEditor).not.toHaveBeenCalled()
  })

  it("a box ticked for another link is not this link's: shown unticked, and Enter imports nothing", async () => {
    tickNodeLinkRights("node-1", "https://example.test/photos/other.png")
    renderNode()
    typeLink()
    expect(rightsBox()?.checked).toBe(false)
    fireEvent.keyDown(urlBox(), { key: "Enter" })
    await new Promise((r) => setTimeout(r, 0))

    expect(importMediaUrl).not.toHaveBeenCalled()
  })

  it("a box already ticked for the link lets Enter import it", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    tickNodeLinkRights("node-1", LINK)
    renderNode()
    typeLink()
    expect(rightsBox()?.checked).toBe(true)
    fireEvent.keyDown(urlBox(), { key: "Enter" })

    await waitFor(() => expect(h.openEditor).toHaveBeenCalled())
    expect(importMediaUrl).toHaveBeenCalledWith(LINK, CONFIRMED)
  })

  it.each([
    ["before the confirmation", () => rights.confirm.mockRejectedValueOnce({ code: "rights_confirmation_stale" })],
    ["between the confirmation and the import", () => importMediaUrl.mockRejectedValueOnce(new api.MediaImportError(403, "rights_confirmation_stale"))],
  ])("a declaration changed %s adds nothing and says nothing: the link waits in the box, unticked, for a new tick", async (_label, arrange) => {
    arrange()
    renderNode()
    submitLink()

    await waitFor(() => expect(urlBox().value).toBe(LINK))
    expect(rightsBox()?.checked).toBe(false)
    expect(h.updateNodeData).not.toHaveBeenCalled()
    expect(h.toastWarning).not.toHaveBeenCalled()
    expect(h.toastError).not.toHaveBeenCalled()
    expect(h.openEditor).not.toHaveBeenCalled()
  })
})
