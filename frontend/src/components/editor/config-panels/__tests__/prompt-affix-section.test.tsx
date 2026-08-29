import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PromptAffixSection } from "../prompt-affix-section"

// TipTap is heavy under jsdom — a textarea stand-in keeps the test about the section.
vi.mock("@/lib/picker-ui", () => ({
  PromptEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock("@/components/nodes/inline-node-prompt/use-prompt-editor-refs", () => ({
  usePromptEditorRefs: () => ({ referenceImages: [], nodeRefs: [], refMap: new Map(), promptSnippets: [] }),
}))

const base = { selectedNodeId: "n1", updateNodeData: vi.fn() }

describe("PromptAffixSection", () => {
  it("renders nothing for the plain Text node", () => {
    const { container } = render(<PromptAffixSection nodeType="text-prompt" nodeData={{}} {...base} />)
    expect(container).toBeEmptyDOMElement()
  })
  it("renders collapsed for an AI node, expands to two editors, writes both keys", () => {
    const updateNodeData = vi.fn()
    render(<PromptAffixSection nodeType="generate-image" nodeData={{}} selectedNodeId="n1" updateNodeData={updateNodeData} />)
    expect(screen.getByText("Pre & post text")).toBeInTheDocument()
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
    fireEvent.click(screen.getByTestId("prompt-affix-toggle"))
    const boxes = screen.getAllByRole("textbox")
    expect(boxes).toHaveLength(2)
    fireEvent.change(boxes[0], { target: { value: "PRE" } })
    expect(updateNodeData).toHaveBeenCalledWith("n1", { promptPrefix: "PRE" })
    fireEvent.change(boxes[1], { target: { value: "POST" } })
    expect(updateNodeData).toHaveBeenCalledWith("n1", { promptSuffix: "POST" })
  })
  it("shows a 'set' badge while collapsed when an affix is non-blank", () => {
    render(<PromptAffixSection nodeType="generate-video" nodeData={{ promptSuffix: "x" }} {...base} />)
    expect(screen.getByTestId("prompt-affix-badge")).toHaveTextContent("1 set")
  })
})
