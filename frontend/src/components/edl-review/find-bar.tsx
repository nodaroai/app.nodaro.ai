"use client"

/**
 * ⌘F inside the review inspector (§2.3 of the inspectors design): a case- and
 * diacritic-insensitive search over the transcript's words (`lib/edl-review/
 * find.ts`), with "n of m" and next / previous. Enter goes to the next match,
 * Shift+Enter to the previous one. The pane scrolls to the current match and
 * expands a collapsed run that hides it.
 *
 * Closed, it is a button that opens it. Open, Escape closes it — after the
 * span popover and the selection toolbar, before a run the reviewer expanded
 * (§2.4). The runs find itself expanded are not Escape layers; closing find
 * (Escape or ✕) collapses them again and returns focus to where it was before
 * find opened (decided 2026-10-07, transcript-pane.tsx).
 */
import { useDeferredValue, useEffect, useMemo, useState, type RefObject } from "react"
import { ChevronDown, ChevronUp, Search, X } from "lucide-react"
import { findMatches, matchAtOrAfter, stepMatch, type FindIndex, type FindMatch } from "@/lib/edl-review/find"
import { useT } from "@/lib/i18n"

export interface FindState {
  readonly open: boolean
  readonly query: string
  /** The current match's index, or -1. */
  readonly current: number
}

export const CLOSED_FIND: FindState = { open: false, query: "", current: -1 }

/** The matches of the open find, and the current one. */
export function useFindMatches(index: FindIndex | null, find: FindState): readonly FindMatch[] {
  const query = useDeferredValue(find.open ? find.query : "")
  return useMemo(() => (index ? findMatches(index, query) : []), [index, query])
}

export interface FindBarProps {
  readonly find: FindState
  readonly matches: readonly FindMatch[]
  readonly inputRef: RefObject<HTMLInputElement | null>
  /** The first word on screen: a new query starts at the first match from there. */
  readonly fromWord: () => number
  readonly onChange: (find: FindState) => void
}

export function FindBar({ find, matches, inputRef, fromWord, onChange }: FindBarProps) {
  const t = useT()
  // A new set of matches (a new query) starts from the first one on screen.
  const [seen, setSeen] = useState<readonly FindMatch[] | null>(null)
  useEffect(() => {
    if (!find.open || matches === seen) return
    setSeen(matches)
    onChange({ ...find, current: matchAtOrAfter(matches, fromWord()) })
  }, [find, matches, seen, fromWord, onChange])

  if (!find.open) {
    return (
      <button
        type="button"
        data-find-open
        className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        // A click keeps focus where it was, so closing find can return it there.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange({ open: true, query: find.query, current: -1 })}
      >
        <Search className="h-3.5 w-3.5" />
        {t("edlReview.find")}
        <kbd className="rounded border border-border px-1 text-[10px]">⌘F</kbd>
      </button>
    )
  }

  const step = (dir: 1 | -1) => onChange({ ...find, current: stepMatch(matches, find.current, dir) })
  const count = find.query.trim() === "" ? "" : matches.length === 0 ? t("edlReview.findNone") : t("edlReview.findCount", { n: find.current + 1, total: matches.length })

  return (
    <div className="flex items-center gap-1" role="search">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        dir="auto"
        value={find.query}
        placeholder={t("edlReview.findPlaceholder")}
        aria-label={t("edlReview.find")}
        className="h-7 w-48 rounded border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        onChange={(e) => onChange({ ...find, query: e.target.value, current: -1 })}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          step(e.shiftKey ? -1 : 1)
        }}
      />
      <span className="min-w-16 text-xs tabular-nums text-muted-foreground" aria-live="polite">{count}</span>
      <button type="button" aria-label={t("edlReview.findPrevious")} title={t("edlReview.findPrevious")} disabled={matches.length === 0} className="rounded p-1 hover:bg-muted disabled:opacity-40" onClick={() => step(-1)}>
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label={t("edlReview.findNext")} title={t("edlReview.findNext")} disabled={matches.length === 0} className="rounded p-1 hover:bg-muted disabled:opacity-40" onClick={() => step(1)}>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label={t("edlReview.findClose")} title={t("edlReview.findClose")} className="rounded p-1 hover:bg-muted" onClick={() => onChange({ ...find, open: false, current: -1 })}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
