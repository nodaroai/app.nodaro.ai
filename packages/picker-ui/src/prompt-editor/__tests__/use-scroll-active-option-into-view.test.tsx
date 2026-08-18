import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { useScrollActiveOptionIntoView } from "../use-scroll-active-option-into-view"

/**
 * Keyboard nav (ArrowUp/Down) in the suggestion popups updates the selected
 * index but the row can scroll out of the dropdown's viewport. This hook keeps
 * the active row visible. jsdom has no real scrollIntoView, so we stub it.
 */
function List({ selected }: { selected: number }) {
  const ref = useScrollActiveOptionIntoView<HTMLDivElement>(selected)
  return (
    <div ref={ref}>
      {[0, 1, 2].map((i) => (
        <button key={i} data-index={i}>{i}</button>
      ))}
    </div>
  )
}

describe("useScrollActiveOptionIntoView", () => {
  let spy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    spy = vi.fn()
    Element.prototype.scrollIntoView = spy as unknown as typeof Element.prototype.scrollIntoView
  })
  afterEach(cleanup)

  it("scrolls the active option into view when the selected index changes", () => {
    const { rerender } = render(<List selected={0} />)
    spy.mockClear()
    rerender(<List selected={2} />)
    expect(spy).toHaveBeenCalledWith({ block: "nearest" })
  })

  it("scrolls the element matching the selected data-index", () => {
    render(<List selected={1} />)
    // The spy is the prototype method; `this` is the element it was called on.
    const lastContext = spy.mock.contexts[spy.mock.contexts.length - 1] as HTMLElement
    expect(lastContext.getAttribute("data-index")).toBe("1")
  })
})
