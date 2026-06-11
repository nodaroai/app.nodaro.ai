"use client"

import { Scissors } from "lucide-react"

/**
 * Sticky category header used by both snippet menus (the in-editor `/`
 * suggestion list and the label-row Scissors button popover). Extracted so the
 * header markup + classes live in one place — the two menus keep their own
 * scroll containers and `<button>` shells.
 */
export function SnippetCategoryHeader({ category }: { category: string }) {
  return (
    <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-2.5 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50">
      {category}
    </div>
  )
}

/**
 * Inner content of a snippet menu row: the Scissors icon + a two-line span
 * (bold name over a truncated text preview). Content ONLY — the caller owns
 * the `<button>` shell, keyboard/selection state, and onMouseDown/onClick
 * semantics. `selected` only tints the icon amber (the slash menu's keyboard
 * highlight); the button-menu popover never selects, so it omits the prop.
 */
export function SnippetRowContent({
  item,
  selected = false,
}: {
  item: { name: string; text: string }
  selected?: boolean
}) {
  return (
    <>
      <Scissors
        className={`w-3 h-3 mt-0.5 shrink-0 ${selected ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground/70"}`}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] font-medium truncate">{item.name}</span>
        <span className="block text-[10px] text-muted-foreground truncate">{item.text}</span>
      </span>
    </>
  )
}
