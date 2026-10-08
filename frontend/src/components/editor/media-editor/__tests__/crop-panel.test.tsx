/**
 * CropPanel's drag behaviour, pinned at the component boundary.
 *
 * Written against the component as it stood BEFORE its handle math moved into
 * `rect-handles.ts` (Speaker View's region editor shares it), and kept
 * unchanged across that extraction: whatever the region editor needs, the
 * media editor's crop must behave byte for byte as it did.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, fireEvent, act } from "@testing-library/react"
import { CropPanel } from "../crop-panel"
import type { CropState } from "../utils"

const DISPLAY = { width: 400, height: 300 }

const realRO = globalThis.ResizeObserver
beforeEach(() => {
  // A stage with a real size (the setup polyfill never reports one).
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { this.cb([{ contentRect: DISPLAY } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => { globalThis.ResizeObserver = realRO })

const rect = (x: number, y: number, width: number, height: number): CropState => ({ x, y, width, height, zoom: 1, panX: 0, panY: 0 })

function mount(opts: { crop?: CropState | null; aspectRatio?: string; onAspectRatioChange?: (r: string) => void } = {}) {
  const onCropChange = vi.fn()
  const onDisplaySizeChange = vi.fn()
  const utils = render(
    <CropPanel
      mediaUrl="https://x/a.png"
      mediaType="image"
      naturalWidth={800}
      naturalHeight={600}
      aspectRatio={opts.aspectRatio ?? "custom"}
      crop={opts.crop === undefined ? rect(100, 50, 200, 150) : opts.crop}
      onCropChange={onCropChange}
      onDisplaySizeChange={onDisplaySizeChange}
      onAspectRatioChange={opts.onAspectRatioChange}
    />,
  )
  return { ...utils, onCropChange, onDisplaySizeChange }
}

/** The element a drag of `type` starts on: the box itself, or one of its 8 handles. */
function target(container: HTMLElement, type: string): HTMLElement {
  const cursor = type === "move" ? "move" : `${type}-resize`
  const el = Array.from(container.querySelectorAll<HTMLElement>("div")).find((d) => d.style.cursor === cursor)
  if (!el) throw new Error(`no element for ${type}`)
  return el
}

function drag(container: HTMLElement, type: string, dx: number, dy: number, how: "mouse" | "touch" = "mouse") {
  const el = target(container, type)
  if (how === "mouse") {
    fireEvent.mouseDown(el, { clientX: 500, clientY: 500 })
    act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500 + dx, clientY: 500 + dy })) })
    act(() => { window.dispatchEvent(new MouseEvent("mouseup")) })
  } else {
    fireEvent.touchStart(el, { touches: [{ clientX: 500, clientY: 500 }] })
    act(() => {
      const ev = new Event("touchmove", { cancelable: true }) as TouchEvent
      Object.defineProperty(ev, "touches", { value: [{ clientX: 500 + dx, clientY: 500 + dy }] })
      window.dispatchEvent(ev)
    })
    act(() => { window.dispatchEvent(new Event("touchend")) })
  }
}

const lastCrop = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as CropState

describe("CropPanel — sizing", () => {
  it("reports the displayed size and starts a missing crop at the whole picture", () => {
    const { onCropChange, onDisplaySizeChange } = mount({ crop: null })
    expect(onDisplaySizeChange).toHaveBeenCalledWith(400, 300)
    expect(onCropChange).toHaveBeenCalledWith(rect(0, 0, 400, 300))
  })

  it("renders nothing without natural dimensions", () => {
    const { container } = render(
      <CropPanel mediaUrl="u" mediaType="image" naturalWidth={0} naturalHeight={0} aspectRatio="custom" crop={null} onCropChange={vi.fn()} />,
    )
    expect(container.innerHTML).toBe("")
  })
})

describe("CropPanel — the 8 handles and the box", () => {
  it("draws the handles at these offsets with these cursors", () => {
    const { container } = mount()
    const handles = Array.from(container.querySelectorAll<HTMLElement>("div.rounded-full")).map((d) => ({
      cursor: d.style.cursor,
      top: d.style.top,
      bottom: d.style.bottom,
      left: d.style.left,
      right: d.style.right,
      marginLeft: d.style.marginLeft,
      marginTop: d.style.marginTop,
    }))
    expect(handles).toEqual([
      { cursor: "nw-resize", top: "-8px", bottom: "", left: "-8px", right: "", marginLeft: "", marginTop: "" },
      { cursor: "ne-resize", top: "-8px", bottom: "", left: "", right: "-8px", marginLeft: "", marginTop: "" },
      { cursor: "sw-resize", top: "", bottom: "-8px", left: "-8px", right: "", marginLeft: "", marginTop: "" },
      { cursor: "se-resize", top: "", bottom: "-8px", left: "", right: "-8px", marginLeft: "", marginTop: "" },
      { cursor: "n-resize", top: "-8px", bottom: "", left: "50%", right: "", marginLeft: "-8px", marginTop: "" },
      { cursor: "s-resize", top: "", bottom: "-8px", left: "50%", right: "", marginLeft: "-8px", marginTop: "" },
      { cursor: "e-resize", top: "50%", bottom: "", left: "", right: "-8px", marginLeft: "", marginTop: "-8px" },
      { cursor: "w-resize", top: "50%", bottom: "", left: "-8px", right: "", marginLeft: "", marginTop: "-8px" },
    ])
  })

  it("moves the box, kept inside the picture", () => {
    const { container, onCropChange } = mount()
    drag(container, "move", 30, -20)
    expect(lastCrop(onCropChange)).toEqual(rect(130, 30, 200, 150))
    drag(container, "move", 900, 900)
    expect(lastCrop(onCropChange)).toEqual(rect(200, 150, 200, 150))
    drag(container, "move", -900, -900)
    expect(lastCrop(onCropChange)).toEqual(rect(0, 0, 200, 150))
  })

  it.each([
    ["e", 40, 0, rect(100, 50, 240, 150)],
    ["w", 40, 0, rect(140, 50, 160, 150)],
    ["s", 0, 30, rect(100, 50, 200, 180)],
    ["n", 0, 30, rect(100, 80, 200, 120)],
  ])("an edge (%s) resizes freely", (type, dx, dy, want) => {
    const { container, onCropChange } = mount()
    drag(container, type, dx, dy)
    expect(lastCrop(onCropChange)).toEqual(want)
  })

  it.each([
    // The start box is 4:3; a corner keeps the START ratio whatever the drag.
    ["se", 80, 0, rect(100, 50, 200, 150)],
    ["se", 80, 60, rect(100, 50, 280, 210)],
    ["nw", -40, -30, rect(60, 20, 240, 180)],
    ["ne", 40, 0, rect(100, 50, 200, 150)],
    ["sw", -40, 30, rect(60, 50, 240, 180)],
  ])("a corner (%s, %d, %d) keeps the box's own ratio", (type, dx, dy, want) => {
    const { container, onCropChange } = mount()
    drag(container, type, dx, dy)
    expect(lastCrop(onCropChange)).toEqual(want)
  })

  it("never shrinks below 20 px nor grows past the picture", () => {
    const { container, onCropChange } = mount()
    drag(container, "e", -500, 0)
    expect(lastCrop(onCropChange)).toEqual(rect(100, 50, 20, 150))
    drag(container, "s", 0, 900)
    expect(lastCrop(onCropChange)).toEqual(rect(100, 0, 200, 300))
    drag(container, "w", -500, 0)
    expect(lastCrop(onCropChange)).toEqual(rect(0, 50, 400, 150))
  })

  it("an edge drag flips a fixed ratio to custom; a corner or move does not", () => {
    const onAspectRatioChange = vi.fn()
    const { container } = mount({ aspectRatio: "4:3", onAspectRatioChange })
    drag(container, "move", 5, 5)
    drag(container, "se", 10, 10)
    expect(onAspectRatioChange).not.toHaveBeenCalled()
    drag(container, "e", 10, 0)
    expect(onAspectRatioChange).toHaveBeenCalledTimes(1)
    expect(onAspectRatioChange).toHaveBeenCalledWith("custom")
  })

  it("an edge drag under custom does not report a ratio change", () => {
    const onAspectRatioChange = vi.fn()
    const { container } = mount({ aspectRatio: "custom", onAspectRatioChange })
    drag(container, "e", 10, 0)
    expect(onAspectRatioChange).not.toHaveBeenCalled()
  })

  it("follows a touch drag the same way", () => {
    const { container, onCropChange } = mount()
    drag(container, "move", 30, -20, "touch")
    expect(lastCrop(onCropChange)).toEqual(rect(130, 30, 200, 150))
    drag(container, "se", 80, 60, "touch")
    expect(lastCrop(onCropChange)).toEqual(rect(100, 50, 280, 210))
  })

  it("stops following the pointer once it is released", () => {
    const { container, onCropChange } = mount()
    drag(container, "move", 10, 10)
    const calls = onCropChange.mock.calls.length
    act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 900, clientY: 900 })) })
    expect(onCropChange.mock.calls.length).toBe(calls)
  })
})

describe("CropPanel — a ratio chosen after the box was drawn", () => {
  it("re-fits the box to the new ratio, inside the picture", () => {
    const onCropChange = vi.fn()
    const props = {
      mediaUrl: "u", mediaType: "image" as const, naturalWidth: 800, naturalHeight: 600,
      crop: rect(100, 50, 200, 150), onCropChange,
    }
    const { rerender } = render(<CropPanel {...props} aspectRatio="custom" />)
    onCropChange.mockClear()
    rerender(<CropPanel {...props} aspectRatio="1:1" />)
    expect(lastCrop(onCropChange)).toEqual(rect(100, 50, 150, 150))
    rerender(<CropPanel {...props} aspectRatio="original" />)
    // 4:3 already: within tolerance, untouched.
    expect(onCropChange).toHaveBeenCalledTimes(1)
  })
})
