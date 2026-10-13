import { describe, it, expect, vi, beforeEach } from "vitest"
import { render as rtlRender, screen, fireEvent } from "@testing-library/react"
import { ReactFlowProvider, Position, useConnection } from "@xyflow/react"
import { type ReactElement } from "react"
import { HandleWithPopover } from "../handle-with-popover"
import { TARGET_HANDLE_ACCEPTS } from "@/lib/target-handle-registry"
import { isValidWorkflowConnection } from "@/lib/connection-validation"

// Mock ONLY useConnection — jsdom can't perform a real drag, and the drag
// state is an external input to the component, not the logic under test.
// Everything else (Handle, useStore, the real isValidCandidate code path,
// the real resolveEffectiveSourceType) stays live. Default: no drag, so the
// pre-existing tests below behave exactly as before.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  useConnection: vi.fn(() => ({ inProgress: false })),
}))

// jsdom doesn't implement Pointer Capture; stub so the handlers don't throw.
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} })

const render = (ui: ReactElement) => rtlRender(<ReactFlowProvider>{ui}</ReactFlowProvider>)

function pip() {
  return screen.getByRole("button", { name: /Prompt/i })
}

describe("HandleWithPopover — click isolation from node focus", () => {
  // A node's React Flow wrapper is an ancestor of its handle pips. Clicking a
  // pip must NOT bubble a `click` up to the node — otherwise React Flow selects
  // the node (focus glow) and the node's onClick/onNodeClick fires, opening
  // settings. Dragging from a handle already never selects (it's a connection);
  // a plain click should behave the same.
  it("does not bubble a click to the surrounding node element", () => {
    const nodeClick = vi.fn()
    render(
      <div onClick={nodeClick} data-testid="node-wrapper">
        <HandleWithPopover
          nodeId="n1"
          nodeType="generate-image"
          handleId="prompt"
          type="target"
          position={Position.Left}
          label="Prompt"
          color="#ff0073"
          icon={<span />}
          side="left"
          top="0px"
        />
      </div>,
    )
    fireEvent.click(pip())
    expect(nodeClick).not.toHaveBeenCalled()
  })
})

describe("HandleWithPopover — entity image handle lights up image inputs (drag-glow)", () => {
  beforeEach(() => {
    vi.mocked(useConnection).mockReset()
  })

  // Simulate an in-progress drag FROM the given source handle of a node.
  const dragFrom = (nodeId: string, handleId: string, nodeType: string) =>
    vi.mocked(useConnection).mockReturnValue({
      inProgress: true,
      fromHandle: { nodeId, id: handleId, type: "source" },
      fromNode: { type: nodeType },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

  // Render an image-INPUT target pip (image-to-image's `image`) whose accepts
  // predicate is a spy, so we can assert exactly which source TYPE it receives.
  const renderImageInput = (accepts: (t: string) => boolean) =>
    render(
      <HandleWithPopover
        nodeId="i2i1"
        nodeType="image-to-image"
        handleId="image"
        type="target"
        position={Position.Left}
        label="Image"
        color="#22d3ee"
        icon={<span />}
        side="left"
        top="0px"
        accepts={accepts}
      />,
    )

  const imagePip = () => screen.getByRole("button", { name: /Image/i })

  // All four entity nodes (character/location/object/creature) render the SAME
  // `image` source pip — verify the remap fires for each, not just character.
  const ENTITIES = [
    { type: "character", ref: "characterRef" },
    { type: "location", ref: "locationRef" },
    { type: "object", ref: "objectRef" },
    { type: "creature", ref: "creatureRef" },
  ] as const

  it.each(ENTITIES)(
    "$type `image` handle passes the REMAPPED type (upload-image) to an image input → pip lights up",
    ({ type }) => {
      dragFrom(`${type}1`, "image", type)
      const accepts = vi.fn((t: string) => t === "upload-image") // a real image input
      renderImageInput(accepts)
      // The fix: the entity `image` pip emits a plain image producer, so the
      // image input's accepts predicate is consulted with "upload-image" and
      // the pip lights up as a valid drop candidate.
      expect(accepts).toHaveBeenCalledWith("upload-image")
      expect(imagePip().className).toContain("valid-candidate")
    },
  )

  it.each(ENTITIES)(
    "$type identity ref handle is UNCHANGED — image input stays dark",
    ({ type, ref }) => {
      dragFrom(`${type}1`, ref, type)
      const accepts = vi.fn((t: string) => t === "upload-image")
      renderImageInput(accepts)
      // Identity handle is not remapped: accepts sees the raw entity type,
      // rejects it, and the image input stays dark.
      expect(accepts).toHaveBeenCalledWith(type)
      expect(accepts).not.toHaveBeenCalledWith("upload-image")
      expect(imagePip().className).not.toContain("valid-candidate")
    },
  )
})

describe("HandleWithPopover — an EDL drag does not light the Transcript pip (drag-glow)", () => {
  beforeEach(() => {
    vi.mocked(useConnection).mockReset()
  })

  const acceptsJson = (t: string) => t === "edit-plan" || t === "transcribe"

  const renderTranscriptPip = () =>
    render(
      <HandleWithPopover
        nodeId="cap1"
        nodeType="add-captions"
        handleId="transcript"
        type="target"
        position={Position.Left}
        label="Transcript"
        color="#22d3ee"
        icon={<span />}
        side="left"
        top="0px"
        accepts={acceptsJson}
      />,
    )

  const pip = () => screen.getByRole("button", { name: /Transcript/i })

  const dragFrom = (nodeId: string, handleId: string, nodeType: string) =>
    vi.mocked(useConnection).mockReturnValue({
      inProgress: true,
      fromHandle: { nodeId, id: handleId, type: "source" },
      fromNode: { type: nodeType },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

  it("target-direction: dragging Edit Plan's edl leaves the Transcript pip dark", () => {
    dragFrom("plan1", "edl", "edit-plan")
    renderTranscriptPip()
    expect(pip().className).not.toContain("valid-candidate")
  })

  it("target-direction: a Transcript-kind source still lights it", () => {
    dragFrom("tr1", "json", "transcribe")
    renderTranscriptPip()
    expect(pip().className).toContain("valid-candidate")
  })

  it("source-direction: dragging back from the Transcript input leaves Edit Plan's edl pip dark", () => {
    vi.mocked(useConnection).mockReturnValue({
      inProgress: true,
      fromHandle: { nodeId: "cap1", id: "transcript", type: "target" },
      fromNode: { type: "add-captions" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    render(
      <HandleWithPopover
        nodeId="plan1"
        nodeType="edit-plan"
        handleId="edl"
        type="source"
        position={Position.Right}
        label="EDL"
        color="#22d3ee"
        icon={<span />}
        side="right"
        top="0px"
      />,
    )
    expect(screen.getByRole("button", { name: /EDL/i }).className).not.toContain("valid-candidate")
  })
})

describe("HandleWithPopover — a Transcript drag does not light the EDL pip (drag-glow, decided 2026-10-08)", () => {
  beforeEach(() => {
    vi.mocked(useConnection).mockReset()
  })

  const acceptsJson = (t: string) => t === "edit-plan" || t === "transcribe"

  const renderEdlPip = () =>
    render(
      <HandleWithPopover
        nodeId="render1"
        nodeType="apply-edl"
        handleId="edl"
        type="target"
        position={Position.Left}
        label="EDL"
        color="#22d3ee"
        icon={<span />}
        side="left"
        top="0px"
        accepts={acceptsJson}
      />,
    )

  it("target-direction: dragging Transcribe's json leaves the EDL pip dark", () => {
    vi.mocked(useConnection).mockReturnValue({
      inProgress: true,
      fromHandle: { nodeId: "tr1", id: "json", type: "source" },
      fromNode: { type: "transcribe" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    renderEdlPip()
    expect(screen.getByRole("button", { name: /EDL/i }).className).not.toContain("valid-candidate")
  })

  it("target-direction: an EDL source still lights it", () => {
    vi.mocked(useConnection).mockReturnValue({
      inProgress: true,
      fromHandle: { nodeId: "plan1", id: "edl", type: "source" },
      fromNode: { type: "edit-plan" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    renderEdlPip()
    expect(screen.getByRole("button", { name: /EDL/i }).className).toContain("valid-candidate")
  })

  it("source-direction: dragging back from the EDL input leaves Transcribe's json pip dark", () => {
    vi.mocked(useConnection).mockReturnValue({
      inProgress: true,
      fromHandle: { nodeId: "render1", id: "edl", type: "target" },
      fromNode: { type: "apply-edl" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    render(
      <HandleWithPopover
        nodeId="tr1"
        nodeType="transcribe"
        handleId="json"
        type="source"
        position={Position.Right}
        label="JSON"
        color="#22d3ee"
        icon={<span />}
        side="right"
        top="0px"
      />,
    )
    expect(screen.getByRole("button", { name: /JSON/i }).className).not.toContain("valid-candidate")
  })
})

describe("HandleWithPopover — a UGC pip lights exactly where a drop connects (drag-glow)", () => {
  beforeEach(() => {
    vi.mocked(useConnection).mockReset()
  })

  const drag = (from: { nodeId: string; id: string; type: "source" | "target" }, fromType: string) =>
    vi.mocked(useConnection).mockReturnValue({
      inProgress: true,
      fromHandle: from,
      fromNode: { type: fromType },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

  /** An input pip with the accepts predicate its node draws it with (the shared registry row). */
  const renderInput = (nodeType: string, handleId: string) => {
    const accepts = TARGET_HANDLE_ACCEPTS[nodeType]!.find((e) => e.handleId === handleId)!.accepts
    return render(
      <HandleWithPopover nodeId="t1" nodeType={nodeType} handleId={handleId} type="target" position={Position.Left}
        label="Candidate" color="#22d3ee" icon={<span />} side="left" top="0px" accepts={accepts} />,
    )
  }
  const renderOutput = (nodeType: string, handleId: string) =>
    render(
      <HandleWithPopover nodeId="s1" nodeType={nodeType} handleId={handleId} type="source" position={Position.Right}
        label="Candidate" color="#22d3ee" icon={<span />} side="right" top="0px" />,
    )
  const lit = () => screen.getByRole("button", { name: /Candidate/i }).className.includes("valid-candidate")

  it("a drag from UGC Clips' clip tickets leaves UGC Cards' Script input dark; one from its sized script lights it", () => {
    drag({ nodeId: "s1", id: "clips", type: "source" }, "ugc-clips")
    const first = renderInput("ugc-cards", "plan")
    expect(lit()).toBe(false)
    first.unmount()
    drag({ nodeId: "s1", id: "plan-out", type: "source" }, "ugc-clips")
    renderInput("ugc-cards", "plan")
    expect(lit()).toBe(true)
  })

  it("a drag from UGC Clips' clip tickets leaves a List's input dark (a private output)", () => {
    drag({ nodeId: "s1", id: "clips", type: "source" }, "ugc-clips")
    renderInput("list", "in")
    expect(lit()).toBe(false)
  })

  it("dragging back from UGC Cards' Script input lights UGC Clips' sized script and leaves its clip tickets dark", () => {
    drag({ nodeId: "t1", id: "plan", type: "target" }, "ugc-cards")
    const first = renderOutput("ugc-clips", "plan-out")
    expect(lit()).toBe(true)
    first.unmount()
    renderOutput("ugc-clips", "clips")
    expect(lit()).toBe(false)
  })

  // A UGC text pip is a plain text everywhere but its own UGC input.
  const PAIRS: ReadonlyArray<readonly [string, string, string, string]> = [
    ["ugc-script", "category", "llm-chat", "prompt"],
    ["ugc-script", "category", "ugc-creator", "category"],
    ["ugc-script", "category", "add-captions", "transcript"],
    ["ugc-script", "category", "ugc-cards", "transcript"],
    ["ugc-clips", "transcript", "ugc-cards", "transcript"],
    ["ugc-clips", "transcript", "apply-edl", "edl"],
    ["ugc-clips", "transcript", "text-to-speech", "prompt"],
    ["ugc-cards", "report", "llm-chat", "prompt"],
    ["ugc-cards", "report", "apply-edl", "edl"],
    ["ugc-cards", "report", "ugc-creator", "category"],
    ["combine-text", "text", "ugc-creator", "category"],
    ["combine-text", "text", "ugc-cards", "transcript"],
  ]
  const drop = (sourceType: string, sourceHandle: string, targetType: string, targetHandle: string) =>
    isValidWorkflowConnection({ source: "s1", sourceHandle, target: "t1", targetHandle }, (id) => (id === "s1" ? sourceType : id === "t1" ? targetType : undefined))

  it("the text pips connect to text inputs and their own UGC input only — the pins the glow is checked against", () => {
    expect(PAIRS.filter(([s, sh, t, th]) => drop(s, sh, t, th)).map(([s, sh, t, th]) => `${s}.${sh}→${t}.${th}`)).toEqual([
      "ugc-script.category→llm-chat.prompt",
      "ugc-script.category→ugc-creator.category",
      "ugc-clips.transcript→ugc-cards.transcript",
      "ugc-clips.transcript→text-to-speech.prompt",
      "ugc-cards.report→llm-chat.prompt",
    ])
  })

  it.each(PAIRS)("target-direction: a drag from %s.%s lights %s.%s exactly when a drop connects them", (s, sh, t, th) => {
    drag({ nodeId: "s1", id: sh, type: "source" }, s)
    renderInput(t, th)
    expect(lit()).toBe(drop(s, sh, t, th))
  })

  it.each(PAIRS)("source-direction: %s.%s lights during a drag back from %s.%s exactly when a drop connects them", (s, sh, t, th) => {
    drag({ nodeId: "t1", id: th, type: "target" }, t)
    renderOutput(s, sh)
    expect(lit()).toBe(drop(s, sh, t, th))
  })
})
