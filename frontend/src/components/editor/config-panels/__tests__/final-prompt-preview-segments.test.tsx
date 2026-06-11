import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FinalPromptPreview } from "../final-prompt-preview"
import type { SnippetPoolItem } from "@/lib/snippet-pool"

/**
 * Provenance-rendering tests for FinalPromptPreview (Task 17). The component is
 * pure given its props (snippet pools are passed in, not fetched), and an empty
 * nodes/edges graph makes the {Node Label} ref map empty — so these render with
 * the real shared prompt builder, no mocks, matching the prompt-injection-preview
 * convention. They assert on origin-classed spans + the legend + plain copy text.
 */

const EMPTY_GRAPH = { nodes: [] as never[], edges: [] as never[] }

/** Find a rendered <span> whose className contains `classFragment` and whose
 *  text contains `text`. (Tailwind classes use "/" which is invalid in CSS
 *  selectors, so we scan spans rather than querySelector.) */
function findSpan(container: HTMLElement, classFragment: string, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("span")).find(
    (el) => el.className.includes(classFragment) && (el.textContent ?? "").includes(text),
  ) as HTMLElement | undefined
}

describe("FinalPromptPreview — provenance rendering", () => {
  it("colors style + negative suffix spans and shows a legend", () => {
    // gpt-image folds the negative into the prompt as a `\nAvoid:` suffix and
    // translates the style into a `\nStyle:` suffix — both are tagged spans.
    const { container } = render(
      <FinalPromptPreview
        userPrompt="a knight"
        style="noir"
        negativePrompt="blurry"
        consumerNodeId="n1"
        {...EMPTY_GRAPH}
        provider="gpt-image"
      />,
    )
    // Style suffix → muted style class.
    expect(findSpan(container, "text-muted-foreground", "Style:")).toBeDefined()
    // Negative suffix → rose class.
    expect(findSpan(container, "rose", "Avoid: blurry")).toBeDefined()
    // Legend appears (≥1 non-user origin) with Style + Negative labels.
    expect(screen.getByLabelText("Prompt provenance legend")).toBeDefined()
    expect(screen.getByText("Style")).toBeDefined()
    expect(screen.getByText("Negative")).toBeDefined()
  })

  it("highlights an inserted snippet fragment inside the user prose", () => {
    const snippets: SnippetPoolItem[] = [
      { id: "gh", name: "Golden Hour", text: "golden hour", target: "prompt", category: "Lighting", source: "factory" },
    ]
    const { container } = render(
      <FinalPromptPreview
        userPrompt="a knight in golden hour"
        consumerNodeId="n1"
        {...EMPTY_GRAPH}
        provider="gpt-image"
        snippets={snippets}
      />,
    )
    // The snippet substring renders in its own amber-classed span…
    const snippetSpan = findSpan(container, "amber", "golden hour")
    expect(snippetSpan).toBeDefined()
    expect(snippetSpan?.textContent).toBe("golden hour")
    // …and the legend now lists "Snippet".
    expect(screen.getByText("Snippet")).toBeDefined()
  })

  it("copies the plain assembled string (no markup, no tints)", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(
      <FinalPromptPreview
        userPrompt="a knight"
        style="noir"
        negativePrompt="blurry"
        consumerNodeId="n1"
        {...EMPTY_GRAPH}
        provider="gpt-image"
      />,
    )
    fireEvent.click(screen.getByLabelText("Copy final prompt"))
    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = writeText.mock.calls[0][0] as string
    // Exactly the builder's plain prompt (style + Avoid folded in by gpt-image).
    expect(copied).toBe(
      "a knight\nStyle: film noir style, high-contrast black-and-white imagery, deep shadows, venetian-blind lighting and moody 1940s cinema feel\nAvoid: blurry",
    )
    // No HTML / span markup leaked into the clipboard payload.
    expect(copied).not.toContain("<")
    expect(copied).not.toContain("bg-")
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
})
