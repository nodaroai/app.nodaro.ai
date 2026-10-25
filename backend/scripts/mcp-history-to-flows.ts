/**
 * File one account's past MCP jobs into conversation flows (monthly hubs,
 * one conversation per connection and pause), as the live feature files new
 * ones. A one-off for the founder's account, decided 2026-10-24 — not a
 * general backfill.
 *
 * Dry run by default: prints what it would create and writes nothing. With
 * --apply it writes through the same writers the live feature uses
 * (lib/mcp/flows/history.ts). Running it again adds only jobs no
 * conversation holds yet.
 *
 * Usage: cd backend && npx tsx scripts/mcp-history-to-flows.ts --user <userId> [--apply]
 */
import "dotenv/config"
import { applyHistory, loadFiledJobIds, loadHistoryJobs, planHistory } from "../src/lib/mcp/flows/history.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const userId = args[args.indexOf("--user") + 1]
  const apply = args.includes("--apply")
  if (!args.includes("--user") || !userId || !UUID.test(userId)) {
    process.stderr.write("Usage: npx tsx scripts/mcp-history-to-flows.ts --user <userId> [--apply]\n")
    process.exit(2)
  }
  const [jobs, filed] = await Promise.all([loadHistoryJobs(userId), loadFiledJobIds(userId)])
  const plan = planHistory(jobs, filed)
  const steps = plan.conversations.reduce((n, c) => n + c.steps.length, 0)
  const byMonth = new Map<string, number>()
  for (const c of plan.conversations) byMonth.set(c.month, (byMonth.get(c.month) ?? 0) + 1)
  process.stdout.write(`${jobs.length} completed MCP jobs; ${filed.size} already in a conversation.\n`)
  process.stdout.write(`Plan: ${plan.conversations.length} conversations, ${steps} nodes.\n`)
  for (const [month, n] of [...byMonth.entries()].sort()) process.stdout.write(`  ${month}: ${n} conversations\n`)
  process.stdout.write("Left as they are:\n")
  for (const [reason, n] of Object.entries(plan.skipped).sort((a, b) => b[1] - a[1])) process.stdout.write(`  ${n}  ${reason}\n`)
  if (!apply) {
    process.stdout.write("Dry run: nothing written. Run again with --apply to write it.\n")
    return
  }
  const done = await applyHistory(userId, plan)
  process.stdout.write(`Written: ${done.conversations} conversations, ${done.steps} nodes.\n`)
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
