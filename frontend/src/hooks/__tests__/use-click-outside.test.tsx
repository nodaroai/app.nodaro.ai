import { describe, it, expect, vi } from "vitest"
import { render, fireEvent, screen } from "@testing-library/react"
import { useRef } from "react"
import { useClickOutside } from "../use-click-outside"

function Harness({ onOutside, enabled }: { onOutside: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, onOutside, enabled)
  return (
    <div>
      <div ref={ref} data-testid="inside">
        <button data-testid="inside-child">in</button>
      </div>
      <div data-testid="outside">out</div>
    </div>
  )
}

describe("useClickOutside", () => {
  it("calls onOutside on mousedown outside the ref", () => {
    const onOutside = vi.fn()
    render(<Harness onOutside={onOutside} />)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it("does NOT call onOutside on mousedown inside the ref (incl. descendants)", () => {
    const onOutside = vi.fn()
    render(<Harness onOutside={onOutside} />)
    fireEvent.mouseDown(screen.getByTestId("inside"))
    fireEvent.mouseDown(screen.getByTestId("inside-child"))
    expect(onOutside).not.toHaveBeenCalled()
  })

  it("does nothing when enabled=false", () => {
    const onOutside = vi.fn()
    render(<Harness onOutside={onOutside} enabled={false} />)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(onOutside).not.toHaveBeenCalled()
  })

  it("detaches the listener on unmount", () => {
    const onOutside = vi.fn()
    const { unmount } = render(<Harness onOutside={onOutside} />)
    unmount()
    fireEvent.mouseDown(document.body)
    expect(onOutside).not.toHaveBeenCalled()
  })

  it("re-attaches when enabled flips false → true", () => {
    const onOutside = vi.fn()
    const { rerender } = render(<Harness onOutside={onOutside} enabled={false} />)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(onOutside).not.toHaveBeenCalled()
    rerender(<Harness onOutside={onOutside} enabled={true} />)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(onOutside).toHaveBeenCalledTimes(1)
  })
})
