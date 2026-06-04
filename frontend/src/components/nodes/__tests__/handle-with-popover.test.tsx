import { describe, it, expect, vi } from "vitest"
import { render as rtlRender, screen, fireEvent } from "@testing-library/react"
import { ReactFlowProvider, Position } from "@xyflow/react"
import { type ReactElement } from "react"
import { HandleWithPopover } from "../handle-with-popover"

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
