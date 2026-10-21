/**
 * Mask Composite's Fill select: Video (default) / Pixelate / Blur at the top of
 * the panel; the Block size slider shows only for Pixelate, the Blur strength
 * slider only for Blur — both as a % of the video's width.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MASK_COMPOSITE_DEFAULTS } from "@nodaro/shared/media"
import { MaskCompositeConfig } from "../mask-composite-config"
import type { MaskCompositeData } from "@/types/nodes"

const data = (overrides: Partial<MaskCompositeData> = {}): MaskCompositeData =>
  ({ label: "Mask Composite", ...MASK_COMPOSITE_DEFAULTS, fieldMappings: {}, ...overrides }) as MaskCompositeData

describe("MaskCompositeConfig — Fill", () => {
  it("puts the Fill select first, on Video for a node that never set it, with neither fill slider", () => {
    const withoutFill: Partial<MaskCompositeData> = data()
    delete withoutFill.fill
    render(<MaskCompositeConfig data={withoutFill as MaskCompositeData} onUpdate={vi.fn()} />)
    const select = screen.getByRole("combobox", { name: "Fill" })
    expect(select.textContent).toContain("Video (the foreground)")
    // First control in the panel.
    expect(screen.getAllByRole("combobox")[0]).toBe(select)
    expect(screen.queryByText(/^Block size/)).toBeNull()
    expect(screen.queryByText(/^Blur strength/)).toBeNull()
  })

  it("Pixelate shows only the Block size slider (% of width), and stores its value", () => {
    const onUpdate = vi.fn()
    render(<MaskCompositeConfig data={data({ fill: "pixelate" })} onUpdate={onUpdate} />)
    expect(screen.getByRole("combobox", { name: "Fill" }).textContent).toContain("Pixelate")
    const slider = screen.getByLabelText("Block size (% of width): 1.25%") as HTMLInputElement
    expect(slider.min).toBe("0.2")
    expect(slider.max).toBe("10")
    expect(screen.queryByText(/^Blur strength/)).toBeNull()
    fireEvent.change(slider, { target: { value: "2.5" } })
    expect(onUpdate).toHaveBeenCalledWith({ pixelSizePct: 2.5 })
  })

  it("Blur shows only the Blur strength slider, and stores its value", () => {
    const onUpdate = vi.fn()
    render(<MaskCompositeConfig data={data({ fill: "blur" })} onUpdate={onUpdate} />)
    const slider = screen.getByLabelText("Blur strength (% of width): 2%") as HTMLInputElement
    expect(slider.min).toBe("0.1")
    expect(slider.max).toBe("5")
    expect(screen.queryByText(/^Block size/)).toBeNull()
    fireEvent.change(slider, { target: { value: "3.5" } })
    expect(onUpdate).toHaveBeenCalledWith({ blurStrengthPct: 3.5 })
  })

  it("Background fit and Audio show only for the Video fill (they do nothing for Pixelate / Blur)", () => {
    const { unmount } = render(<MaskCompositeConfig data={data({ fill: "video" })} onUpdate={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Background fit" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Audio" })).toBeTruthy()
    unmount()
    for (const fill of ["pixelate", "blur"] as const) {
      const r = render(<MaskCompositeConfig data={data({ fill })} onUpdate={vi.fn()} />)
      expect(screen.queryByRole("combobox", { name: "Background fit" })).toBeNull()
      expect(screen.queryByRole("combobox", { name: "Audio" })).toBeNull()
      r.unmount()
    }
  })

  it("Opacity stays available for every fill", () => {
    for (const fill of ["video", "pixelate", "blur"] as const) {
      const { unmount } = render(<MaskCompositeConfig data={data({ fill })} onUpdate={vi.fn()} />)
      expect(screen.getByText("Opacity: 100%")).toBeTruthy()
      unmount()
    }
  })
})
