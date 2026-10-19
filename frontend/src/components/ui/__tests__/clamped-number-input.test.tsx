import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { ClampedNumberInput } from "../clamped-number-input"

/** Stateful host so an external write (slider, preset) can be simulated. */
function Host({
  initial,
  min,
  max,
  allowEmpty,
  onCommit,
}: {
  initial: number | undefined
  min?: number
  max?: number
  allowEmpty?: boolean
  onCommit?: (n: number | undefined) => void
}) {
  const [value, setValue] = useState<number | undefined>(initial)
  return (
    <>
      <ClampedNumberInput
        aria-label="Duration"
        value={value}
        min={min}
        max={max}
        allowEmpty={allowEmpty}
        onCommit={(n) => {
          onCommit?.(n)
          setValue(n)
        }}
      />
      <button type="button" onClick={() => setValue(46)}>slider→46</button>
      <span data-testid="stored">{String(value)}</span>
    </>
  )
}

const input = () => screen.getByLabelText("Duration") as HTMLInputElement

describe("ClampedNumberInput", () => {
  // The bug: with min=4, clamping on every keystroke turned the "1" of "12"
  // into "4" before the "2" could land — two-digit values were untypeable.
  it("lets the user type a value whose prefix is below the minimum", async () => {
    const onCommit = vi.fn()
    render(<Host initial={8} min={4} max={120} onCommit={onCommit} />)
    const el = input()
    await userEvent.clear(el)
    await userEvent.type(el, "12")
    // Draft holds the raw keystrokes; nothing committed yet.
    expect(el.value).toBe("12")
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.blur(el)
    expect(onCommit).toHaveBeenCalledWith(12)
    expect(screen.getByTestId("stored").textContent).toBe("12")
  })

  it("clamps into [min, max] on blur, not while typing", async () => {
    const onCommit = vi.fn()
    render(<Host initial={8} min={4} max={120} onCommit={onCommit} />)
    const el = input()
    await userEvent.clear(el)
    await userEvent.type(el, "1")
    expect(el.value).toBe("1")
    fireEvent.blur(el)
    expect(onCommit).toHaveBeenCalledWith(4)
    expect(el.value).toBe("4")

    await userEvent.clear(el)
    await userEvent.type(el, "999")
    fireEvent.blur(el)
    expect(onCommit).toHaveBeenLastCalledWith(120)
  })

  it("Enter commits and Escape restores the stored value", async () => {
    const onCommit = vi.fn()
    render(<Host initial={8} min={4} max={120} onCommit={onCommit} />)
    const el = input()
    await userEvent.clear(el)
    await userEvent.type(el, "30{Enter}")
    expect(onCommit).toHaveBeenCalledWith(30)

    await userEvent.clear(el)
    await userEvent.type(el, "77{Escape}")
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(el.value).toBe("30")
  })

  it("does not commit an unchanged value and restores on garbage", async () => {
    const onCommit = vi.fn()
    render(<Host initial={8} min={4} max={120} onCommit={onCommit} />)
    const el = input()
    fireEvent.focus(el)
    fireEvent.blur(el)
    expect(onCommit).not.toHaveBeenCalled()
    // A cleared field without allowEmpty restores the stored value.
    await userEvent.clear(el)
    fireEvent.blur(el)
    expect(onCommit).not.toHaveBeenCalled()
    expect(el.value).toBe("8")
  })

  it("allowEmpty commits undefined for a cleared field", async () => {
    const onCommit = vi.fn()
    render(<Host initial={8} min={4} max={15} allowEmpty onCommit={onCommit} />)
    const el = input()
    await userEvent.clear(el)
    fireEvent.blur(el)
    expect(onCommit).toHaveBeenCalledWith(undefined)
    expect(el.value).toBe("")
  })

  it("adopts an external write only while not focused", async () => {
    render(<Host initial={8} min={4} max={120} />)
    const el = input()
    await userEvent.click(screen.getByText("slider→46"))
    expect(el.value).toBe("46")

    // Mid-typing, an external write must not erase the draft.
    await userEvent.clear(el)
    await userEvent.type(el, "1")
    fireEvent.click(screen.getByText("slider→46"))
    expect(el.value).toBe("1")
  })

  it("half-typed text (\"1e\") is not a clear, even with allowEmpty: the stored value stays", async () => {
    const onCommit = vi.fn()
    render(<Host initial={45} min={5} max={180} allowEmpty onCommit={onCommit} />)
    const el = input()
    await userEvent.clear(el)
    await userEvent.type(el, "1e")
    expect(el.value).toBe("1e")
    fireEvent.blur(el)
    expect(onCommit).not.toHaveBeenCalled()
    expect(el.value).toBe("45")
  })

  it("only plain decimal text is read: hex (\"0x10\") and \"Infinity\" restore the stored value", async () => {
    const onCommit = vi.fn()
    render(<Host initial={8} min={1} max={50} onCommit={onCommit} />)
    const el = input()
    for (const text of ["0x10", "Infinity", "1e3"]) {
      await userEvent.clear(el)
      await userEvent.type(el, text)
      fireEvent.blur(el)
      expect(el.value).toBe("8")
    }
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("is a spinbutton with its bounds, and the arrow keys step it within them", async () => {
    const onCommit = vi.fn()
    render(<Host initial={49} min={1} max={50} onCommit={onCommit} />)
    const el = screen.getByRole("spinbutton", { name: "Duration" }) as HTMLInputElement
    expect(el.getAttribute("aria-valuemin")).toBe("1")
    expect(el.getAttribute("aria-valuemax")).toBe("50")
    el.focus()
    await userEvent.keyboard("{ArrowUp}{ArrowUp}")
    expect(el.value).toBe("50")
    await userEvent.keyboard("{ArrowDown}")
    expect(el.value).toBe("49")
    fireEvent.blur(el)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
