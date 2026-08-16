import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  PROMPT_EDITOR_PORTAL_PROPS,
  escapePromptEditorFocusTrap,
} from "@/lib/prompt-editor-portal"

/**
 * The focus-half of the "body menu inside a modal" problem (sibling of the
 * dismiss-half in this same lib file, `BODY_MENU_CLASS` for pointer-events,
 * and `scroll-lock-escape.ts` for wheel).
 *
 * A modal Radix Dialog's FocusScope installs document-level `focusin` /
 * `focusout` listeners that yank focus back into DialogContent whenever it
 * lands OUTSIDE the content subtree. The prompt editor's chip menus portal to
 * document.body — outside the subtree — so their text inputs (e.g. the image
 * reference chip's "Custom…" label input) could never hold focus: every click
 * focused the input for a tick, then the trap snapped focus back to the
 * dialog and keystrokes went to the prompt editor instead.
 *
 * `escapePromptEditorFocusTrap` stops focus events that involve a marked
 * portal at document.body — below Radix's document listeners, above nothing
 * the app needs — so the trap simply never observes the menu.
 */

/** Simulates a picker-ui chip menu: marked portal on document.body with a text input. */
function BodyMenuWithInput() {
  return createPortal(
    <div {...PROMPT_EDITOR_PORTAL_PROPS} role="menu">
      <input aria-label="custom-label" />
    </div>,
    document.body,
  )
}

function ModalWithBodyMenu({ escape }: { readonly escape: boolean }) {
  useEffect(() => {
    if (!escape) return
    return escapePromptEditorFocusTrap()
  }, [escape])
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Edit prompt</DialogTitle>
        <button type="button">inside</button>
        <BodyMenuWithInput />
      </DialogContent>
    </Dialog>
  )
}

afterEach(cleanup)

describe("escapePromptEditorFocusTrap", () => {
  it("BASELINE: without the escape, the dialog focus trap yanks focus from the portaled input (if this starts failing, Radix changed and the escape may be droppable)", () => {
    const { baseElement } = render(<ModalWithBodyMenu escape={false} />)
    const input = baseElement.querySelector<HTMLInputElement>("input[aria-label=custom-label]")!
    input.focus()
    expect(document.activeElement).not.toBe(input)
  })

  it("with the escape installed, the portaled input keeps focus inside the modal dialog", () => {
    const { baseElement } = render(<ModalWithBodyMenu escape />)
    const input = baseElement.querySelector<HTMLInputElement>("input[aria-label=custom-label]")!
    input.focus()
    expect(document.activeElement).toBe(input)
  })

  it("does not interfere with focus moving back into the dialog", () => {
    const { baseElement, getByRole } = render(<ModalWithBodyMenu escape />)
    const input = baseElement.querySelector<HTMLInputElement>("input[aria-label=custom-label]")!
    input.focus()
    const inside = getByRole("button", { name: "inside" })
    inside.focus()
    expect(document.activeElement).toBe(inside)
  })
})
