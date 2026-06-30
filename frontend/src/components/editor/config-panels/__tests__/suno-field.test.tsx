import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SunoField } from "../suno-field"

/**
 * SunoField is MappableField MINUS the manual "Manual / source" dropdown: a Suno
 * field is bound ONLY by wiring its `field-*` canvas handle (auto-inject) or by
 * typing a {variable} — never by a per-field source picker. These tests pin that
 * contract: no dropdown ever, and `wired` swaps the editor for a read-only
 * preview (the editor is not mounted so the user can't type a value the
 * connection will override).
 */
function Editor() {
  return <textarea placeholder="STYLE-EDITOR" defaultValue="" />
}

describe("SunoField", () => {
  it("mounts the editor and renders NO manual source dropdown when unwired", () => {
    render(
      <SunoField field="style" label="Style (optional)" wired={false}>
        <Editor />
      </SunoField>,
    )
    // The editor (children) is mounted...
    expect(screen.getByPlaceholderText("STYLE-EDITOR")).toBeInTheDocument()
    // ...and there is NO "Manual / source" picker (the thing we dropped).
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.queryByText("Manual")).toBeNull()
    expect(screen.queryByRole("combobox", { name: /source/i })).toBeNull()
  })

  it("renders a read-only preview and does NOT mount the editor when wired", () => {
    render(
      <SunoField field="style" label="Style (optional)" wired={true}>
        <Editor />
      </SunoField>,
    )
    // Editor not mounted — the value comes from the wired handle.
    expect(screen.queryByPlaceholderText("STYLE-EDITOR")).toBeNull()
    // A read-only preview is shown instead.
    expect(screen.getByText(/connected handle/i)).toBeInTheDocument()
    // And still no source dropdown in the wired state either.
    expect(screen.queryByRole("combobox", { name: /source/i })).toBeNull()
  })

  it("renders the labelAction slot (e.g. an AI button) in both states", () => {
    const { rerender } = render(
      <SunoField field="style" label="Style (optional)" wired={false} labelAction={<button>AI</button>}>
        <Editor />
      </SunoField>,
    )
    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument()
    rerender(
      <SunoField field="style" label="Style (optional)" wired={true} labelAction={<button>AI</button>}>
        <Editor />
      </SunoField>,
    )
    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument()
  })
})
