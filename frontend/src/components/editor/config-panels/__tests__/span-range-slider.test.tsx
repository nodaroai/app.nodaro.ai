import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { SpanRangeSlider } from "../span-range-slider"

/**
 * Mock the underlying Radix-backed `Slider` primitive so we can drive its
 * `onValueChange` directly and assert on `SpanRangeSlider`'s OWN
 * `handleChange` logic (the MIN_SPAN floor), without simulating real pointer
 * drags on Radix's DOM thumbs. Mirrors the `ui/slider` mocking style used in
 * provider-snap.test.tsx / ai-avatar-config.test.tsx, but exposes the
 * received props (rather than discarding them) since this test's whole point
 * is the wrapper's callback logic, not the rendered markup.
 */
let lastSliderProps: any = null
vi.mock("@/components/ui/slider", () => ({
  Slider: (props: any) => {
    lastSliderProps = props
    return null
  },
}))

describe("SpanRangeSlider", () => {
  it("floors a sub-minimum span to MIN_SPAN (4s) when only the end thumb moves", () => {
    const onChange = vi.fn()
    render(<SpanRangeSlider videoDuration={20} spanStart={0} spanEnd={8} onChange={onChange} />)
    // End thumb dragged to 2s, start unchanged at 0 -> raw pair [0, 2] is a
    // 2s span, below MIN_SPAN. nextStart === spanStart, so handleChange
    // re-anchors spanEnd to spanStart + MIN_SPAN instead of shrinking further.
    lastSliderProps.onValueChange([0, 2])
    expect(onChange).toHaveBeenCalledWith({ spanStart: 0, spanEnd: 4 })
  })

  it("re-anchors around the moved start thumb when the raw pair violates MIN_SPAN", () => {
    const onChange = vi.fn()
    render(<SpanRangeSlider videoDuration={20} spanStart={0} spanEnd={8} onChange={onChange} />)
    // Start thumb dragged to 7 -> raw pair [7, 8] is a 1s span. nextStart(7)
    // !== spanStart(0), so handleChange clamps the NEW start against
    // videoDuration - MIN_SPAN and re-derives spanEnd = start + MIN_SPAN.
    lastSliderProps.onValueChange([7, 8])
    expect(onChange).toHaveBeenCalledWith({ spanStart: 7, spanEnd: 11 })
  })

  it("passes through a valid (>= MIN_SPAN) span unchanged", () => {
    const onChange = vi.fn()
    render(<SpanRangeSlider videoDuration={20} spanStart={2} spanEnd={10} onChange={onChange} />)
    lastSliderProps.onValueChange([3, 9])
    expect(onChange).toHaveBeenCalledWith({ spanStart: 3, spanEnd: 9 })
  })

  it("passes minStepsBetweenThumbs = MIN_SPAN / STEP (40) so Radix enforces the floor natively", () => {
    render(<SpanRangeSlider videoDuration={20} spanStart={0} spanEnd={8} onChange={vi.fn()} />)
    expect(lastSliderProps.minStepsBetweenThumbs).toBe(40)
  })

  it("max is at least MIN_SPAN even for a near-zero/degenerate videoDuration", () => {
    render(<SpanRangeSlider videoDuration={0} spanStart={0} spanEnd={0} onChange={vi.fn()} />)
    expect(lastSliderProps.max).toBe(4)
  })
})
