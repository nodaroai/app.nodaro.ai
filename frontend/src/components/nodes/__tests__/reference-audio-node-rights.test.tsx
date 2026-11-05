// The Reference Audio node's card: a node whose link has no audio yet extracts
// it by itself, but only under the content rights box ticked for that link, on
// the card or in the panel (`node-link-rights.ts`), through the shared flow
// (`extractReferenceAudio`, real here; the server calls and the confirmation
// are stubbed). A direct file link needs no box. A saved "extracting" with
// nothing extracting on this page waits for its box again. The declaration's
// text is the shared box's own, stubbed here.
import { useState, type ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => <div data-testid={`handle-${type}-${id}`} data-type={type} data-position={position} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}))
vi.mock("@/hooks/use-handle-connections", () => ({ useHandleConnections: () => [] }))
vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

const harness = vi.hoisted(() => ({
  extract: vi.fn(),
  status: vi.fn(),
  confirm: vi.fn(),
  writes: [] as Array<Record<string, unknown>>,
  apply: (_patch: Record<string, unknown>) => {},
  update: (_id: string, _patch: Record<string, unknown>) => {},
}))
harness.update = (_id, patch) => {
  harness.writes.push(patch)
  harness.apply(patch)
}
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) => selector({ updateNodeData: harness.update }),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  extractYouTubeAudioApi: harness.extract,
  getJobStatusLean: harness.status,
}))
vi.mock("@/lib/node-link-rights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/node-link-rights")>()),
  confirmNodeLink: harness.confirm,
}))
vi.mock("@/components/content-rights/rights-declaration-box", () => ({
  RightsDeclarationBox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input type="checkbox" aria-label="rights" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

import { ReferenceAudioNode } from "../reference-audio-node"
import { clearNodeLinkRights, isNodeLinkRightsTicked, tickNodeLinkRights, untickNodeLinkRights } from "@/lib/node-link-rights"
import { DeclarationChangedError } from "@/lib/content-rights"
import { isReferenceAudioExtracting } from "@/lib/youtube-audio-extraction"

const LINK = "https://youtu.be/abc"
const AUDIO = "https://cdn/ref.mp3"

// The card over node data that follows its own writes, as the workflow store does.
function Card({ initial }: { initial: Record<string, unknown> }) {
  const [data, setData] = useState({ label: "Ref Audio", sourceType: "youtube", extractionStatus: "idle", ...initial })
  harness.apply = (patch) => setData((d) => ({ ...d, ...patch }))
  return <ReferenceAudioNode {...({ id: "n1", data, selected: false } as unknown as ComponentProps<typeof ReferenceAudioNode>)} />
}

const box = () => screen.queryByRole("checkbox", { name: "rights" }) as HTMLInputElement | null
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const extracted = (durationSeconds?: number) => ({ id: "j1", status: "completed", output_data: { audioUrl: AUDIO, ...(durationSeconds ? { durationSeconds } : {}) } })

beforeEach(() => {
  harness.extract.mockReset()
  harness.status.mockReset()
  harness.confirm.mockReset()
  harness.writes = []
  harness.extract.mockResolvedValue({ jobId: "j1" })
})
afterEach(() => clearNodeLinkRights())

describe("ReferenceAudioNode — its link is extracted only under the content rights box", () => {
  it("a link with no audio waits for the box: nothing is fetched or written, and the box is on the card, unticked", async () => {
    render(<Card initial={{ youtubeUrl: LINK }} />)
    await settle()
    expect(box()?.checked).toBe(false)
    expect(harness.confirm).not.toHaveBeenCalled()
    expect(harness.extract).not.toHaveBeenCalled()
    expect(harness.writes).toEqual([])
  })

  it("ticking the box on the card ticks it for that link and starts this node's import: extracting, confirmed, then its audio", async () => {
    harness.confirm.mockResolvedValueOnce("conf-1")
    harness.status.mockResolvedValueOnce(extracted(12))
    render(<Card initial={{ youtubeUrl: LINK }} />)
    fireEvent.click(box()!)
    expect(isNodeLinkRightsTicked("n1", LINK)).toBe(true)
    await waitFor(() => expect(harness.writes.at(-1)).toMatchObject({ extractionStatus: "ready", metadata: { durationSeconds: 12, mediaUrl: AUDIO } }))
    expect(harness.writes[0]).toEqual({ extractionStatus: "extracting" })
    expect(harness.confirm).toHaveBeenCalledWith("n1", LINK)
    expect(harness.extract).toHaveBeenCalledWith(LINK, { confirmationId: "conf-1" })
    expect(harness.extract).toHaveBeenCalledTimes(1)
    expect(box()).toBeNull()
  })

  it("a box ticked for another link starts nothing; ticked for this link (in the panel), the card starts it", async () => {
    tickNodeLinkRights("n1", "https://youtu.be/other")
    tickNodeLinkRights("n2", LINK)
    harness.confirm.mockResolvedValueOnce("conf-1")
    harness.status.mockResolvedValueOnce(extracted())
    render(<Card initial={{ youtubeUrl: LINK }} />)
    await settle()
    expect(harness.confirm).not.toHaveBeenCalled()
    act(() => tickNodeLinkRights("n1", LINK))
    await waitFor(() => expect(harness.extract).toHaveBeenCalledWith(LINK, { confirmationId: "conf-1" }))
  })

  it("a changed declaration unticks the box: the node waits again with the box shown, and nothing is fetched", async () => {
    harness.confirm.mockImplementationOnce(async (nodeId: string) => {
      untickNodeLinkRights(nodeId)
      throw new DeclarationChangedError()
    })
    render(<Card initial={{ youtubeUrl: LINK }} />)
    fireEvent.click(box()!)
    await waitFor(() => expect(harness.writes).toEqual([{ extractionStatus: "extracting" }, { extractionStatus: "idle" }]))
    await settle()
    expect(box()?.checked).toBe(false)
    expect(harness.extract).not.toHaveBeenCalled()
    expect(harness.confirm).toHaveBeenCalledTimes(1)
  })

  it("any other failure leaves the node failed, and the card does not try again by itself", async () => {
    harness.confirm.mockResolvedValue("conf-1")
    harness.extract.mockRejectedValueOnce(new Error("private video"))
    render(<Card initial={{ youtubeUrl: LINK }} />)
    fireEvent.click(box()!)
    await waitFor(() => expect(harness.writes.at(-1)).toEqual({ extractionStatus: "failed" }))
    await settle()
    expect(harness.extract).toHaveBeenCalledTimes(1)
    expect(box()).toBeNull()
  })

  it("a node saved while extracting, with nothing extracting on this page (a copy, a reload), waits for its box instead of spinning", async () => {
    harness.confirm.mockResolvedValueOnce("conf-1")
    harness.status.mockResolvedValueOnce(extracted())
    const { container } = render(<Card initial={{ youtubeUrl: LINK, extractionStatus: "extracting" }} />)
    await settle()
    expect(isReferenceAudioExtracting("n1")).toBe(false)
    expect(container.querySelector(".animate-spin")).toBeNull()
    expect(box()?.checked).toBe(false)
    fireEvent.click(box()!)
    await waitFor(() => expect(harness.writes.at(-1)).toMatchObject({ extractionStatus: "ready" }))
  })

  it("one tick starts one fetch: a second card of the node while it extracts shows no box and fetches nothing more", async () => {
    let confirm: (id: string) => void = () => undefined
    harness.confirm.mockReturnValueOnce(new Promise<string>((resolve) => { confirm = resolve }))
    harness.status.mockResolvedValueOnce(extracted())
    const first = render(<Card initial={{ youtubeUrl: LINK }} />)
    fireEvent.click(box()!)
    await settle()
    expect(isReferenceAudioExtracting("n1")).toBe(true)
    first.unmount()
    render(<Card initial={{ youtubeUrl: LINK }} />)
    await settle()
    expect(box()).toBeNull()
    expect(harness.confirm).toHaveBeenCalledTimes(1)
    confirm("conf-1")
    await waitFor(() => expect(isReferenceAudioExtracting("n1")).toBe(false))
    expect(harness.extract).toHaveBeenCalledTimes(1)
  })

  it("a direct file link needs no box and no fetch: the link is the audio", async () => {
    render(<Card initial={{ sourceType: "url", directUrl: "https://example.com/ref.mp3" }} />)
    await settle()
    expect(box()).toBeNull()
    expect(harness.confirm).not.toHaveBeenCalled()
    expect(harness.writes[0]).toMatchObject({ extractionStatus: "ready" })
  })

  it("a node with its audio shows no box and fetches nothing", async () => {
    tickNodeLinkRights("n1", LINK)
    render(<Card initial={{ youtubeUrl: LINK, extractedAudioUrl: AUDIO, extractionStatus: "ready" }} />)
    await settle()
    expect(box()).toBeNull()
    expect(harness.confirm).not.toHaveBeenCalled()
  })
})
