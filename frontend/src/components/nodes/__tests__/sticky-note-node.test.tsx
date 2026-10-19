// @test-units-by-name looks up only the sticky-note definition (NODE_DEFINITIONS)
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { StickyNoteNode } from "../sticky-note-node"
import { INK, NODE_COLORS } from "@/lib/node-colors"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ type, position, id }: any) => (
      <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
    ),
    NodeResizer: () => null,
    NodeToolbar: ({ children, isVisible }: any) => isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  }
})

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={isRunning}>
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

const updateNodeDataMock = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: (...args: unknown[]) => updateNodeDataMock(...args),
    updateNode: () => {},
  }),
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Note", text: "", color: "#2d2d44" },
    selected: false,
    ...overrides,
  } as any
  return render(<StickyNoteNode {...defaultProps} />)
}

const body = () => screen.getByLabelText("Note body") as HTMLTextAreaElement
const title = () => screen.getByLabelText("Title") as HTMLInputElement

describe("StickyNoteNode", () => {
  it("renders a title field and a body field", () => {
    renderNode()
    expect(title()).toBeInTheDocument()
    expect(body()).toBeInTheDocument()
  })

  it("lays the note's own text out by its own direction (dir=auto on title and body)", () => {
    renderNode({ data: { label: "Note", title: "כותרת", text: "שלום עולם.", color: "#2d2d44" } })
    expect(title().getAttribute("dir")).toBe("auto")
    expect(body().getAttribute("dir")).toBe("auto")
  })

  it("leaves an empty note's fields to the UI direction, so the placeholder is not flipped", () => {
    renderNode()
    expect(title().getAttribute("dir")).toBeNull()
    expect(body().getAttribute("dir")).toBeNull()
  })

  it("renders the body with its placeholder", () => {
    renderNode()
    expect(screen.getByPlaceholderText("Write a note...")).toBe(body())
  })

  it("applies background color", () => {
    renderNode({ data: { label: "Note", text: "", color: "#ff6633" } })
    // The background color is on the note surface, the fields' parent.
    expect(body().parentElement).toHaveStyle({ backgroundColor: "#ff6633" })
  })

  // No ThemeProvider in tests -> resolvedTheme is undefined -> light mode.
  // The Welcome Demo seeds `#2d2d44`, which has no light-mode palette
  // counterpart, so the surface stays navy in light mode. The ink must
  // follow the surface, not the theme, or the note is slate-on-navy.
  it("keeps the note readable in light mode on a dark non-palette surface", () => {
    renderNode({ data: { label: "Note", text: "hello", color: "#2d2d44" } })
    expect(body()).toHaveStyle({ color: INK.light.text })
    expect(title()).toHaveStyle({ color: INK.light.text })
    expect(body().parentElement).toHaveStyle({ backgroundColor: "#2d2d44" })
  })

  it("uses dark ink on a light surface", () => {
    renderNode({ data: { label: "Note", text: "hello", color: "#f1f5f9" } })
    expect(body()).toHaveStyle({ color: INK.dark.text })
  })

  // The "paper" swatch: cream in light mode (dark ink), so a tutorial note
  // reads like a card, not a black block, on the light canvas.
  it("maps the paper swatch to cream with dark ink in light mode", () => {
    renderNode({ data: { label: "Note", text: "hello", color: "#26221a" } })
    expect(body().parentElement).toHaveStyle({ backgroundColor: "#f6eedc" })
    expect(body()).toHaveStyle({ color: INK.dark.text })
  })

  it("renders the title and body values, and writes both back", () => {
    renderNode({ data: { label: "Note", title: "Step 1", text: "Hello world", color: "#2d2d44" } })
    expect(title().value).toBe("Step 1")
    expect(body().value).toBe("Hello world")
    fireEvent.change(title(), { target: { value: "Step 2" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { title: "Step 2" })
    fireEvent.change(body(), { target: { value: "Bye" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { text: "Bye" })
  })

  it("shows toolbar when selected", () => {
    renderNode({ selected: true })
    // NodeToolbar renders when selected; Heading/Paragraph toggle is visible
    expect(screen.getByText("Paragraph")).toBeInTheDocument()
  })

  it("hides toolbar when not selected", () => {
    renderNode({ selected: false })
    // NodeToolbar is not rendered when not selected and not hovered
    expect(screen.queryByText("Paragraph")).not.toBeInTheDocument()
  })

  it("offers every palette swatch (named, not hex-spoken) plus a free colour well", () => {
    renderNode({ selected: true })
    const names = ["Slate", "Blue", "Green", "Pink", "Purple", "Cyan", "Paper"]
    expect(names).toHaveLength(NODE_COLORS.length)
    for (const name of names) expect(screen.getByLabelText(name)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Paper"))
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { color: "#26221a" })
    const well = screen.getByLabelText("Custom colour") as HTMLInputElement
    expect(well.type).toBe("color")
    fireEvent.change(well, { target: { value: "#123456" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { color: "#123456" })
  })

  it("applies font size", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", fontSize: "lg" } })
    expect(body()).toHaveStyle({ fontSize: "18px" })
  })

  // Each declared size must render a DISTINCT px value, and the title sits
  // one step above its body. base and lg are pinned to their historical
  // values so existing notes are untouched.
  it.each([
    ["sm", "12px", "14px"],
    ["base", "14px", "17px"],
    ["lg", "18px", "22px"],
    ["xl", "26px", "30px"],
  ])("renders %s body at %s and title at %s", (size, px, titlePx) => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", fontSize: size } })
    expect(body()).toHaveStyle({ fontSize: px })
    expect(title()).toHaveStyle({ fontSize: titlePx })
  })

  it("falls back to the default size when fontSize is missing or unknown", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44" } })
    expect(body()).toHaveStyle({ fontSize: "14px" })
  })

  it("labels the size control by the current size", () => {
    renderNode({ selected: true, data: { label: "Note", text: "", color: "#2d2d44", fontSize: "xl" } })
    expect(screen.getByText("Display")).toBeInTheDocument()
  })

  it("gives 18px and up the heavier heading weight", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", fontSize: "xl" } })
    expect(body()).toHaveStyle({ fontWeight: 600 })
  })

  it("applies bold style", () => {
    renderNode({ data: { label: "Note", text: "", color: "#2d2d44", bold: true } })
    expect(body()).toHaveStyle({ fontWeight: 700 })
  })

  it("renders the 3-dots More options button when selected", () => {
    renderNode({ selected: true })
    expect(screen.getByLabelText("More options")).toBeInTheDocument()
  })

  it("dispatches open-node-context-menu when the 3-dots button is clicked", () => {
    const handler = vi.fn()
    window.addEventListener("open-node-context-menu", handler)
    renderNode({ selected: true })
    fireEvent.click(screen.getByLabelText("More options"))
    window.removeEventListener("open-node-context-menu", handler)
    expect(handler).toHaveBeenCalledTimes(1)
    const evt = handler.mock.calls[0][0] as CustomEvent
    expect(evt.detail.nodeId).toBe("node-1")
  })
})

/**
 * Alignment: new notes default to logical "start" (follows the text's own
 * direction). A stored "left" is the OLD default unless `alignmentChosen`
 * records that the user picked it; center/right were never a default.
 */
describe("StickyNoteNode alignment", () => {
  const base = { label: "Note", color: "#2d2d44" }
  const alignButton = (name: "Left" | "Center" | "Right") => screen.getByRole("button", { name })

  it("a note with no alignment renders start, and a Hebrew note lights Right", () => {
    renderNode({ selected: true, data: { ...base, text: "שלום עולם." } })
    expect(body().style.textAlign).toBe("start")
    expect(title().style.textAlign).toBe("start")
    expect(alignButton("Right").getAttribute("aria-pressed")).toBe("true")
    expect(alignButton("Left").getAttribute("aria-pressed")).toBe("false")
  })

  it("an existing note saved with the old implicit left renders start, so a Hebrew note sits right", () => {
    renderNode({ selected: true, data: { ...base, text: "שלום עולם.", alignment: "left" } })
    expect(body().style.textAlign).toBe("start")
    expect(alignButton("Right").getAttribute("aria-pressed")).toBe("true")
  })

  it("the same old-default note in English renders start and lights Left", () => {
    renderNode({ selected: true, data: { ...base, text: "Hello there.", alignment: "left" } })
    expect(body().style.textAlign).toBe("start")
    expect(alignButton("Left").getAttribute("aria-pressed")).toBe("true")
  })

  it("an explicitly chosen left stays left, even on a Hebrew note", () => {
    renderNode({ selected: true, data: { ...base, text: "שלום עולם.", alignment: "left", alignmentChosen: true } })
    expect(body().style.textAlign).toBe("left")
    expect(alignButton("Left").getAttribute("aria-pressed")).toBe("true")
  })

  it.each(["center", "right"] as const)("a stored %s is always honoured", (alignment) => {
    renderNode({ selected: true, data: { ...base, text: "Hello.", alignment } })
    expect(body().style.textAlign).toBe(alignment)
  })

  it("picking an alignment records it as an explicit choice", () => {
    updateNodeDataMock.mockClear()
    renderNode({ selected: true, data: { ...base, text: "שלום" } })
    fireEvent.click(alignButton("Left"))
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { alignment: "left", alignmentChosen: true })
  })

  it("the note definition defaults new notes to start", async () => {
    const { NODE_DEFINITIONS } = await import("@/types/nodes")
    const def = NODE_DEFINITIONS.find((d) => d.type === "sticky-note")!
    expect((def.defaultData as { alignment?: string }).alignment).toBe("start")
    expect((def.defaultData as { alignmentChosen?: boolean }).alignmentChosen).toBeUndefined()
  })
})
