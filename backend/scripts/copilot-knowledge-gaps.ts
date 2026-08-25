/**
 * Copilot knowledge-gap report (Phase 4 of the knowledge-loop plan).
 *
 * Aggregates what the system ALREADY records — error tool_results and server
 * heals inside `copilot_messages`, plus `app_reports` — into a ranked
 * markdown report: "what to teach the copilot next", evidence-based.
 *
 * Read-only. Service-role env required (same as every backend script).
 *
 * Usage:
 *   cd backend && npx tsx scripts/copilot-knowledge-gaps.ts [--days 7]
 *
 * The output is INTERNAL ops material for the private planning repo — never docs/.
 */
import { supabase } from "../src/lib/supabase.js"
import { collectGaps, renderGapReport, type MessageRow } from "../src/ee/copilot/knowledge-gaps.js"

const PAGE = 1000
const MAX_PAGES = 50

function argValue(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag)
  if (i === -1 || !process.argv[i + 1]) return fallback
  const n = Number.parseInt(process.argv[i + 1]!, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

async function main(): Promise<void> {
  const windowDays = argValue("--days", 7)
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const rows: MessageRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("copilot_messages")
      .select("thread_id, content")
      .eq("role", "user")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(`copilot_messages query failed: ${error.message}`)
    const batch = (data ?? []) as MessageRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
    if (page === MAX_PAGES - 1) {
      console.error(`[knowledge-gaps] window truncated at ${rows.length} messages — narrow --days`)
    }
  }

  const { rejections, adjustments } = collectGaps(rows)

  const { data: failureRows } = await supabase
    .from("app_reports")
    .select("title")
    .eq("kind", "copilot-turn-failure")
    .gte("created_at", since)
  const failureCounts = new Map<string, number>()
  for (const row of (failureRows ?? []) as { title: string | null }[]) {
    const title = row.title ?? "(untitled)"
    failureCounts.set(title, (failureCounts.get(title) ?? 0) + 1)
  }

  const contextCounts: { kind: string; count: number }[] = []
  for (const kind of ["validation-reject", "model-rejection"]) {
    const { count } = await supabase
      .from("app_reports")
      .select("id", { count: "exact", head: true })
      .eq("kind", kind)
      .gte("created_at", since)
    contextCounts.push({ kind, count: count ?? 0 })
  }

  const report = renderGapReport({
    windowDays,
    scannedMessages: rows.length,
    rejections,
    adjustments,
    turnFailures: [...failureCounts.entries()]
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => b.count - a.count),
    contextCounts,
  })

  process.stdout.write(report)
}

main().catch((err) => {
  console.error("[knowledge-gaps] failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
