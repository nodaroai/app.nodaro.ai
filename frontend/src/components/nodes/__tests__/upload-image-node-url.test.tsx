/**
 * A link typed into the upload image node's URL box is imported into the
 * person's storage, read back as a File and opened in the "Adjust image"
 * editor, as a picked file is. The editor works from that in-memory File, so
 * the imported copy is discarded as soon as it is read back, before the editor
 * opens, and whatever the editor then does discards nothing more. A
 * link that cannot be imported, for any reason, is added as it is (as before
 * links were imported) with one notice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"

const h = vi.hoisted(() => ({
  updateNodeData: vi.fn(),
  openEditor: vi.fn(),
  moderate: vi.fn(),
  toastWarning: vi.fn(),
  editorOptions: null as null | { onComplete: (results: unknown[]) => void; onCancel?: () => void },
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, importMediaUrl: vi.fn(), discardMedia: vi.fn() }
})

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

vi.mock("sonner", () => ({ toast: { warning: h.toastWarning, error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

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
import { UploadImageNode } from "../upload-image-node"

const importMediaUrl = vi.mocked(api.importMediaUrl)
const discardMedia = vi.mocked(api.discardMedia)

const LINK = "https://example.test/photos/cat.png"
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

function submitLink(link = LINK) {
  const box = screen.getByPlaceholderText("or paste image URL...")
  fireEvent.change(box, { target: { value: link } })
  fireEvent.keyDown(box, { key: "Enter" })
  return box
}

beforeEach(() => {
  h.updateNodeData.mockReset()
  h.openEditor.mockReset()
  h.moderate.mockReset()
  h.toastWarning.mockReset()
  h.editorOptions = null
  importMediaUrl.mockReset()
  discardMedia.mockReset()
  discardMedia.mockResolvedValue(undefined)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["png"], { type: "image/png" }) }))
})
afterEach(() => vi.unstubAllGlobals())

describe("UploadImageNode — a link opens the Adjust image editor", () => {
  it("imports the link, reads the copy back and opens the editor with one File", async () => {
    importMediaUrl.mockResolvedValue(IMPORTED)
    renderNode()
    submitLink()

    await waitFor(() => expect(h.openEditor).toHaveBeenCalledTimes(1))
    expect(importMediaUrl).toHaveBeenCalledWith(LINK)
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

  it("keeps a Pinterest link as its original, as before", async () => {
    importMediaUrl.mockRejectedValue(new Error("media import refused: 422 fetch_failed"))
    renderNode()
    submitLink("https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg")

    await waitFor(() => expectStoredAsIs("https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg"))
    expect(importMediaUrl).toHaveBeenCalledWith("https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg")
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
