import { describe, it, expect, vi } from "vitest"
import { render, waitFor } from "@testing-library/react"
import type { Editor } from "@tiptap/react"
import { PromptEditor } from "../prompt-editor"
import type { SnippetPoolItem } from "@/lib/snippet-pool"

/**
 * Pill-layer contract tests for PromptEditor (Task 14). The load-bearing
 * invariant is that snippet pills are a PURE DISPLAY layer: `editor.getText()`
 * — the value persisted to `node.data.prompt` — always equals the plain text
 * the user would have typed by hand. The rendered DOM intentionally differs
 * (the pill is a React NodeView: scissors icon + name + ×), so these tests
 * assert against the live editor state (`editor.getText()` / `editor.state.doc`)
 * reached through the ProseMirror DOM node's `.editor` handle — the same
 * mount/`waitFor` pattern as prompt-editor-variable-highlight.test.tsx.
 */

const snippet = (over: Partial<SnippetPoolItem> & Pick<SnippetPoolItem, "id" | "name" | "text">): SnippetPoolItem => ({
  target: "prompt",
  category: "Lighting",
  source: "factory",
  ...over,
})

const GOLDEN = snippet({ id: "golden-hour", name: "Golden Hour", text: "warm golden-hour sunlight" })
const NEON = snippet({ id: "neon-noir", name: "Neon Noir", text: "neon noir palette" })

/** The TipTap editor instance hangs off the ProseMirror DOM node. */
function getEditor(container: HTMLElement): Editor {
  const pm = container.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null
  if (!pm?.editor) throw new Error("editor not mounted")
  return pm.editor
}

/** All snippetPill node attrs in document order. */
function pillAttrs(editor: Editor): Array<{ snippetId: string; name: string; text: string }> {
  const out: Array<{ snippetId: string; name: string; text: string }> = []
  editor.state.doc.descendants((n) => {
    if (n.type.name === "snippetPill") {
      out.push({
        snippetId: String(n.attrs.snippetId),
        name: String(n.attrs.name),
        text: String(n.attrs.text),
      })
    }
  })
  return out
}

describe("PromptEditor snippet pills", () => {
  it("promotes a known snippet text to a pill with correct attrs and round-trips getText() exactly", async () => {
    const value = "a knight, warm golden-hour sunlight, on a cliff"
    const { container } = render(
      <PromptEditor value={value} onChange={vi.fn()} snippets={[GOLDEN, NEON]} />,
    )
    await waitFor(() => {
      expect(container.querySelector("span[data-snippet-pill]")).not.toBeNull()
    })
    const editor = getEditor(container)
    // The doc contains exactly one pill, with the matched snippet's attrs.
    expect(pillAttrs(editor)).toEqual([
      { snippetId: "golden-hour", name: "Golden Hour", text: "warm golden-hour sunlight" },
    ])
    // The load-bearing contract: getText() is byte-identical to the input value
    // (the pill's renderText emits attrs.text verbatim — no separator drift).
    expect(editor.getText({ blockSeparator: "\n" })).toBe(value)
  })

  it("stays plain text (no pill) when no snippets prop is provided", async () => {
    const value = "a knight, warm golden-hour sunlight, on a cliff"
    const { container } = render(<PromptEditor value={value} onChange={vi.fn()} />)
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).not.toBeNull()
    })
    const editor = getEditor(container)
    expect(pillAttrs(editor)).toHaveLength(0)
    expect(editor.getText({ blockSeparator: "\n" })).toBe(value)
  })

  it("promotes TWO different known snippet texts in the same value", async () => {
    const value = "warm golden-hour sunlight and neon noir palette together"
    const { container } = render(
      <PromptEditor value={value} onChange={vi.fn()} snippets={[GOLDEN, NEON]} />,
    )
    await waitFor(() => {
      expect(container.querySelectorAll("span[data-snippet-pill]").length).toBe(2)
    })
    const editor = getEditor(container)
    expect(pillAttrs(editor)).toEqual([
      { snippetId: "golden-hour", name: "Golden Hour", text: "warm golden-hour sunlight" },
      { snippetId: "neon-noir", name: "Neon Noir", text: "neon noir palette" },
    ])
    // Both pills are display-only; the stored prompt is unchanged.
    expect(editor.getText({ blockSeparator: "\n" })).toBe(value)
  })

  it("re-promotes existing plain text to a pill when the pool arrives AFTER mount", async () => {
    const value = "a knight, warm golden-hour sunlight, on a cliff"
    const { container, rerender } = render(
      <PromptEditor value={value} onChange={vi.fn()} snippets={[]} />,
    )
    // Initially no pool → plain text, no pill.
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).not.toBeNull()
    })
    expect(pillAttrs(getEditor(container))).toHaveLength(0)

    // Pool loads (e.g. the snippets query resolves). The storage-mirror effect
    // re-parses the current value because the snippet text occurs in it.
    rerender(<PromptEditor value={value} onChange={vi.fn()} snippets={[GOLDEN, NEON]} />)
    await waitFor(() => {
      expect(container.querySelector("span[data-snippet-pill]")).not.toBeNull()
    })
    const editor = getEditor(container)
    expect(pillAttrs(editor)).toEqual([
      { snippetId: "golden-hour", name: "Golden Hour", text: "warm golden-hour sunlight" },
    ])
    // Re-promotion is a display change only — getText() is still the original.
    expect(editor.getText({ blockSeparator: "\n" })).toBe(value)
  })

  it("typing after promotion does not duplicate the pill or inject separators", async () => {
    const value = "a knight, warm golden-hour sunlight here"
    let lastOnChange = ""
    const { container } = render(
      <PromptEditor value={value} onChange={(v) => { lastOnChange = v }} snippets={[GOLDEN]} />,
    )
    await waitFor(() => {
      expect(container.querySelector("span[data-snippet-pill]")).not.toBeNull()
    })
    const editor = getEditor(container)
    // Append a character at the end of the document (before the closing
    // boundary). This fires onUpdate → onChange exactly like a keystroke.
    const end = editor.state.doc.content.size
    editor.chain().focus().insertContentAt(end - 1, "X").run()

    // Still exactly one pill — typing must not re-parse/duplicate it.
    expect(pillAttrs(editor)).toHaveLength(1)
    // getText() is the original value + the typed char, with NO extra space or
    // comma injected around the pill (the renderText round-trip is exact).
    expect(editor.getText({ blockSeparator: "\n" })).toBe(`${value}X`)
    expect(lastOnChange).toBe(`${value}X`)
  })
})
