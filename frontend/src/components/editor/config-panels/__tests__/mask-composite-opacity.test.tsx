/**
 * Mask Composite's Opacity slider: shown as a percent (0–100), stored 0–1 —
 * the unit the route, the worker and both engines read.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MASK_COMPOSITE_DEFAULTS } from "@nodaro/shared/media"
import { MaskCompositeConfig } from "../mask-composite-config"
import type { MaskCompositeData } from "@/types/nodes"

const data = (overrides: Partial<MaskCompositeData> = {}): MaskCompositeData =>
  ({ label: "Mask Composite", ...MASK_COMPOSITE_DEFAULTS, fieldMappings: {}, ...overrides }) as MaskCompositeData

describe("MaskCompositeConfig — Opacity", () => {
  it("shows the stored 0–1 value as a percent", () => {
    render(<MaskCompositeConfig data={data({ opacity: 0.85 })} onUpdate={vi.fn()} />)
    expect(screen.getByText("Opacity: 85%")).toBeTruthy()
    expect((screen.getByLabelText("Opacity: 85%") as HTMLInputElement).value).toBe("85")
  })

  it("defaults to 100% for a node that never set it", () => {
    const { opacity: _o, ...withoutOpacity } = data()
    render(<MaskCompositeConfig data={withoutOpacity as MaskCompositeData} onUpdate={vi.fn()} />)
    expect(screen.getByText("Opacity: 100%")).toBeTruthy()
  })

  it("stores the slider's percent as 0–1", () => {
    const onUpdate = vi.fn()
    render(<MaskCompositeConfig data={data()} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText("Opacity: 100%"), { target: { value: "40" } })
    expect(onUpdate).toHaveBeenCalledWith({ opacity: 0.4 })
  })
})
