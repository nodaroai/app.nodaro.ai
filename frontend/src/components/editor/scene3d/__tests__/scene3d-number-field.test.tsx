import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Scene3DNumberField } from "../scene3d-number-field"

function setup() {
  const onCommit = vi.fn()
  render(<Scene3DNumberField value={2} onCommit={onCommit} ariaLabel="Position X" />)
  const input = screen.getByLabelText("Position X")
  input.focus()
  fireEvent.change(input, { target: { value: "5" } })
  return { input, onCommit }
}

describe("Scene3D number field keyboard commits", () => {
  it("Escape cancels the draft without creating a scene revision on blur", () => {
    const { input, onCommit } = setup()
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onCommit).not.toHaveBeenCalled()
    expect(input).toHaveValue(2)
  })
  it("Enter commits once even though it also blurs the field", () => {
    const { input, onCommit } = setup()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(5)
  })
})
