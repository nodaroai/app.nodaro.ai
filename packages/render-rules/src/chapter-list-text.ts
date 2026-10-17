/**
 * A chapter list as show notes (decided 2026-10-14): one line per chapter,
 * "M:SS Title"; once a chapter starts at 1:00:00 or later, every line is
 * "H:MM:SS Title" (the episode's own length does not matter). The first
 * chapter starts at 0 (shown 0:00, where a listener's player starts).
 * The shown times strictly increase (decided 2026-10-17): a chapter that
 * lands on a second already shown — the first line's 0:00 included — is
 * dropped, the first one kept. A title is one line (inner whitespace,
 * newlines included, collapses to one space). The chapter list (`json`) holds
 * exactly the rows the text shows, the first starting at 0 (decided
 * 2026-10-17): both are read from `chapterRowsOf`. Pure.
 */
export interface ChapterRow {
  readonly startMs: number
  readonly title: string
}

const two = (n: number) => String(n).padStart(2, "0")

export function chapterTimestamp(ms: number, withHours: boolean): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return withHours ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

const shownSecond = (ms: number) => Math.floor(ms / 1000)

/**
 * The rows of a chapters plan (`{ version, chapters }`, or a bare list) as the
 * show notes list them: valid rows only, sorted by start, one per shown second
 * (the first row starts at 0; a later row on a second already shown is
 * dropped, the earliest kept).
 */
export function chapterRowsOf(planJson: unknown): ChapterRow[] {
  const list = Array.isArray(planJson)
    ? planJson
    : planJson && typeof planJson === "object" && Array.isArray((planJson as { chapters?: unknown }).chapters)
      ? (planJson as { chapters: unknown[] }).chapters
      : []
  const sorted = list
    .flatMap((c): ChapterRow[] => {
      const row = c as { startMs?: unknown; title?: unknown } | null
      if (!row || typeof row.startMs !== "number" || !Number.isFinite(row.startMs) || typeof row.title !== "string") return []
      const title = row.title.replace(/\s+/g, " ").trim()
      return title ? [{ startMs: Math.max(0, row.startMs), title }] : []
    })
    .sort((a, b) => a.startMs - b.startMs)
  const kept: ChapterRow[] = []
  let lastShown = -1
  for (const row of sorted) {
    // The first row starts at 0 whatever the plan said.
    const shown = kept.length === 0 ? 0 : shownSecond(row.startMs)
    if (shown <= lastShown) continue
    kept.push(kept.length === 0 ? { ...row, startMs: 0 } : row)
    lastShown = shown
  }
  return kept
}

export function formatChapterListText(chapters: readonly ChapterRow[]): string {
  const rows = chapterRowsOf([...chapters])
  if (rows.length === 0) return ""
  // A chapter at 1:00:00 or later switches every line to H:MM:SS.
  const withHours = rows[rows.length - 1]!.startMs >= 3_600_000
  return rows.map((c) => `${chapterTimestamp(c.startMs, withHours)} ${c.title}`).join("\n")
}
