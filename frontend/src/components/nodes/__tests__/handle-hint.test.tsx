import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { HandleHint } from "../handle-hint"

beforeEach(() => {
  // jsdom defaults to fine pointer
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (q: string) => ({
      matches: q.includes("coarse") ? false : true,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

describe("HandleHint", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(
      <HandleHint visible={false} position={{ x: 0, y: 0 }} label="Fit" onClick={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the label when visible=true", () => {
    render(<HandleHint visible position={{ x: 100, y: 200 }} label="100%" onClick={() => {}} />)
    expect(screen.getByText("100%")).toBeTruthy()
  })

  it("positions the button at fixed screen coords with offset", () => {
    render(<HandleHint visible position={{ x: 100, y: 200 }} label="Fit" onClick={() => {}} />)
    // Button has `position: fixed` inline directly (no wrapper div) — see plan's component structure
    const btn = screen.getByText("Fit") as HTMLButtonElement
    expect(btn.style.position).toBe("fixed")
    expect(btn.style.left).toMatch(/\d+px/)
    expect(btn.style.top).toMatch(/\d+px/)
  })

  it("calls onClick and stops propagation", () => {
    const onClick = vi.fn()
    render(<HandleHint visible position={{ x: 0, y: 0 }} label="Fit" onClick={onClick} />)
    const btn = screen.getByText("Fit")
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
  })

  it("renders nothing under (pointer: coarse) media query", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("coarse") ? true : false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
    const { container } = render(
      <HandleHint visible position={{ x: 0, y: 0 }} label="Fit" onClick={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
