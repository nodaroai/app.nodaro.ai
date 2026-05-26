/**
 * One-shot cleanup — cancels pipelines that have been silently stuck at
 * `status='running'` for more than the cutoff (default 2 hours). Runs the
 * same transaction the user-facing POST /v1/pipelines/:id/cancel route
 * runs:
 *   - flip pipelines.status to 'cancelled'
 *   - clear current_progress_message
 *   - flip in-flight pipeline_stages rows to 'cancelled'
 *   - refund reserved-minus-spent credits with reason='abandoned_by_cleanup'
 *
 * Used after deploys that fix orchestrator crashes (and as a one-shot
 * after the cross-process-bridge + cancel-propagation fixes shipped) to
 * close out pipelines whose workers died mid-run and never updated the DB.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/cleanup-stuck-pipelines.ts            # default: 120 min cutoff
 *   cd backend && npx tsx src/scripts/cleanup-stuck-pipelines.ts 60         # custom cutoff (min)
 *   cd backend && npx tsx src/scripts/cleanup-stuck-pipelines.ts 120 --dry  # preview only
 *
 * Hard-requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env.
 */
import { config } from "../lib/config.js"
import { createClient } from "@supabase/supabase-js"
import { refundPipelineCredits } from "../ee/pipelines/credits.js"

const cutoffMinutes = Number(process.argv[2] ?? "120")
const dryRun = process.argv.includes("--dry") || process.argv.includes("--dry-run")

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

function fmtAge(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

async function main() {
  const cutoffIso = new Date(Date.now() - cutoffMinutes * 60_000).toISOString()
  console.log(
    `[cleanup-stuck-pipelines] cutoff=${cutoffMinutes}min (updated_at < ${cutoffIso}) dry=${dryRun}`,
  )

  const { data: stuck, error } = await supabase
    .from("pipelines")
    .select(
      "id, user_id, status, current_stage, reserved_credits, spent_credits, updated_at",
    )
    .eq("status", "running")
    .lt("updated_at", cutoffIso)
    .order("updated_at", { ascending: true })
  if (error) throw new Error(`load failed: ${error.message}`)

  console.log(`\nFound ${stuck?.length ?? 0} stuck pipeline(s)\n`)
  if (!stuck || stuck.length === 0) {
    process.exit(0)
  }

  let cleaned = 0
  let refunded = 0
  for (const p of stuck) {
    const pipelineId = p.id as string
    const userId = p.user_id as string
    const reserved = Number(p.reserved_credits ?? 0)
    const spent = Number(p.spent_credits ?? 0)
    const refund = Math.max(0, reserved - spent)

    console.log(
      `  ${pipelineId.slice(0, 8)}… stage=${p.current_stage ?? "-"} stuck=${fmtAge(p.updated_at as string)} reserved=${reserved} spent=${spent} refund=${refund}`,
    )

    if (dryRun) continue

    const cancelledAt = new Date().toISOString()

    // Flip pipelines row.
    const { error: pErr } = await supabase
      .from("pipelines")
      .update({
        status: "cancelled",
        cancelled_at: cancelledAt,
        current_progress_message: null,
        failure_reason: "abandoned_by_cleanup",
      })
      .eq("id", pipelineId)
    if (pErr) {
      console.error(`    ✗ pipelines update failed: ${pErr.message}`)
      continue
    }

    // Flip any in-flight pipeline_stages rows. Same defensive cascade
    // the cancel route does (PR #2773) — without this they stay at
    // 'running' forever and the next admin sweep re-detects them.
    const { error: sErr } = await supabase
      .from("pipeline_stages")
      .update({ status: "cancelled", completed_at: cancelledAt })
      .eq("pipeline_id", pipelineId)
      .eq("status", "running")
    if (sErr) {
      console.error(`    ✗ stages update failed: ${sErr.message}`)
    }

    // Refund unspent credits — reason tag distinguishes admin-driven
    // cleanups from user-initiated cancels in the credit transactions log.
    if (refund > 0) {
      try {
        await refundPipelineCredits({
          supabase,
          userId,
          pipelineId,
          credits: refund,
          reason: "pipeline_abandoned",
        })
        refunded += refund
      } catch (err) {
        console.error(
          `    ✗ refund failed: ${err instanceof Error ? err.message : err}`,
        )
      }
    }
    cleaned += 1
  }

  console.log(
    `\n[cleanup-stuck-pipelines] ${dryRun ? "DRY RUN — no changes made" : `Cleaned ${cleaned} pipeline(s), refunded ${refunded} credits total`}`,
  )
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[cleanup-stuck-pipelines] FAILED:", err)
    process.exit(1)
  },
)
