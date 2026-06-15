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

function setNodes(nodes: unknown[]) {
  STATE = { nodes, selectNode: SELECT_NODE, selectedNodeId: null }
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
