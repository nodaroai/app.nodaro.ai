// A picker without a drawn preview (Era, Composition Effects) gets an icon only
// when this deployment registered its renders. In a self-hosted edition nothing
// is registered and every icon slot of the app input card must keep showing the
// option's label — never an empty box.
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { LOOK_PREVIEW_SETS, registerLookPreviews, resetLookPreviewsForTests } from "@nodaro/picker-ui"
import { PickerInputCard, type PickerDisplayMode } from "../picker-input-card"

vi.mock("@/components/editor/locale-picker", () => ({ LocalePicker: () => null }))

afterEach(() => resetLookPreviewsForTests())

function renderEra(displayMode: PickerDisplayMode) {
  return render(
    <PickerInputCard
      nodeId="n1"
      label="Era"
      nodeType="era"
      data={{ era: "1920s-flapper" }}
      isFullscreen={false}
      inputValues={{}}
      onUpdateInput={() => {}}
      displayMode={displayMode}
    />,
  )
}

describe("PickerInputCard — Era icon slot", () => {
  it("self-hosted (modal): the chip shows the label, not an empty box", () => {
    const { container } = renderEra("modal")
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByRole("button", { name: /change era/i }).textContent).toMatch(/1920s Flapper/i)
  })

  it("self-hosted (inline): every grid tile's icon box shows the option's label", () => {
    const { container } = renderEra("inline")
    expect(container.querySelector("img")).toBeNull()
    const tiles = [...container.querySelectorAll("button[role=radio], button[role=checkbox]")]
    expect(tiles.length).toBeGreaterThan(0)
    // icon box (label fallback) + caption: the label appears twice per tile
    expect(tiles.every((t) => (t.textContent ?? "").length > 0 && t.querySelectorAll("div").length > 0)).toBe(true)
    const first = tiles[0]!
    const label = first.querySelector("div")?.textContent ?? ""
    expect(label.length).toBeGreaterThan(0)
  })

  it("self-hosted (compact): no empty icon slot beside the select", () => {
    const { container } = renderEra("compact")
    expect(container.querySelector("img")).toBeNull()
    const emptySlots = [...container.querySelectorAll("div.size-5, span.size-4")].filter((el) => el.childElementCount === 0 && !el.textContent)
    expect(emptySlots).toEqual([])
  })

  it.each<PickerDisplayMode>(["inline", "modal"])("cloud (%s): the render is shown", (mode) => {
    registerLookPreviews(LOOK_PREVIEW_SETS)
    const { container } = renderEra(mode)
    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img!.getAttribute("srcset")).toContain("cdn.nodaro.ai")
  })
})
