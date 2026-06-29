import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TagTextarea } from "../tag-textarea"
import { PROMPT_EDITOR_PORTAL_ATTR } from "../prompt-editor/prompt-editor-portal"

/**
 * Phase C (field-edit modal) renders TagTextarea inside a Radix Dialog. Its
 * `[`/`/` suggestion dropdown createPortals to document.body — OUTSIDE the
 * dialog content subtree — so without an identifying attribute Radix's dismiss
 * layer treats a click in the dropdown as "outside" and closes the modal.
 * Marking the portal root with PROMPT_EDITOR_PORTAL_ATTR lets the dialog's
 * onInteractOutside guard (isPromptEditorPortalInteraction) keep it open.
 */
describe("TagTextarea body portal", () => {
  it("marks the [ / suggestion dropdown portal with the prompt-editor-portal attr", () => {
    render(
      <TagTextarea
        value=""
        onChange={() => {}}
        tagMode="suno"
        customTags={[{ tag: "[pop]", label: "pop", category: "Suno" }]}
      />,
    )

    const ta = screen.getByRole("textbox")
    // Typing "[" opens the suno metatag/suggestion dropdown (isBracketTrigger).
    fireEvent.change(ta, { target: { value: "[", selectionStart: 1, selectionEnd: 1 } })

    // Non-vacuous guard: prove the dropdown actually mounted (its suggestion row
    // is portalled into document.body) before asserting on its root — otherwise
    // a missing-but-also-non-rendered portal would pass for the wrong reason.
    const row = screen.getByText("[pop]")
    expect(row).toBeInTheDocument()

    // The dropdown root is portalled to document.body and MUST carry the guard
    // attr so a host Radix Dialog's onInteractOutside can recognize and keep it.
    const portal = document.querySelector(`[${PROMPT_EDITOR_PORTAL_ATTR}]`)
    expect(portal).not.toBeNull()
    // The marked element IS the dropdown root (contains the rendered row).
    expect(portal).toContainElement(row)
  })
})
