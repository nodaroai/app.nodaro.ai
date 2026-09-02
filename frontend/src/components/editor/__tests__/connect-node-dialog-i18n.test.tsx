import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"
import { ConnectNodeDialog } from "../connect-node-dialog"
import type { ConnectionOptions, ConnectionOption } from "@/lib/enumerate-connection-options"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

function handle(partial: Partial<ConnectionOption>): ConnectionOption {
  return { kind: "handle", direction: "target", fHandle: "prompt", nHandle: "prompt", tier: "direct", label: "Prompt", color: "#3B82F6", ...partial }
}

const options: ConnectionOptions = {
  handles: [handle({ label: "Prompt", fHandle: "prompt", direction: "source" }), handle({ label: "Negative", fHandle: "negative" })],
  variables: [{ ...handle({}), kind: "variable", variableName: "Hero", label: "Prompt" }],
}

beforeEach(() => act(() => useLocaleStore.getState().setLocale("he")))
afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

// The dialog opens the moment a node is picked with auto-connect on, so a
// Hebrew user went straight from a Hebrew picker into an all-English dialog.
describe("connect dialog in Hebrew", () => {
  it("titles itself with the localized node names and a reading-direction arrow", () => {
    render(<ConnectNodeDialog focusedLabel="Upload Image" newLabel="Text" options={options} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const heading = screen.getByRole("heading", { level: 3 })
    expect(heading.textContent).toContain("טקסט")
    expect(heading.textContent).toContain("העלאת תמונה")
    expect(heading.textContent).not.toContain("Add")
    expect(heading.textContent).toContain("←")
    expect(heading.textContent).not.toContain("→")
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
      translate("he", "connect.dialogAria", { newLabel: "טקסט", focusedLabel: "העלאת תמונה" }),
    )
  })

  it("labels the name field, the sections and the ordering chips in Hebrew", () => {
    render(<ConnectNodeDialog focusedLabel="Upload Image" newLabel="Text" options={options} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(translate("he", "connect.name"))).toBeTruthy()
    expect(screen.getByLabelText(translate("he", "connect.nameAria"))).toBeTruthy()
    expect(screen.getByText(translate("he", "connect.handles"))).toBeTruthy()
    expect(screen.getByText(translate("he", "connect.missingVariables"))).toBeTruthy()
    expect(screen.getByText(translate("he", "connect.after"))).toBeTruthy()
    expect(screen.getByText(translate("he", "connect.before"))).toBeTruthy()
    expect(screen.getByText(translate("he", "connect.roleNew"))).toBeTruthy()
    expect(screen.getByText(translate("he", "connect.roleCurrent"))).toBeTruthy()
    for (const en of ["Name", "Handles", "After", "Before", "New", "Current", "wires into", "Missing variables"]) {
      expect(screen.queryByText(en), `raw English "${en}"`).toBeNull()
    }
  })

  it("localizes handle names through the handle-label table", () => {
    render(<ConnectNodeDialog focusedLabel="Upload Image" newLabel="Text" options={options} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getAllByText("פרומפט").length).toBeGreaterThan(0)
    expect(screen.queryByText("Prompt")).toBeNull()
    // The accessible names of the primary rows carry the localized handle too.
    expect(screen.getByLabelText(translate("he", "connect.optionAriaAfter", { handle: "פרומפט" }))).toBeTruthy()
    expect(screen.getByLabelText(translate("he", "connect.optionAriaBefore", { handle: "שלילי" }))).toBeTruthy()
  })

  it("seeds the name field empty with the localized default as placeholder", () => {
    render(<ConnectNodeDialog focusedLabel="Upload Image" newLabel="Text" options={options} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const input = screen.getByLabelText(translate("he", "connect.nameAria")) as HTMLInputElement
    // A Hebrew seed would persist as a custom label and never localize back;
    // an English seed shows raw English under a Hebrew heading. So: empty +
    // placeholder, and an untouched field still confirms the English default.
    expect(input.value).toBe("")
    expect(input.placeholder).toBe("טקסט")
  })

  it("confirms the English default when the name is left untouched", () => {
    const onConfirm = vi.fn()
    render(<ConnectNodeDialog focusedLabel="Upload Image" newLabel="Text" options={options} onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" })
    expect(onConfirm.mock.calls[0][0].name).toBe("Text")
  })

  it("lets the bidi algorithm mirror the row chevron rather than flipping it by hand", () => {
    // U+203A is Bidi_Mirrored: the browser draws it pointing left under
    // dir="rtl" on its own. A manual ‹ would be mirrored back to ›.
    render(<ConnectNodeDialog focusedLabel="Upload Image" newLabel="Text" options={options} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getAllByText("›").length).toBeGreaterThan(0)
    expect(screen.queryByText("‹")).toBeNull()
  })

  it("renders the variable hint, the no-connect row and the footer in Hebrew", () => {
    render(<ConnectNodeDialog focusedLabel="Upload Image" newLabel="Text" options={options} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(translate("he", "connect.variableHint", { name: "Hero", handle: "פרומפט" }))).toBeTruthy()
    expect(screen.getByText(translate("he", "connect.dontConnect"))).toBeTruthy()
    expect(screen.queryByText("Don’t connect (just add)")).toBeNull()
    expect(screen.getByText(translate("he", "connect.autoConnect"))).toBeTruthy()
    expect(screen.queryByText(/navigate|confirm|cancel/)).toBeNull()
  })
})
