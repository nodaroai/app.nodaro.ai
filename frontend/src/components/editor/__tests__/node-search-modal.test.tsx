import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { getParameterPickerMeta, type SingleDimParameterPickerMeta } from "@/lib/parameter-picker-registry"

// jsdom doesn't implement scrollIntoView; the modal scrolls the active row.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// ── Mocks: store + ReactFlow + image (keep node-thumbnail + registry REAL,
//    since the whole point is to verify they feed the rendered surface). ──
const SELECT_NODE = vi.fn()
const ON_CONNECT = vi.fn()
const DELETE_EDGE = vi.fn()
const FOCUS_CANVAS = vi.fn()
let STATE: Record<string, unknown> = {}
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) => selector(STATE),
}))
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ setCenter: vi.fn(), getNode: vi.fn() }),
}))
vi.mock("@/hooks/use-click-outside", () => ({ useClickOutside: () => {} }))
vi.mock("@/components/ui/cached-image", () => ({
  // Render a plain img so we can read the resolved src.
  CachedImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt ?? ""} />,
}))
vi.mock("@/components/editor/config-panels/aspect-ratio-selector", () => ({
  RatioIcon: () => null,
}))

import { NodeSearchModal } from "../node-search-modal"

const moodMeta = getParameterPickerMeta("mood") as SingleDimParameterPickerMeta
const MOOD = moodMeta.entries[0] // a real catalog id + label

function setNodes(nodes: unknown[], focusedNodeId: string | null = null) {
  STATE = {
    nodes,
    edges: [],
    selectNode: SELECT_NODE,
    focusNodeOnCanvas: FOCUS_CANVAS,
    onConnect: ON_CONNECT,
    deleteEdge: DELETE_EDGE,
    selectedNodeId: null,
    focusedNodeId,
  }
}

describe("NodeSearchModal — preview + config visibility", () => {
  it("renders a character node's preview image and a picker node's selected value", () => {
    setNodes([
      {
        id: "c1",
        type: "character",
        position: { x: 0, y: 0 },
        data: { characterName: "Kira", defaultAssetUrl: "https://cdn.nodaro.ai/kira.png" },
      },
      {
        id: "m1",
        type: "mood",
        position: { x: 0, y: 0 },
        data: { label: "Mood", mood: MOOD.id },
      },
    ])

    render(<NodeSearchModal open onClose={() => {}} />)

    // Preview (character): the starred default asset resolves to an <img src>.
    const imgs = screen.getAllByRole("img").map((el) => el.getAttribute("src") ?? "")
    expect(imgs.some((src) => src.includes("kira.png"))).toBe(true)

    // Config (picker): the Mood node surfaces its selected value's label.
    expect(screen.getAllByText(MOOD.label).length).toBeGreaterThan(0)
  })

  it("does not render when closed", () => {
    setNodes([])
    const { container } = render(<NodeSearchModal open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("NodeSearchModal — in-search connectors", () => {
  it("shows a connector on a connectable row and wires it on click", async () => {
    // generate-image is focused; a text-prompt feeds its Prompt input.
    setNodes(
      [
        { id: "gi1", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Hero" } },
        { id: "tp1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Brief", text: "a hero" } },
      ],
      "gi1",
    )

    render(<NodeSearchModal open onClose={() => {}} />)

    const user = (await import("@testing-library/user-event")).default.setup()

    // The text-prompt row exposes a "From" control (its text output can feed
    // the focused generate-image's input). Only tp1 is connectable here.
    const fromBtns = screen.getAllByRole("button", { name: /^from/i })
    expect(fromBtns.length).toBeGreaterThan(0)
    await user.click(fromBtns[0])

    // A single handle toggles directly; multiple handles expand to a list —
    // then click one (e.g. "Prompt").
    if (ON_CONNECT.mock.calls.length === 0) {
      await user.click(screen.getAllByRole("button", { name: /prompt/i })[0])
    }

    expect(ON_CONNECT).toHaveBeenCalled()
    const arg = ON_CONNECT.mock.calls.at(-1)![0]
    expect(arg.source).toBe("tp1") // wired FROM the result node…
    expect(arg.target).toBe("gi1") // …INTO the focused node
  })
})
