import { describe, it, expect, vi, beforeEach } from "vitest"
import { render as rtlRender, screen, fireEvent } from "@testing-library/react"
import { ReactFlowProvider, Position, useConnection } from "@xyflow/react"
import { type ReactElement } from "react"
import { HandleWithPopover } from "../handle-with-popover"

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
