/**
 * A published app's "Video length" card: UGC Script's `targetDurationSec` exposed as a field.
 *
 * The card must exist (both app surfaces render a field item only when the node definition
 * describes the field: `findExposableField`), and it must write a NUMBER: the run reads the length
 * as a number (`ugcScriptBody` sends the default for anything else) and the app runner checks a
 * submitted value against the item's `allowedValues` by strict equality, so a "20" from a plain
 * select would be refused, or run at the default length.
 */
import { createContext, useContext } from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { UGC_SCRIPT_DEFAULT_TARGET_SEC, UGC_SCRIPT_MAX_TARGET_SEC, UGC_SCRIPT_MIN_TARGET_SEC } from "@nodaro/shared"
import type { WorkflowNode } from "@/types/nodes"
import { ConfigFieldRenderer } from "../config-field-renderer"
import { exposedFieldValue, findExposableField } from "../helpers"

// The Radix select as plain buttons: each item calls back with the string value it carries.
const SelectCtx = createContext<(v: string) => void>(() => {})
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <SelectCtx.Provider value={onValueChange}>
      <div data-testid="select" data-select-value={value}>{children}</div>
    </SelectCtx.Provider>
  ),
  SelectTrigger: ({ children, ...rest }: { children: React.ReactNode }) => <button type="button" {...rest}>{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
    const onPick = useContext(SelectCtx)
    return (
      <button type="button" data-item={value} onClick={() => onPick(value)}>
        {children}
      </button>
    )
  },
}))

const script = (data: Record<string, unknown> = {}) =>
  ({ id: "script", type: "ugc-script", position: { x: 0, y: 0 }, data: { label: "UGC Script", targetDurationSec: 15, keepResult: false, fieldMappings: {}, ...data } }) as unknown as WorkflowNode

function card(node: WorkflowNode, props: { allowedValues?: Array<string | number | boolean>; customLabel?: string; onChange?: (v: unknown) => void } = {}) {
  const field = findExposableField(node, "targetDurationSec")!
  return render(
    <ConfigFieldRenderer
      nodeType="ugc-script"
      field="targetDurationSec"
      value={exposedFieldValue(node, "targetDurationSec", undefined, field)}
      nodeData={node.data as Record<string, unknown>}
      onChange={props.onChange ?? vi.fn()}
      allowedValues={props.allowedValues}
      customLabel={props.customLabel}
    />,
  )
}

describe("UGC Script's length as an app input", () => {
  it("the node definition describes the field, so an app shows its card: the lengths UGC Script takes, from its default", () => {
    const field = findExposableField(script(), "targetDurationSec")
    expect(field).toMatchObject({
      key: "targetDurationSec",
      type: "slider",
      min: UGC_SCRIPT_MIN_TARGET_SEC,
      max: UGC_SCRIPT_MAX_TARGET_SEC,
      step: 1,
      defaultValue: UGC_SCRIPT_DEFAULT_TARGET_SEC,
    })
    // A node saved without the field starts the card at the length a run would use.
    expect(exposedFieldValue(script({ targetDurationSec: undefined }), "targetDurationSec", undefined, field!)).toBe(UGC_SCRIPT_DEFAULT_TARGET_SEC)
  })

  it("restricted to a few lengths: offers exactly those, shows the node's own, and writes the number picked", () => {
    const onChange = vi.fn()
    card(script(), { allowedValues: [15, 20, 25], customLabel: "Video length", onChange })
    expect(screen.getByText("Video length")).toBeInTheDocument()
    expect([...document.querySelectorAll("[data-item]")].map((b) => [b.getAttribute("data-item"), b.textContent])).toEqual([
      ["15", "15s"],
      ["20", "20s"],
      ["25", "25s"],
    ])
    expect(screen.getByTestId("select").getAttribute("data-select-value")).toBe("15")
    fireEvent.click(screen.getByText("20s"))
    expect(onChange).toHaveBeenCalledWith(20)
    expect(typeof onChange.mock.calls[0]![0]).toBe("number")
  })

  it("restricted, a length the node holds outside the list shows no choice rather than a wrong one", () => {
    card(script({ targetDurationSec: 30 }), { allowedValues: [15, 20, 25] })
    expect(screen.getByTestId("select").getAttribute("data-select-value")).toBe("")
  })

  it("unrestricted: a slider over the lengths UGC Script takes, writing a number", () => {
    const onChange = vi.fn()
    const { container } = card(script({ targetDurationSec: 20 }), { onChange })
    const range = container.querySelector<HTMLInputElement>('input[type="range"]')!
    expect([range.min, range.max, range.step, range.value]).toEqual([String(UGC_SCRIPT_MIN_TARGET_SEC), String(UGC_SCRIPT_MAX_TARGET_SEC), "1", "20"])
    fireEvent.change(range, { target: { value: "45" } })
    expect(onChange).toHaveBeenCalledWith(45)
    // Its own label when the app gives the card no title.
    expect(screen.getByText("Video length (seconds)")).toBeInTheDocument()
  })
})
