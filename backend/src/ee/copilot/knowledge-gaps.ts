/**
 * Knowledge-gap mining (Phase 4 of the knowledge-loop plan): the copilot's own
 * transcripts already record every rejection it hit and every server heal it
 * triggered — nobody aggregates them. This module is the PURE half: block
 * scanning, normalization into buckets, and the report. The thin runner in
 * `backend/scripts/copilot-knowledge-gaps.ts` owns the queries.
 *
 * A bucket key is a rejection message with its VARIABLE parts collapsed
 * (uuids, quoted names, numbers), so five users hitting the same wall count
 * as one gap with five hits — the ranked list is literally "what to teach
 * next", each line a candidate recipe / skill fix / doctrine line.
 */

export interface MessageRow {
  thread_id: string
  content: unknown
}

interface ContentBlock {
  type?: string
  content?: unknown
  is_error?: boolean
}

export interface GapBucket {
  key: string
  count: number
  threads: string[]
  sample: string
}

export interface GapReportInput {
  windowDays: number
  scannedMessages: number
  rejections: GapBucket[]
  adjustments: GapBucket[]
  turnFailures: { title: string; count: number }[]
  contextCounts: { kind: string; count: number }[]
}

/** `<untrusted-abc123 tool="edit_workflow">\n…\n</untrusted-abc123>` → inner + tool. */
export function stripUntrustedFence(text: string): { toolName: string | null; inner: string } {
  const m = /^<untrusted-[0-9a-f]+ tool="([^"]+)">\n([\s\S]*)\n<\/untrusted-[0-9a-f]+>$/.exec(text.trim())
  if (!m) return { toolName: null, inner: text.trim() }
  return { toolName: m[1] ?? null, inner: (m[2] ?? "").trim() }
}

/** Collapse the variable parts so identical FAILURE SHAPES share one bucket. */
export function normalizeGapKey(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? ""
  return firstLine
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"[^"]{1,80}"/g, '"<name>"')
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 200)
}

function blockText(block: ContentBlock): string {
  if (typeof block.content === "string") return block.content
  if (Array.isArray(block.content)) {
    return (block.content as Array<{ type?: string; text?: string }>)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
  }
  return ""
}

interface Accumulator {
  count: number
  threads: Set<string>
  sample: string
}

function bump(map: Map<string, Accumulator>, key: string, threadId: string, sample: string): void {
  const existing = map.get(key)
  if (existing) {
    existing.count += 1
    existing.threads.add(threadId)
  } else {
    map.set(key, { count: 1, threads: new Set([threadId]), sample })
  }
}

function toBuckets(map: Map<string, Accumulator>): GapBucket[] {
  return [...map.entries()]
    .map(([key, a]) => ({ key, count: a.count, threads: [...a.threads], sample: a.sample }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Scan stored message rows (raw Anthropic blocks) for:
 *  - error tool_results → rejection buckets (keyed tool + normalized first line)
 *  - successful edit_workflow results → the server's `adjustments`/`warnings`
 *    (each heal is a thing the model did not know; recurring heals are gaps too)
 */
export function collectGaps(rows: MessageRow[]): { rejections: GapBucket[]; adjustments: GapBucket[] } {
  const rejections = new Map<string, Accumulator>()
  const adjustments = new Map<string, Accumulator>()

  for (const row of rows) {
    const blocks = Array.isArray(row.content) ? (row.content as ContentBlock[]) : []
    for (const block of blocks) {
      if (block.type !== "tool_result") continue
      const { toolName, inner } = stripUntrustedFence(blockText(block))
      if (!inner) continue

      if (block.is_error) {
        const key = `${toolName ?? "unknown"}: ${normalizeGapKey(inner)}`
        bump(rejections, key, row.thread_id, inner.slice(0, 300))
        continue
      }

      if (toolName === "edit_workflow") {
        try {
          const parsed = JSON.parse(inner) as { adjustments?: unknown; warnings?: unknown }
          for (const list of [parsed.adjustments, parsed.warnings]) {
            if (!Array.isArray(list)) continue
            for (const item of list) {
              if (typeof item !== "string" || !item) continue
              bump(adjustments, normalizeGapKey(item), row.thread_id, item.slice(0, 300))
            }
          }
        } catch {
          // Not JSON (a truncated result) — nothing to mine.
        }
      }
    }
  }

  return { rejections: toBuckets(rejections), adjustments: toBuckets(adjustments) }
}

function bucketSection(title: string, buckets: GapBucket[], emptyLine: string): string[] {
  const lines = [`## ${title}`, ""]
  if (buckets.length === 0) {
    lines.push(emptyLine, "")
    return lines
  }
  for (const bucket of buckets.slice(0, 30)) {
    lines.push(`- **${bucket.count}×** (${bucket.threads.length} thread${bucket.threads.length === 1 ? "" : "s"}) — ${bucket.key}`)
    if (bucket.sample && bucket.sample.split("\n", 1)[0] !== bucket.key) {
      lines.push(`  - sample: ${bucket.sample.split("\n", 1)[0]}`)
    }
  }
  if (buckets.length > 30) lines.push(`- … and ${buckets.length - 30} more buckets`)
  lines.push("")
  return lines
}

/** The ranked markdown report — internal ops material, never docs/. */
export function renderGapReport(input: GapReportInput): string {
  const lines: string[] = [
    `# Copilot knowledge gaps — last ${input.windowDays} day${input.windowDays === 1 ? "" : "s"}`,
    "",
    `Scanned ${input.scannedMessages} stored user-role messages (tool results ride there).`,
    "Each line is a candidate fix, at the most durable layer that covers it:",
    "catalog/normalizer > node skill > recipe > doctrine.",
    "",
    ...bucketSection("Tool rejections (the model hit a wall)", input.rejections, "None in the window — no walls hit."),
    ...bucketSection(
      "Server heals (edit_workflow adjustments/warnings — silent gaps)",
      input.adjustments,
      "None in the window — every edit landed as sent.",
    ),
    "## Turn failures (app_reports: copilot-turn-failure)",
    "",
  ]
  if (input.turnFailures.length === 0) {
    lines.push("None in the window.", "")
  } else {
    for (const failure of input.turnFailures) lines.push(`- **${failure.count}×** ${failure.title}`)
    lines.push("")
  }
  lines.push("## Context (platform-wide, NOT copilot-attributed)", "")
  for (const item of input.contextCounts) lines.push(`- ${item.kind}: ${item.count}`)
  lines.push("")
  return lines.join("\n")
}
