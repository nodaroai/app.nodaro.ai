/**
 * Markdown export for admin tables — turn the CURRENT filtered dataset into a
 * .md download that can be handed straight to an LLM ("here are the catalog
 * gaps, draft the missing picker entries"). Generic on purpose: any admin page
 * with a paged list endpoint can compose `fetchAllRows` + `markdownTable` +
 * `downloadMarkdown` and get an export button for the full set, not just the
 * visible page.
 */

const EXPORT_PAGE_SIZE = 100
/** Hard cap so a runaway table can't hang the tab; noted in the doc when hit. */
export const EXPORT_MAX_ROWS = 5000

/** Page through a list endpoint until `total` (or the cap) is reached. */
export async function fetchAllRows<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ data: T[]; total: number }>,
): Promise<{ rows: T[]; total: number }> {
  const rows: T[] = []
  let total = 0
  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const page = await fetchPage(offset, EXPORT_PAGE_SIZE)
    rows.push(...page.data)
    total = page.total
    if (rows.length >= total || page.data.length === 0) break
  }
  return { rows: rows.slice(0, EXPORT_MAX_ROWS), total }
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

export function markdownTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`),
  ]
  return lines.join("\n")
}

/** Standard doc header: what this is, when it was exported, which filters were
 *  active (so the LLM knows it may be a subset), and whether the cap trimmed it. */
export function exportPreamble(opts: {
  title: string
  description: string
  filters: Record<string, string>
  rowCount: number
  total: number
}): string {
  const active = Object.entries(opts.filters)
    .filter(([, v]) => v && v !== "all")
    .map(([k, v]) => `${k}=${v}`)
  const lines = [
    `# ${opts.title}`,
    "",
    `Exported ${new Date().toISOString()} · ${opts.rowCount} of ${opts.total} rows` +
      (active.length ? ` · filters: ${active.join(", ")}` : " · no filters"),
    ...(opts.rowCount < opts.total ? [`(truncated at the ${EXPORT_MAX_ROWS}-row export cap)`] : []),
    "",
    opts.description,
    "",
  ]
  return lines.join("\n")
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function exportDateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
