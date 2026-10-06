/**
 * An exposed text input may declare a character limit (decided 2026-10-06):
 * it caps the app's advertised speech price, so the runtime card must hold the
 * user to it — the textarea takes no more than the limit and shows a counter.
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ExposableField } from "@nodaro/shared"
import { FieldInputCard } from "../field-input-card"

const field: ExposableField = { key: "directText", label: "Text", type: "text" }

describe("FieldInputCard — text with a character limit", () => {
  it("caps the textarea at the limit and shows the count against it", () => {
    render(<FieldInputCard field={field} value={"a".repeat(40)} onChange={() => {}} maxLength={120} />)
    const textarea = screen.getByRole("textbox")
    expect(textarea).toHaveAttribute("maxlength", "120")
    expect(screen.getByTestId("field-char-count")).toHaveTextContent("40/120")
  })

  it("without a limit the textarea is unbounded and no counter is shown", () => {
    render(<FieldInputCard field={field} value="hello" onChange={() => {}} />)
    expect(screen.getByRole("textbox")).not.toHaveAttribute("maxlength")
    expect(screen.queryByTestId("field-char-count")).toBeNull()
  })
})
