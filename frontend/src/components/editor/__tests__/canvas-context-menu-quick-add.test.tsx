/**
 * The canvas right-click menu: the five quick nodes first (added where the menu
 * opened), the full picker as "More nodes…", and "Ask Copilot…" at the bottom
 * only where the Copilot is surfaced.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { CanvasContextMenu } from "../canvas-context-menu"
import { QUICK_ADD_NODE_TYPES, START_MANUALLY_NODE_TYPES, quickAddEntries } from "@/lib/quick-add-nodes"
import { NODE_OPTIONS } from "@/lib/node-options"

afterEach(cleanup)

function renderMenu(over: Partial<React.ComponentProps<typeof CanvasContextMenu>> = {}) {
  const props = {
    open: true,
    position: { x: 100, y: 100 },
    onClose: vi.fn(),
    onAddNode: vi.fn(),
    onAddStickyNote: vi.fn(),
    onTidyUp: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    hasSelection: false,
    ...over,
  }
  render(<CanvasContextMenu {...props} />)
  return props
}

const QUICK_NAMES = ["Image generation", "Video generation", "Text / LLM", "Upload image", "Upscale image"]

describe("the quick-add list", () => {
  it("offers image, video, text, an upload and an upscale — each a real catalogue node", () => {
    for (const type of QUICK_ADD_NODE_TYPES) {
      const option = NODE_OPTIONS.find((o) => o.type === type)
      expect(option, `${type} is in the add-node catalogue`).toBeDefined()
      expect(option?.adminOnly, `${type} is offered to everyone`).toBeFalsy()
    }
    expect(quickAddEntries(QUICK_ADD_NODE_TYPES).map((entry) => entry.type)).toEqual([...QUICK_ADD_NODE_TYPES])
  })

  it("gives every kind its own colour", () => {
    const swatches = quickAddEntries(QUICK_ADD_NODE_TYPES).map((entry) => entry.swatchClass)
    expect(new Set(swatches).size).toBe(QUICK_ADD_NODE_TYPES.length)
  })

  it("starts the empty canvas with the first three: image, video and text", () => {
    expect(START_MANUALLY_NODE_TYPES).toEqual(["generate-image", "generate-video", "llm-chat"])
  })
})

describe("CanvasContextMenu", () => {
  it("adds the node a person picks, and closes", () => {
    const props = renderMenu({ onAddNodeType: vi.fn() })
    screen.getByRole("button", { name: "Video generation" }).click()
    expect(props.onAddNodeType).toHaveBeenCalledWith("generate-video")
    expect(props.onClose).toHaveBeenCalled()
  })

  it("lists the five quick nodes, each beside its coloured square, then the full picker as More nodes…", () => {
    renderMenu({ onAddNodeType: vi.fn() })
    const entries = quickAddEntries(QUICK_ADD_NODE_TYPES)
    QUICK_NAMES.forEach((name, i) => {
      const button = screen.getByRole("button", { name })
      expect(button.querySelector(`.${entries[i].swatchClass}`), `${name} has its square`).not.toBeNull()
    })
    expect(screen.getByRole("button", { name: /More nodes…/ })).toBeInTheDocument()
  })

  it("keeps the old menu when no quick-add handler is given", () => {
    renderMenu()
    expect(screen.queryByRole("button", { name: "Image generation" })).toBeNull()
    expect(screen.getByRole("button", { name: /^Add node/ })).toBeInTheDocument()
  })

  it("offers Ask Copilot… only where the Copilot is surfaced", () => {
    const props = renderMenu({ onAddNodeType: vi.fn(), onAskCopilot: vi.fn() })
    screen.getByRole("button", { name: "Ask Copilot…" }).click()
    expect(props.onAskCopilot).toHaveBeenCalled()
    cleanup()
    renderMenu({ onAddNodeType: vi.fn() })
    expect(screen.queryByRole("button", { name: "Ask Copilot…" })).toBeNull()
  })
})
