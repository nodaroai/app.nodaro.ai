"use client"

interface TextItemsPreviewProps {
  readonly items: readonly string[]
  /** One short line under the text — the node's own summary (counts, mode, separator). */
  readonly summary: string
}

/**
 * The text a list-producing node hands on, readable on the canvas before
 * anyone clicks: the first item, clamped to a few lines. A node that showed
 * only "1 picked · 5 rest" read as empty in a template (2026-09-24).
 */
export function TextItemsPreview({ items, summary }: TextItemsPreviewProps) {
  return (
    <div className="w-full rounded-md bg-muted/30 p-2">
      <p className="text-[11px] leading-snug text-foreground/80 whitespace-pre-line break-words line-clamp-4">{items[0]}</p>
      <span className="text-[10px] text-muted-foreground mt-1 block">{summary}</span>
    </div>
  )
}

/** The non-blank strings of a stored item list. */
export function textItems(value: readonly unknown[] | undefined): string[] {
  return (value ?? []).filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}
