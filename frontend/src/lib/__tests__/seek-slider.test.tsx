import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { seekSlider } from "../seek-slider"
import { pressable } from "../pressable"

/**
 * A click-to-seek bar is a keyboard slider (WCAG 2.1.1, 4.1.2); a pressable
 * element hands the activating event to its handler, from the keyboard too.
 */

afterEach(cleanup)

function Bar({ fraction, onSeek }: { fraction: number; onSeek: (f: number) => void }) {
  return <div {...seekSlider({ label: "Position", fraction, onSeek })} />
}

describe("seekSlider", () => {
  it("is a named slider that reports its position", () => {
    render(<Bar fraction={0.25} onSeek={vi.fn()} />)
    const s = screen.getByRole("slider", { name: "Position" })
    expect(s.tabIndex).toBe(0)
    expect(s).toHaveAttribute("aria-valuenow", "25")
  })

  it("moves with the arrows, PageUp/Down and Home/End, inside 0..1", () => {
    const onSeek = vi.fn()
    render(<Bar fraction={0.5} onSeek={onSeek} />)
    const s = screen.getByRole("slider")
    for (const key of ["ArrowRight", "ArrowLeft", "PageUp", "Home", "End"]) fireEvent.keyDown(s, { key })
    expect(onSeek.mock.calls.map((c) => Number(c[0].toFixed(2)))).toEqual([0.55, 0.45, 0.6, 0, 1])
    fireEvent.keyDown(s, { key: "a" })
    expect(onSeek).toHaveBeenCalledTimes(5)
  })

  it("never seeks outside the bar", () => {
    const onSeek = vi.fn()
    render(<Bar fraction={1} onSeek={onSeek} />)
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" })
    expect(onSeek).toHaveBeenCalledWith(1)
  })
})

describe("pressable hands the event over", () => {
  it("from a key press, so a handler that stops propagation works", () => {
    const parent = vi.fn()
    render(
      <div onKeyDown={parent}>
        <div {...pressable((e) => e.stopPropagation())}>Open</div>
      </div>,
    )
    fireEvent.keyDown(screen.getByRole("button", { name: "Open" }), { key: "Enter" })
    expect(parent).not.toHaveBeenCalled()
  })
})
