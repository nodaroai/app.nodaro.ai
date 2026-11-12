// Split into Layers' panel: Max layers held to 1–99, the four sizes in order,
// the description with its live counter, and the hold line (credits on only).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { layerSplitHoldCreditId } from "@nodaro/render-rules"

const m = vi.hoisted(() => ({ credits: true, useModelCredits: vi.fn() }))
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/edition")>()), hasCredits: () => m.credits }))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: m.useModelCredits }))
vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      React.Children.forEach(children, (child: any) => {
        if (child?.type?.displayName === "SelectContent") React.Children.forEach(child.props?.children, (item: any) => { if (item) items.push(item) })
      })
      return <select role="combobox" value={value ?? ""} onChange={(e: any) => onValueChange?.(e.target.value)}>{items}</select>
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectContent" }),
    SelectItem: ({ children, value }: any) => <option value={value}>{typeof children === "string" ? children : value}</option>,
    SelectTrigger: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectTrigger" }),
    SelectValue: () => null,
  }
})

import { ConfigPanel } from "../config"
import { definition } from "../definition.generated"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const kit = { localizeNodeLabel: (label: string) => label }

function renderPanel(data: Record<string, unknown> = {}) {
  const onUpdate = vi.fn()
  render(<ConfigPanel data={{ ...definition.defaultData, ...data } as never} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]} kit={kit} nodeId="s1" />)
  return onUpdate
}

beforeEach(() => {
  m.credits = true
  m.useModelCredits.mockReset().mockImplementation((_id: string, fallback: number) => fallback)
})
afterEach(() => cleanup())

describe("split-into-layers config panel", () => {
  it("Max layers: 9 by default, bounded 1 to 99 — a number past either end is held to it", () => {
    const onUpdate = renderPanel()
    const field = screen.getByRole("spinbutton")
    expect((field as HTMLInputElement).value).toBe("9")
    expect(field.getAttribute("aria-valuemin")).toBe("1")
    expect(field.getAttribute("aria-valuemax")).toBe("99")
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: "150" } })
    fireEvent.blur(field)
    expect(onUpdate).toHaveBeenLastCalledWith({ maxLayers: 99 })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: "0" } })
    fireEvent.blur(field)
    expect(onUpdate).toHaveBeenLastCalledWith({ maxLayers: 1 })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: "24" } })
    fireEvent.blur(field)
    expect(onUpdate).toHaveBeenLastCalledWith({ maxLayers: 24 })
  })

  it("a stored value outside the range shows as the value a run sends", () => {
    renderPanel({ maxLayers: 400 })
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("99")
  })

  it("Size: 1K, 1.5K, 2K and Auto, in that order, 1K by default; picking one writes it", () => {
    const onUpdate = renderPanel()
    const select = screen.getByRole("combobox") as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(["1K", "1.5K", "2K", "auto"])
    expect([...select.options].map((o) => o.textContent)).toEqual(["1K", "1.5K", "2K", t("splitIntoLayers.sizeAuto")])
    expect(select.value).toBe("1K")
    fireEvent.change(select, { target: { value: "auto" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ size: "auto" })
  })

  it("What to separate: optional, at most 2,000 characters, with a live counter", () => {
    const onUpdate = renderPanel({ prompt: "the logo" })
    const box = screen.getByLabelText(t("splitIntoLayers.prompt")) as HTMLTextAreaElement
    expect(box.value).toBe("the logo")
    expect(box.maxLength).toBe(2000)
    expect(screen.getByTestId("split-layers-prompt-count").textContent).toBe("8 / 2000")
    fireEvent.change(box, { target: { value: "x".repeat(2500) } })
    expect(onUpdate).toHaveBeenLastCalledWith({ prompt: "x".repeat(2000) })
    cleanup()
    renderPanel()
    expect(screen.getByTestId("split-layers-prompt-count").textContent).toBe("0 / 2000")
    expect(screen.getByText(t("splitIntoLayers.promptHint", { bbox: "<bbox>x1 y1 x2 y2</bbox>" }))).toBeTruthy()
  })

  it("the hold line: the price of the most a run may return (Max layers plus the base, at the size's tier)", () => {
    renderPanel({ maxLayers: 20, size: "2K" })
    const id = layerSplitHoldCreditId(definition.type, { maxLayers: 20, size: "2K" })
    expect(m.useModelCredits).toHaveBeenCalledWith(id, (definition.priceRows as Record<string, number>)[id])
    const held = (definition.priceRows as Record<string, number>)[id]!
    expect(screen.getByText(t("splitIntoLayers.hold", { credits: held, layers: 20 }))).toBeTruthy()
  })

  it("no hold line when credits are off", () => {
    m.credits = false
    renderPanel()
    expect(screen.queryByText(/credits/)).toBeNull()
  })
})
