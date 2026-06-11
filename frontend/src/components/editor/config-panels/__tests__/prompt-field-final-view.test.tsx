import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import {
  PromptFieldFinalView,
  PromptFieldModeToggle,
  type DisplaySegment,
} from "../prompt-field-final-view"

/**
 * Presentational tests for the inline final-view card + the Edit⇄Final toggle.
 * These render `PromptFieldFinalView` / `PromptFieldModeToggle` directly with
 * hand-built segment lists — no shared prompt builder, no store. They assert
 * the colored spans, the legend gating, the plain-text copy payload, the empty
 * placeholder, and the toggle's icon/title/aria + onToggle wiring.
 *
 * Distinct from `final-prompt-preview-segments.test.tsx` (which exercises the
 * legacy block end-to-end through the real builder) — nothing is ported; that
 * suite stays green untouched.
 */

/** Find a rendered <span> whose className contains `classFragment` and whose
 *  text contains `text`. Tailwind classes use "/" (invalid in CSS selectors),
 *  so we scan spans rather than querySelector — same helper the legacy suite uses. */
function findSpan(container: HTMLElement, classFragment: string, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("span")).find(
    (el) => el.className.includes(classFragment) && (el.textContent ?? "").includes(text),
  ) as HTMLElement | undefined
}

describe("PromptFieldFinalView", () => {
  it("renders segments as origin-classed spans and shows a legend for non-user origins", () => {
    const segments: DisplaySegment[] = [
      { text: "a knight ", origin: "user" },
      { text: "{Hero}", origin: "variable" },
      { text: " in ", origin: "user" },
      { text: "golden hour", origin: "snippet" },
    ]
    const { container } = render(
      <PromptFieldFinalView segments={segments} plainText="a knight {Hero} in golden hour" />,
    )
    // Variable span gets the sky tint; snippet span gets the amber tint.
    expect(findSpan(container, "sky", "{Hero}")).toBeDefined()
    expect(findSpan(container, "amber", "golden hour")).toBeDefined()
    // Legend appears with exactly the two present non-user origins.
    expect(screen.getByLabelText("Prompt provenance legend")).toBeDefined()
    expect(screen.getByText("Variable")).toBeDefined()
    expect(screen.getByText("Snippet")).toBeDefined()
    // Origins NOT present don't get a legend entry.
    expect(screen.queryByText("Style")).toBeNull()
    expect(screen.queryByText("Negative")).toBeNull()
  })

  it("hides the legend entirely when all segments are user-origin", () => {
    const segments: DisplaySegment[] = [{ text: "a plain prompt", origin: "user" }]
    render(<PromptFieldFinalView segments={segments} plainText="a plain prompt" />)
    expect(screen.queryByLabelText("Prompt provenance legend")).toBeNull()
  })

  it("copies the PLAIN text (no markup, no tint classes) to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const segments: DisplaySegment[] = [
      { text: "a knight ", origin: "user" },
      { text: "golden hour", origin: "snippet" },
    ]
    render(<PromptFieldFinalView segments={segments} plainText="a knight golden hour" />)
    fireEvent.click(screen.getByLabelText("Copy final prompt"))
    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toBe("a knight golden hour")
    expect(copied).not.toContain("<")
    expect(copied).not.toContain("bg-")
  })

  it("shows the placeholder muted when there is no text", () => {
    render(
      <PromptFieldFinalView segments={[]} plainText="" placeholder="Describe your scene…" />,
    )
    const ph = screen.getByText("Describe your scene…")
    expect(ph).toBeDefined()
    // Rendered through the muted placeholder class, not a colored span.
    expect(ph.className).toContain("text-muted-foreground")
  })

  it("renders an optional routing caption under the card", () => {
    const segments: DisplaySegment[] = [{ text: "blurry", origin: "user" }]
    render(
      <PromptFieldFinalView
        segments={segments}
        plainText="blurry"
        routingCaption="Sent natively as the provider's negative prompt"
      />,
    )
    expect(screen.getByText("Sent natively as the provider's negative prompt")).toBeDefined()
  })

  it("height-matches a tall editor via minHeightRem (inline style, default class dropped)", () => {
    // A 10-row prompt editor is rows*1.5 = 15rem tall. Without minHeightRem the
    // card defaults to 4.5rem and the swap visibly shrinks — so the caller
    // passes 15 and we render an inline minHeight, dropping the 4.5rem class.
    const segments: DisplaySegment[] = [{ text: "a prompt", origin: "user" }]
    const { container, rerender } = render(
      <PromptFieldFinalView segments={segments} plainText="a prompt" minHeightRem={15} />,
    )
    const card = container.querySelector("div.relative") as HTMLElement
    expect(card.style.minHeight).toBe("15rem")
    expect(card.className).not.toContain("min-h-[4.5rem]")

    // Absent → falls back to the default class, no inline override.
    rerender(<PromptFieldFinalView segments={segments} plainText="a prompt" />)
    const cardDefault = container.querySelector("div.relative") as HTMLElement
    expect(cardDefault.style.minHeight).toBe("")
    expect(cardDefault.className).toContain("min-h-[4.5rem]")
  })
})

describe("PromptFieldModeToggle", () => {
  it("renders an Eye (Show final prompt) in edit mode and fires onToggle", () => {
    const onToggle = vi.fn()
    render(<PromptFieldModeToggle mode="edit" onToggle={onToggle} />)
    const btn = screen.getByRole("button", { name: "Show final prompt" })
    expect(btn.getAttribute("title")).toBe("Show final prompt")
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("renders a Pencil (Edit prompt) in final mode and fires onToggle", () => {
    const onToggle = vi.fn()
    render(<PromptFieldModeToggle mode="final" onToggle={onToggle} />)
    const btn = screen.getByRole("button", { name: "Edit prompt" })
    expect(btn.getAttribute("title")).toBe("Edit prompt")
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
})
