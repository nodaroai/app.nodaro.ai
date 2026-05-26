/**
 * One-shot recovery — marks a stuck workflow_execution as `cancelled` or
 * `completed`. Use when the orchestrator process died mid-execution and
 * left the row sitting at `status='running'` with no live worker to
 * advance it.
 *
 * The execution's child `jobs` rows are NOT touched — already-completed
 * children stay completed (credits already committed). If you also want
 * to cancel any still-pending children, use the user-facing
 * `POST /v1/workflow-executions/:id/cancel` route, which goes through the
 * same path as the cancel button in the UI and refunds reserved credits.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/recover-stuck-execution.ts <execution-id>
 *   cd backend && npx tsx src/scripts/recover-stuck-execution.ts <execution-id> --mode=completed
 *   cd backend && npx tsx src/scripts/recover-stuck-execution.ts <execution-id> --dry
 *
 * Hard-requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in backend/.env.
 */
import { config } from "../lib/config.js"
import { createClient } from "@supabase/supabase-js"

const executionId = process.argv[2]
const modeArg = process.argv.find((a) => a.startsWith("--mode="))
const mode = (modeArg?.split("=")[1] ?? "cancelled") as "cancelled" | "completed"
const dryRun = process.argv.includes("--dry") || process.argv.includes("--dry-run")

if (!executionId) {
  console.error(
    "Usage: tsx src/scripts/recover-stuck-execution.ts <execution-id> [--mode=cancelled|completed] [--dry]",
  )
  process.exit(1)
}

if (mode !== "cancelled" && mode !== "completed") {
  console.error(`Invalid --mode value: ${mode}. Allowed: cancelled, completed.`)
  process.exit(1)
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await supabase
  .from("workflow_executions")
  .select("id, status, started_at, completed_at, node_states")
  .eq("id", executionId)
  .single()

if (error || !data) {
  console.error(`Could not find execution ${executionId}:`, error?.message ?? "not found")
  process.exit(1)
}

const states = (data.node_states ?? {}) as Record<string, { status?: string }>
const counts = { completed: 0, running: 0, pending: 0, failed: 0, cancelled: 0, skipped: 0, other: 0 }
for (const s of Object.values(states)) {
  const key = (s?.status ?? "other") as keyof typeof counts
  if (key in counts) counts[key]++
  else counts.other++
}

console.log(`Found execution ${executionId}:`)
console.log(`  status:        ${data.status}`)
console.log(`  started_at:    ${data.started_at}`)
console.log(`  completed_at:  ${data.completed_at ?? "(null)"}`)
console.log(`  node counts:   completed=${counts.completed} running=${counts.running} pending=${counts.pending} failed=${counts.failed} cancelled=${counts.cancelled} skipped=${counts.skipped}`)

if (data.status !== "running" && data.status !== "stopping" && data.status !== "pending") {
  console.error(`Execution is not in an active state (status=${data.status}). Refusing to overwrite a terminal row.`)
  process.exit(1)
}

if (dryRun) {
  console.log(`[dry-run] Would mark execution as '${mode}'.`)
  process.exit(0)
}

const updates: Record<string, unknown> = {
  status: mode,
  completed_at: new Date().toISOString(),
}
if (mode === "cancelled") {
  updates.error_message = "Recovered via recover-stuck-execution.ts"
}

const { error: updateError } = await supabase
  .from("workflow_executions")
  .update(updates)
  .eq("id", executionId)
  // .neq("status", "cancelled") protects against overwriting a user
  // cancellation that lands between this script's SELECT and UPDATE.
  .neq("status", "cancelled")

if (updateError) {
  console.error(`Failed to update execution:`, updateError.message)
  process.exit(1)
}

console.log(`✓ Marked execution ${executionId} as '${mode}'.`)
process.exit(0)
