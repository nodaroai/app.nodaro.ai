import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, fireEvent } from "@testing-library/react"

// AnimatedFlowEdge pulls BaseEdge / EdgeLabelRenderer / the path helpers /
// useStore from @xyflow/react. We mock the whole module to exactly the surface
// the component touches: BaseEdge becomes a real <path> carrying the computed
// `style` + `path` (so the inert-stroke / dash / opacity logic is observable),
// EdgeLabelRenderer is a passthrough, the path helpers return a deterministic
// tuple, and useStore feeds a zoom of 1. This isolates the styling decision
// this task changed from React Flow's internal edge/node registration. Mocking
// (rather than a real ReactFlowProvider) avoids the real BaseEdge's
// useInternalNode + registered-edge-in-store requirements, which a bare
// provider can't supply for a standalone edge rendered outside <ReactFlow>.
const FAKE_PATH = "M0,0 L10,10"
vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ path, style, id }: any) => (
    <path data-testid="base-edge" data-edge-id={id} d={path} style={style} />
  ),
  // The real EdgeLabelRenderer portals children OUT of the <svg> into an HTML
  // overlay div, so a passthrough fragment is the faithful, namespace-safe stub
  // (a literal <div> here would be invalid inside our SVG-namespaced container).
  EdgeLabelRenderer: ({ children }: any) => <>{children}</>,
  getBezierPath: () => [FAKE_PATH, 5, 5],
  getSmoothStepPath: () => [FAKE_PATH, 5, 5],
  useStore: (sel: any) => sel({ transform: [0, 0, 1] }),
}))

// Zustand store — the edge only reads deleteEdge / updateEdgeData / hoveredEdgeId.
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) =>
    selector({
      deleteEdge: () => {},
      updateEdgeData: () => {},
      hoveredEdgeId: null,
    }),
}))

// describeEdgeBehavior is only used for the (label-gated) Radix tooltip text;
// parseListExpression for the list-mode config. Stub both, but over the REAL
// module — the i18n layer the edge now renders through reads LANGUAGES from it.
vi.mock("@nodaro/shared/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/workflow")>()),
  describeEdgeBehavior: () => "behavior",
  parseListExpression: () => ({ ok: true }),
}))

vi.mock("../workflow-editor/use-edge-insert-animation", () => ({
  useEdgeInsertAnimation: () => ({ style: {} }),
}))

import { AnimatedFlowEdge } from "../animated-flow-edge"
import { edgeModeMenu } from "../edge-mode-menu"

type EdgeData = Record<string, unknown>

afterEach(() => cleanup())

function renderEdge(opts: { data?: EdgeData; selected?: boolean; style?: Record<string, unknown> } = {}) {
  const { data, selected = false, style = { stroke: "#888888", strokeWidth: 2 } } = opts
  // Edges render their <path>/<title> children inside React Flow's <svg>. Render
  // into an SVG-namespaced container so the SVG namespace is correct — otherwise
  // jsdom parses the <title> as HTML metadata and drops it from inside <path>.
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  document.body.appendChild(svg)
  return render(
    <AnimatedFlowEdge
      // EdgeProps — only the fields the component reads matter here.
      id="e1"
      source="a"
      target="b"
      sourceX={0}
      sourceY={0}
      targetX={100}
      targetY={0}
      sourcePosition={"right" as any}
      targetPosition={"left" as any}
      style={style as any}
      data={data as any}
      selected={selected}
      {...({} as any)}
    />,
    { container: svg as unknown as HTMLElement },
  )
}

describe("AnimatedFlowEdge — unused prompt edge", () => {
  it("renders the inert (gray + dashed + dimmed) style when unusedPromptRef is set", () => {
    const { getByTestId } = renderEdge({ data: { unusedPromptRef: true } })
    const edge = getByTestId("base-edge")
    expect(edge.style.stroke).toBe("var(--muted-foreground)")
    expect(edge.style.strokeDasharray).toBe("6 4")
    expect(edge.style.opacity).toBe("0.5")
  })

  it("renders a native tooltip <title> explaining the disabled state", () => {
    const { container } = renderEdge({ data: { unusedPromptRef: true } })
    const title = container.querySelector("title")
    expect(title).not.toBeNull()
    expect(title?.textContent).toBe("Not referenced in the prompt")
    // The tooltip hangs off a wide transparent hover target, not the base edge.
    const hoverTarget = title?.closest("path")
    expect(hoverTarget?.getAttribute("stroke")).toBe("transparent")
    expect(hoverTarget?.getAttribute("stroke-width")).toBe("12")
  })

  it("lets selection override the inert style (pink select stroke wins)", () => {
    const { getByTestId } = renderEdge({ data: { unusedPromptRef: true }, selected: true })
    const edge = getByTestId("base-edge")
    expect(edge.style.stroke).toBe("#ff0073")
    // Selected edges are fully opaque even when inert, so the user can find them.
    expect(edge.style.opacity).toBe("1")
    // ...but the dashed pattern is still applied (it's not selection-gated).
    expect(edge.style.strokeDasharray).toBe("6 4")
  })

  it("keeps disabledByProvider inert (unchanged behavior)", () => {
    const { getByTestId } = renderEdge({ data: { disabledByProvider: true } })
    const edge = getByTestId("base-edge")
    expect(edge.style.stroke).toBe("var(--muted-foreground)")
    expect(edge.style.strokeDasharray).toBe("6 4")
    expect(edge.style.opacity).toBe("0.5")
  })

  it("renders the normal style (no dash, base stroke) when neither flag is set", () => {
    const { getByTestId, container } = renderEdge({ data: {} })
    const edge = getByTestId("base-edge")
    expect(edge.style.stroke).toBe("#888888")
    // jsdom serializes an unset CSS prop as the empty string.
    expect(edge.style.strokeDasharray).toBe("")
    // Idle wires sit at 0.9 so nodes stay the loudest thing on the canvas;
    // only selection / hover lift an edge to full strength.
    expect(edge.style.opacity).toBe("0.9")
    // No unused-prompt hover target / tooltip for a normal edge.
    expect(container.querySelector("title")).toBeNull()
  })
})

describe("AnimatedFlowEdge — the mode menu of a wire from a list pip", () => {
  /** The mode options the menu offers once opened. */
  function openMenu(data: EdgeData) {
    const view = renderEdge({ data, selected: true })
    fireEvent.click(view.getByLabelText("Change output mode"))
    const options = ["Selected", "Item", "Each", "Bundle"].filter((label) => view.queryByText(label) !== null)
    return { options }
  }

  it("a node unit's list pip (sourceListPip): Selected hidden, Each the default, Bundle offered into a node that takes several", () => {
    const { options } = openMenu({ sourceNodeType: "fixture-layers", sourceListPip: true, targetNodeType: "generate-image", edgeModeLabel: "each" })
    expect(options).toEqual(["Item", "Each", "Bundle"])
  })

  it("the same node's other pips are not list-like: Selected stays, Bundle only into a node that takes several", () => {
    expect(openMenu({ sourceNodeType: "fixture-layers", targetNodeType: "upscale-image", edgeModeLabel: "selected" }).options).toEqual(["Selected", "Item", "Each"])
    expect(openMenu({ sourceNodeType: "fixture-layers", sourceListPip: true, targetNodeType: "upscale-image", edgeModeLabel: "each" }).options).toEqual(["Item", "Each"])
  })

  it("a node unit's list pip into Image Collage: Each the default, Bundle offered", () => {
    expect(openMenu({ sourceNodeType: "fixture-layers", sourceListPip: true, targetNodeType: "image-collage", edgeModeLabel: "each" }).options).toEqual(["Item", "Each", "Bundle"])
  })

  it("every other source into Image Collage keeps its menu: no Bundle", () => {
    expect(openMenu({ sourceNodeType: "list", targetNodeType: "image-collage", edgeModeLabel: "each" }).options).toEqual(["Item", "Each"])
    expect(openMenu({ sourceNodeType: "generate-image", targetNodeType: "image-collage", edgeModeLabel: "selected" }).options).toEqual(["Selected", "Item", "Each"])
    // The unit's other pips (its take, its JSON) are not list pips.
    expect(openMenu({ sourceNodeType: "fixture-layers", targetNodeType: "image-collage", edgeModeLabel: "selected" }).options).toEqual(["Selected", "Item", "Each"])
  })
})

describe("edgeModeMenu — Bundle into Image Collage is a unit list pip's alone", () => {
  // The targets that take several items in one run (the menu's MULTI_INPUT_TARGET_TYPES), Image
  // Collage, and a spread of single-input targets — every one checked from each source below.
  const MULTI = [
    "generate-image", "edit-image", "image-to-image", "modify-image", "mix-audio", "combine-audio", "suno-mashup",
    "combine-videos", "slideshow", "manual-edit", "composite", "combine-text", "list",
    "instagram-post", "tiktok-post", "facebook-post", "x-post", "linkedin-post",
  ]
  const SINGLE = ["upscale-image", "remove-background", "image-overlay", "generate-video", "image-to-video", "llm-chat", "extract-field", "filter-list"]
  const TARGETS = [...MULTI, "image-collage", ...SINGLE]
  // Sources that are not a unit list pip: list-like by type, list operators, a time splitter, a search, plain media.
  const OTHER_SOURCES = ["list", "split-text", "split-media", "filter-list", "sort-list", "social-search", "generate-image", "upload-image", "fixture-layers"]
  const pip = (target: string) => edgeModeMenu({ sourceNodeType: "fixture-layers", sourceListPip: true, targetNodeType: target })

  it("a unit list pip is offered Bundle into exactly the several-item targets and Image Collage", () => {
    expect(TARGETS.filter((target) => pip(target).modes.includes("all"))).toEqual([...MULTI, "image-collage"])
  })

  it("into Image Collage: a unit list pip gains Bundle; no other source does", () => {
    expect(pip("image-collage")).toEqual({ modes: ["item", "each", "all"], defaultMode: "each" })
    for (const source of OTHER_SOURCES) {
      expect(edgeModeMenu({ sourceNodeType: source, targetNodeType: "image-collage" }).modes, source).not.toContain("all")
    }
    expect(edgeModeMenu({ sourceNodeType: "list", targetNodeType: "image-collage" })).toEqual({ modes: ["item", "each"], defaultMode: "each" })
    expect(edgeModeMenu({ sourceNodeType: "generate-image", targetNodeType: "image-collage" })).toEqual({ modes: ["last", "item", "each"], defaultMode: "last" })
  })

  it("everywhere but Image Collage, a unit list pip's menu is a List source's (the rule it had before)", () => {
    for (const target of TARGETS.filter((t) => t !== "image-collage")) {
      expect(pip(target), target).toEqual(edgeModeMenu({ sourceNodeType: "list", targetNodeType: target }))
    }
  })

  it("a unit list pip into a several-item target keeps Bundle; into a list column, Bundle is the default", () => {
    expect(pip("generate-image")).toEqual({ modes: ["item", "each", "all"], defaultMode: "each" })
    expect(pip("slideshow").modes).toContain("all")
    expect(pip("list")).toEqual({ modes: ["item", "all"], defaultMode: "all" })
  })
})
