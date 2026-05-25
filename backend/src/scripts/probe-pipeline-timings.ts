/**
 * Diagnostic — pulls real timing data from the most recent N pipelines so we
 * can answer "why does Stage 1 take 15 minutes" with numbers, not theory.
 *
 * For each pipeline:
 *   - Per-stage wall-clock duration (started_at → completed_at).
 *   - Per-LLM-call breakdown inside each stage (model, task, duration_ms,
 *     success).
 *   - Critic retry count if surfaced on the stage row.
 *
 * Also reports any pipelines stuck at `current_stage='characters'` with no
 * progress so we can see whether Stage 2 is hanging.
 *
 * Usage:  cd backend && npx tsx src/scripts/probe-pipeline-timings.ts [N]
 */
import { config } from "../lib/config.js"
import { createClient } from "@supabase/supabase-js"

const LIMIT = Number(process.argv[2] ?? "5")
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "?"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}min`
}

function fmtDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "(not-started)"
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  return fmtMs(end - start)
}

async function main() {
  console.log(`[probe] Pulling ${LIMIT} most recent pipelines…\n`)

  const { data: pipelines, error } = await supabase
    .from("pipelines")
    .select(
      "id, status, current_stage, mode, created_at, updated_at, failure_reason",
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT)

  if (error || !pipelines) {
    throw new Error(`failed to load pipelines: ${error?.message}`)
  }

  for (const p of pipelines) {
    console.log(`\n${"=".repeat(72)}`)
    console.log(
      `pipeline ${p.id.slice(0, 8)} · ${p.status} · stage=${p.current_stage ?? "—"} · mode=${p.mode ?? "—"}`,
    )
    if (p.failure_reason) {
      console.log(`  failure_reason: ${p.failure_reason}`)
    }
    const totalDuration = fmtDuration(p.created_at, p.updated_at)
    console.log(`  total: ${totalDuration} (created_at → updated_at)`)

    const { data: stages } = await supabase
      .from("pipeline_stages")
      .select(
        "id, stage_name, status, started_at, completed_at, critic_retry_count, failure_reason",
      )
      .eq("pipeline_id", p.id)
      .order("started_at", { ascending: true })

    for (const s of stages ?? []) {
      const dur = fmtDuration(s.started_at, s.completed_at)
      console.log(
        `  ${s.stage_name.padEnd(20)} ${s.status.padEnd(20)} ${dur.padEnd(8)} retries=${s.critic_retry_count ?? 0}${s.failure_reason ? ` (${s.failure_reason})` : ""}`,
      )

      const { data: calls } = await supabase
        .from("llm_calls")
        .select(
          "role, task, model_id, duration_ms, success, input_tokens, output_tokens, cache_read_input_tokens, error",
        )
        .eq("stage_id", s.id)
        .order("created_at", { ascending: true })

      const totalLlmMs = (calls ?? []).reduce(
        (sum, c) => sum + (c.duration_ms ?? 0),
        0,
      )
      console.log(
        `    LLM total: ${fmtMs(totalLlmMs)} across ${calls?.length ?? 0} calls`,
      )

      for (const c of calls ?? []) {
        const ok = c.success ? "ok" : "FAIL"
        const tokens = `in=${c.input_tokens}+cache=${c.cache_read_input_tokens ?? 0} out=${c.output_tokens}`
        console.log(
          `      [${ok}] ${c.role}/${c.task.padEnd(22)} ${c.model_id.padEnd(20)} ${fmtMs(c.duration_ms).padEnd(8)} ${tokens}${c.error ? ` err=${c.error.slice(0, 60)}` : ""}`,
        )
      }
    }
  }

  // Stuck pipelines — `running` for >5 min on any stage.
  console.log(`\n\n${"=".repeat(72)}`)
  console.log(`STUCK PIPELINES (status=running, latest stage started >5min ago):`)
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  const { data: stuck } = await supabase
    .from("pipeline_stages")
    .select("id, pipeline_id, stage_name, status, started_at, completed_at")
    .eq("status", "running")
    .lt("started_at", fiveMinAgo)
    .order("started_at", { ascending: false })
    .limit(20)
  if (!stuck || stuck.length === 0) {
    console.log("  (none)")
  } else {
    for (const s of stuck) {
      console.log(
        `  pipeline=${s.pipeline_id.slice(0, 8)} stage=${s.stage_name} started=${s.started_at} (${fmtDuration(s.started_at, null)} ago)`,
      )
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[probe] FAILED:", err)
    process.exit(1)
  },
)
