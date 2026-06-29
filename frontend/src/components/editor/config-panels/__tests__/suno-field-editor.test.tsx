import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SUNO_FIELD_EDIT_META, SunoFieldEditor } from "../suno-field-editor"

// variableDisplayMode is "raw" (not the brief's placeholder "chip"): "raw" is the
// only valid VariableDisplayMode ("raw"|"annotated"|"resolved") AND the only mode
// under which TagTextarea renders its editable <Textarea> (with placeholder) rather
// than the read-only formatted view — exactly what the style assertion below needs.
const baseProps = { data: { model: "V5", label: "S" } as any, nodeRefs: [], refMap: new Map(), variableDisplayMode: "raw" as const }

describe("SUNO_FIELD_EDIT_META", () => {
  it("covers the 4 secondary fields with correct caps/kinds", () => {
    expect(Object.keys(SUNO_FIELD_EDIT_META).sort()).toEqual(["lyrics", "negativeStyle", "style", "title"])
    expect(SUNO_FIELD_EDIT_META.title.kind).toBe("input")
    expect(SUNO_FIELD_EDIT_META.title.maxLength).toBe(200)
    expect(SUNO_FIELD_EDIT_META.style.kind).toBe("tags")
    expect(SUNO_FIELD_EDIT_META.style.maxLength).toBe(1000)
    expect(SUNO_FIELD_EDIT_META.negativeStyle.maxLength).toBe(500)
    expect(SUNO_FIELD_EDIT_META.lyrics.rows).toBe(4)
  })
})

describe("SunoFieldEditor", () => {
  it("renders an <input> for title and writes the field", () => {
    const onUpdate = vi.fn()
    render(<SunoFieldEditor meta={SUNO_FIELD_EDIT_META.title} onUpdate={onUpdate} {...baseProps} />)
    const input = screen.getByPlaceholderText(SUNO_FIELD_EDIT_META.title.placeholder)
    fireEvent.change(input, { target: { value: "My Song" } })
    expect(onUpdate).toHaveBeenCalledWith({ title: "My Song" })
  })
  it("renders a textarea editor for style (not a plain input)", () => {
    render(<SunoFieldEditor meta={SUNO_FIELD_EDIT_META.style} onUpdate={vi.fn()} {...baseProps} />)
    expect(screen.getByPlaceholderText(SUNO_FIELD_EDIT_META.style.placeholder)).toBeInTheDocument()
  })
})
