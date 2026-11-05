// The Reference Audio node's settings panel: extracting the link's sound
// fetches the link, so Extract waits for the content rights box ticked for that
// link on this node (`node-link-rights.ts`), and runs through the shared
// `extractReferenceAudio` (which confirms it for that one fetch). The
// declaration's text is the shared box's own, stubbed here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img src={props.src} alt={props.alt} />,
}))
vi.mock("@/lib/api", () => ({
  uploadAudio: vi.fn(),
  fetchYouTubeOEmbed: vi.fn(),
  extractYouTubeAudioApi: vi.fn(),
  getJobStatusLean: vi.fn(),
  startVideoDownload: vi.fn(),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({ edges: [], nodes: [] }),
}))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  resolveEdgeValuesForTableColumn: () => null,
}))
vi.mock("@/ee/components/credits/StorageExceededModal", () => ({
  StorageExceededModal: () => null,
}))
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
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}))
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: "", isDragging: false }),
  arrayMove: (arr: any[]) => arr,
}))
vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}))

// The shared flow (its writes, its one-extraction-per-node) is tested on its
// own; here: what the panel hands it, and what "extracting here" disables.
const extraction = vi.hoisted(() => ({ run: vi.fn(), here: new Set<string>() }))
vi.mock("@/lib/youtube-audio-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube-audio-extraction")>()),
  extractReferenceAudio: extraction.run,
  useReferenceAudioExtracting: (nodeId: string) => extraction.here.has(nodeId),
}))
vi.mock("@/components/content-rights/rights-declaration-box", () => ({
  RightsDeclarationBox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input type="checkbox" aria-label="rights" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

import { ReferenceAudioConfig } from "../input-configs"
import { clearNodeLinkRights, isNodeLinkRightsTicked, tickNodeLinkRights } from "@/lib/node-link-rights"

const LINK = "https://youtu.be/abc"

function renderPanel(data: Record<string, unknown>, nodeId: string | null = "r1") {
  const onUpdate = vi.fn()
  render(
    <ReferenceAudioConfig
      data={{ label: "Reference Audio", sourceType: "youtube", extractionStatus: "idle", ...data } as never}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
      nodeId={nodeId}
    />,
  )
  return { onUpdate }
}

const box = () => screen.queryByRole("checkbox", { name: "rights" }) as HTMLInputElement | null
const extractButton = () => screen.getByRole("button", { name: "Extract Audio" }) as HTMLButtonElement

beforeEach(() => {
  extraction.run.mockReset()
  extraction.here.clear()
})
afterEach(() => clearNodeLinkRights())

describe("ReferenceAudioConfig — the link's sound is extracted only under the content rights box", () => {
  it("shows the box under a link, unticked, and Extract waits for it; ticking ticks it for that link on this node", () => {
    renderPanel({ youtubeUrl: LINK })
    expect(box()?.checked).toBe(false)
    expect(extractButton().disabled).toBe(true)
    fireEvent.click(box()!)
    expect(isNodeLinkRightsTicked("r1", LINK)).toBe(true)
    expect(extractButton().disabled).toBe(false)
  })

  it("Extract runs the node's import of its link: this node and link, written through the panel", async () => {
    tickNodeLinkRights("r1", LINK)
    extraction.run.mockResolvedValueOnce(undefined)
    const { onUpdate } = renderPanel({ youtubeUrl: LINK })
    fireEvent.click(extractButton())
    await waitFor(() => expect(extraction.run).toHaveBeenCalledWith("r1", LINK, onUpdate))
    await waitFor(() => expect(extractButton().disabled).toBe(false))
  })

  it("a refusal before anything is asked (the box not ticked by then) leaves the panel usable", async () => {
    tickNodeLinkRights("r1", LINK)
    extraction.run.mockRejectedValueOnce(new Error("Tick the content rights box for this link first."))
    renderPanel({ youtubeUrl: LINK })
    fireEvent.click(extractButton())
    await waitFor(() => expect(extraction.run).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(extractButton().disabled).toBe(false))
  })

  it("a box ticked for another link, or on another node, is not this one's: Extract stays disabled", () => {
    tickNodeLinkRights("r1", "https://youtu.be/other")
    tickNodeLinkRights("r2", LINK)
    renderPanel({ youtubeUrl: LINK })
    expect(box()?.checked).toBe(false)
    expect(extractButton().disabled).toBe(true)
  })

  it("a node extracting on this page keeps Extract disabled, so one tick never starts two fetches", () => {
    tickNodeLinkRights("r1", LINK)
    extraction.here.add("r1")
    renderPanel({ youtubeUrl: LINK, extractionStatus: "extracting" })
    expect(screen.getByRole("button", { name: "Extracting..." })).toHaveProperty("disabled", true)
  })

  it("a node only SAVED as extracting (a copy, a reload: nothing running here) keeps Extract usable", () => {
    tickNodeLinkRights("r1", LINK)
    renderPanel({ youtubeUrl: LINK, extractionStatus: "extracting" })
    expect(extractButton().disabled).toBe(false)
  })

  it("no node to tick a box on, or no link: no box, and Extract stays disabled", () => {
    tickNodeLinkRights("", LINK)
    renderPanel({ youtubeUrl: LINK }, null)
    expect(box()).toBeNull()
    expect(extractButton().disabled).toBe(true)
  })
})
