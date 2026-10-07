// The character-limit lever on a Text to Speech node's OWN text (`directText`).
// The limit box is the one every exposed text field shows; what was missing is
// that the node offered no text field to expose, so an author could not set a
// limit on the text it speaks. The limit lives on the `field` item — the same
// store key the Text node's limit uses — and reaches the price and the run
// through the plumbing that already reads `<nodeId>:directText`.
import { describe, expect, it, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { NodePickerDialog } from "../node-picker-dialog"
import { ConfigFieldRenderer } from "../config-field-renderer"

vi.setConfig({ testTimeout: 20000 })

const tts = { id: "t", type: "text-to-speech", position: { x: 0, y: 0 }, data: { label: "Narration", textSource: "direct", directText: "hello", presentationInput: true } }

type Items = Array<Record<string, unknown>>
const items = () => (useWorkflowStore.getState().presentationSettings as { inputItems?: Items }).inputItems

function openTtsFields(inputItems: Items) {
  useWorkflowStore.setState({ nodes: [tts] as never, presentationSettings: { inputItems } as never })
  render(<NodePickerDialog open onOpenChange={() => {}} section="inputs" />)
  fireEvent.click(screen.getByLabelText("Expand fields"))
}

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [], presentationSettings: {} as never })
})

describe("the Text to Speech node's own text on the published-app card", () => {
  it("takes no more than the limit and counts against it, through the renderer the app runner uses", () => {
    render(<ConfigFieldRenderer nodeType="text-to-speech" field="directText" value={"a".repeat(40)} nodeData={tts.data} onChange={() => {}} maxLength={120} />)
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "120")
    expect(screen.getByTestId("field-char-count")).toHaveTextContent("40/120")
  })
})

describe("the Text to Speech node's own text in the exposing dialog", () => {
  it("is an exposable text field of the node", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "text-to-speech")
    expect(def?.exposableFields?.find((f) => f.key === "directText")).toMatchObject({ type: "text" })
  })

  it("offers the text as a field, and a limit box once it is exposed, written on the field item", () => {
    openTtsFields([{ type: "node", nodeId: "t" }])
    expect(screen.queryByLabelText("Maximum characters")).toBeNull()
    // the row's label wraps its checkbox, the field name and a "Text" type badge
    const row = screen.getAllByText("Text").map((el) => el.closest("label")).find((l): l is HTMLLabelElement => !!l && l.className.includes("cursor-pointer flex-1 min-w-0"))
    fireEvent.click(within(row as HTMLElement).getByRole("checkbox"))
    expect(items()?.find((i) => i.type === "field")).toMatchObject({ nodeId: "t", field: "directText" })
    fireEvent.change(screen.getByLabelText("Maximum characters"), { target: { value: "500" } })
    expect(items()?.find((i) => i.type === "field")).toMatchObject({ nodeId: "t", field: "directText", maxLength: 500 })
  })

  it("shows a stored limit, and emptying the box removes it", () => {
    openTtsFields([{ type: "node", nodeId: "t" }, { type: "field", id: "f1", nodeId: "t", field: "directText", maxLength: 300 }])
    const box = screen.getByLabelText("Maximum characters") as HTMLInputElement
    expect(box.value).toBe("300")
    fireEvent.change(box, { target: { value: "" } })
    expect(items()?.find((i) => i.type === "field")).not.toHaveProperty("maxLength")
  })
})
