import { getFactorySnippets, type SnippetMedia, type SnippetTarget } from "@nodaro/shared"
import type { PromptSnippet } from "@/lib/api"

/** One row of the merged menu pool — what the slash menu, button menu, and
 *  (PR2) pill matcher all consume. */
export interface SnippetPoolItem {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly text: string
  readonly target: SnippetTarget
  readonly category: string
  readonly source: "factory" | "user"
}

export const USER_SNIPPET_CATEGORY = "My snippets"

/** Merge the user's snippets (first, under "My snippets") with the factory
 *  catalog, both filtered to one field's target + the node's modality.
 *  User snippets with empty `media` apply to all modalities. */
export function buildSnippetPool(args: {
  media: SnippetMedia
  target: SnippetTarget
  userSnippets: readonly PromptSnippet[]
}): SnippetPoolItem[] {
  const { media, target, userSnippets } = args
  const user: SnippetPoolItem[] = userSnippets
    .filter((s) => s.target === target && (s.media.length === 0 || s.media.includes(media)))
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      text: s.text,
      target: s.target,
      category: s.category?.trim() || USER_SNIPPET_CATEGORY,
      source: "user" as const,
    }))
  const factory: SnippetPoolItem[] = getFactorySnippets(target, media).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    text: s.text,
    target: s.target,
    category: s.category,
    source: "factory" as const,
  }))
  return [...user, ...factory]
}

/** Case-insensitive search over name + description + category.
 *  Name-PREFIX matches rank first (stable within each band). */
export function filterSnippets(
  pool: readonly SnippetPoolItem[],
  query: string,
): SnippetPoolItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...pool]
  const prefix: SnippetPoolItem[] = []
  const rest: SnippetPoolItem[] = []
  for (const s of pool) {
    const name = s.name.toLowerCase()
    if (name.startsWith(q)) {
      prefix.push(s)
    } else if (
      name.includes(q)
      || (s.description ?? "").toLowerCase().includes(q)
      || s.category.toLowerCase().includes(q)
    ) {
      rest.push(s)
    }
  }
  return [...prefix, ...rest]
}

/**
 * Smart leading separator when inserting at the caret: nothing at line start
 * or after whitespace; a single space after sentence punctuation; ", " when
 * gluing onto a word. `prevChar` is the character immediately before the
 * insertion point ("" at start).
 */
export function computeSnippetInsertPrefix(prevChar: string): string {
  if (!prevChar || /\s/.test(prevChar)) return ""
  if (/[.,;:!?]/.test(prevChar)) return " "
  return ", "
}

/**
 * Fold a filtered, already-ordered list into consecutive-category groups —
 * the grouping both snippet menus apply for sticky category headers. The pool
 * builder + `filterSnippets` keep items ordered (user snippets first, then
 * factory categories), so a single forward pass that opens a new group each
 * time the category changes preserves that order while collapsing runs of the
 * same category under one header. Generic over any `{ category }` row so the
 * slash-menu (which carries per-item indices) can wrap it too.
 */
export function groupSnippetsByCategory<T extends { category: string }>(
  items: readonly T[],
): Array<{ category: string; entries: T[] }> {
  const out: Array<{ category: string; entries: T[] }> = []
  for (const item of items) {
    const last = out[out.length - 1]
    if (last && last.category === item.category) last.entries.push(item)
    else out.push({ category: item.category, entries: [item] })
  }
  return out
}

/** Button path: append a snippet to the END of the current value with the
 *  same separator rules (trailing whitespace collapsed first). */
export function appendSnippetText(value: string, text: string): string {
  const trimmed = value.replace(/\s+$/, "")
  if (!trimmed) return text
  const last = trimmed[trimmed.length - 1]
  return trimmed + computeSnippetInsertPrefix(last) + text
}
