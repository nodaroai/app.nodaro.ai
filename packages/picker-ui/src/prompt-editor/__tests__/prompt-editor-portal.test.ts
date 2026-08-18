import { describe, it, expect, afterEach } from "vitest"
import {
  PROMPT_EDITOR_PORTAL_ATTR,
  isPromptEditorPortalInteraction,
} from "../prompt-editor-portal"

/**
 * Body-portaled prompt-editor menus live OUTSIDE a host Radix Dialog's
 * content, so Radix treats a click in them as "outside" and closes the dialog.
 * Marked menus + this guard let the host call `event.preventDefault()` in
 * `onInteractOutside` to keep the dialog open when the click was in a menu.
 */
function interactEvent(target: EventTarget | null) {
  return { detail: { originalEvent: { target } } } as unknown as Parameters<
    typeof isPromptEditorPortalInteraction
  >[0]
}

describe("isPromptEditorPortalInteraction", () => {
  afterEach(() => document.body.replaceChildren())

  it("is true when the interaction target is inside a marked portal", () => {
    const portal = document.createElement("div")
    portal.setAttribute(PROMPT_EDITOR_PORTAL_ATTR, "")
    const child = document.createElement("button")
    portal.appendChild(child)
    document.body.appendChild(portal)

    expect(isPromptEditorPortalInteraction(interactEvent(child))).toBe(true)
  })

  it("is true when the target IS the marked portal element itself", () => {
    const portal = document.createElement("div")
    portal.setAttribute(PROMPT_EDITOR_PORTAL_ATTR, "")
    document.body.appendChild(portal)

    expect(isPromptEditorPortalInteraction(interactEvent(portal))).toBe(true)
  })

  it("is false when the target is outside any marked portal", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)

    expect(isPromptEditorPortalInteraction(interactEvent(el))).toBe(false)
  })

  it("is false for a null / non-element target", () => {
    expect(isPromptEditorPortalInteraction(interactEvent(null))).toBe(false)
  })
})
