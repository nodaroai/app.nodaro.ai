// The character-limit lever on the shape a published speech app usually has:
// a Text node exposed WHOLE (it has no field list to expand), feeding Text to
// Speech. The limit lives on the `node` item and reaches the app's price
// through the estimator's one-hop rule, so the author must be able to set it
// here — not only on a `field` card.
import { describe, expect, it, beforeEach, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NodePickerDialog } from "../node-picker-dialog"

vi.setConfig({ testTimeout: 20000 })

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data })

function seed(inputItems: unknown[] | undefined, extraNodes: ReturnType<typeof node>[] = []) {
  useWorkflowStore.setState({
    nodes: [node("s", "text-prompt", { label: "Script", text: "hello", presentationInput: true }), ...extraNodes] as never,
    presentationSettings: { ...(inputItems ? { inputItems } : {}) } as never,
  })
}

const items = () => (useWorkflowStore.getState().presentationSettings as { inputItems?: Array<Record<string, unknown>> }).inputItems

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [], presentationSettings: {} as never })
})

describe("the Text node's character limit in the exposing dialog", () => {
  it("offers a limit box on an exposed Text node and writes it on the node item", () => {
    seed([{ type: "node", nodeId: "s" }])
    render(<NodePickerDialog open onOpenChange={() => {}} section="inputs" />)
    const box = screen.getByLabelText("Maximum characters")
    fireEvent.change(box, { target: { value: "800" } })
    expect(items()).toEqual([{ type: "node", nodeId: "s", maxLength: 800 }])
  })

  it("shows the stored limit, and emptying the box removes it", () => {
    seed([{ type: "node", nodeId: "s", maxLength: 300 }])
    render(<NodePickerDialog open onOpenChange={() => {}} section="inputs" />)
    const box = screen.getByLabelText("Maximum characters") as HTMLInputElement
    expect(box.value).toBe("300")
    fireEvent.change(box, { target: { value: "" } })
    expect(items()).toEqual([{ type: "node", nodeId: "s" }])
  })

  it("a value that is not a whole number of at least 1 is no limit", () => {
    seed([{ type: "node", nodeId: "s", maxLength: 300 }])
    render(<NodePickerDialog open onOpenChange={() => {}} section="inputs" />)
    fireEvent.change(screen.getByLabelText("Maximum characters"), { target: { value: "0" } })
    expect(items()).toEqual([{ type: "node", nodeId: "s" }])
  })

  it("an app still on the implicit inputs (no item list yet) gets its list seeded, the other exposed nodes kept", () => {
    seed(undefined, [node("u", "upload-image", { label: "Photo", presentationInput: true })])
    render(<NodePickerDialog open onOpenChange={() => {}} section="inputs" />)
    fireEvent.change(screen.getByLabelText("Maximum characters"), { target: { value: "500" } })
    expect(items()).toEqual([
      { type: "node", nodeId: "s", maxLength: 500 },
      { type: "node", nodeId: "u" },
    ])
  })

  it("offers no limit box on a node that is not text, nor in the outputs list", () => {
    seed([{ type: "node", nodeId: "u" }], [node("u", "upload-image", { label: "Photo", presentationInput: true })])
    useWorkflowStore.setState({ nodes: [node("u", "upload-image", { label: "Photo", presentationInput: true })] as never })
    render(<NodePickerDialog open onOpenChange={() => {}} section="inputs" />)
    expect(screen.queryByLabelText("Maximum characters")).toBeNull()
  })
})
