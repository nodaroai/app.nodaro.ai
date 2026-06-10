import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { ExposableField } from "@nodaro/shared"
import { FieldInputCard } from "../field-input-card"

function colorField(overrides: Partial<ExposableField> = {}): ExposableField {
  return { key: "slot:bg", label: "Background", type: "color", ...overrides }
}

describe("FieldInputCard — color", () => {
  it("renders a color input seeded from value and fires onChange with the picked hex", () => {
    const onChange = vi.fn()
    render(
      <FieldInputCard field={colorField()} value="#ff0073" onChange={onChange} />,
    )
    const input = screen.getByLabelText("Background") as HTMLInputElement
    expect(input.type).toBe("color")
    expect(input.value).toBe("#ff0073")
    // The companion mono label shows the full string value.
    expect(screen.getByText("#ff0073")).toBeInTheDocument()

    fireEvent.input(input, { target: { value: "#00ff00" } })
    expect(onChange).toHaveBeenCalledWith("#00ff00")
  })

  it("falls back to field.defaultValue then #ffffff when value is nullish", () => {
    const { rerender } = render(
      <FieldInputCard
        field={colorField({ defaultValue: "#123456" })}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    expect((screen.getByLabelText("Background") as HTMLInputElement).value).toBe(
      "#123456",
    )

    rerender(
      <FieldInputCard field={colorField()} value={undefined} onChange={vi.fn()} />,
    )
    expect((screen.getByLabelText("Background") as HTMLInputElement).value).toBe(
      "#ffffff",
    )
  })

  it("strips an 8-digit hex to #rrggbb for the native swatch", () => {
    render(
      <FieldInputCard field={colorField()} value="#00ff0080" onChange={vi.fn()} />,
    )
    // <input type="color"> only accepts #rrggbb; the swatch shows the truncated
    // value while the mono label preserves the full alpha string.
    expect((screen.getByLabelText("Background") as HTMLInputElement).value).toBe(
      "#00ff00",
    )
    expect(screen.getByText("#00ff0080")).toBeInTheDocument()
  })
})
