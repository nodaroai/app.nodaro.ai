/**
 * Investigate a specific stuck pipeline. Pass id (full UUID or 8-char prefix).
 * Reports:
 *   - Full pipeline row
 *   - All pipeline_stages rows with status + timing
 *   - All pipeline_entities for the current stage with status + last_error
 *   - LLM call audit for each stage
 *   - Any `jobs` table rows tied to the pipeline (image gen, voice match, etc.)
 *
 * Usage:  cd backend && npx tsx src/scripts/probe-stuck-pipeline.ts <id-or-prefix>
 */
import { config } from "../lib/config.js"
import { createClient } from "@supabase/supabase-js"

const idArg = process.argv[2]
if (!idArg) {
  console.error("usage: probe-stuck-pipeline.ts <pipeline-id-or-prefix>")
  process.exit(1)
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "?"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}min`
}

function fmtDur(start: string | null, end: string | null): string {
  if (!start) return "(not-started)"
  const e = end ? new Date(end).getTime() : Date.now()
  return fmtMs(e - new Date(start).getTime())
}

async function main() {
  // Resolve full id from prefix.
  let pipelineId = idArg
  if (idArg.length < 36) {
    // ilike on uuid columns errors in Postgres. Cast to text via .filter("id::text", ...) — Supabase JS does not expose that.
    // Workaround: pull recent pipelines and prefix-match in JS.
    const { data } = await supabase
      .from("pipelines")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(100)
    const match = (data ?? []).find((row) => (row.id as string).startsWith(idArg))
    if (!match) {
      console.error(`No pipeline matches prefix ${idArg}`)
      process.exit(1)
    }
    pipelineId = match.id as string
  }

  const { data: p } = await supabase
    .from("pipelines")
    .select("*")
    .eq("id", pipelineId)
    .single()
  if (!p) {
    console.error(`Pipeline ${pipelineId} not found`)
    process.exit(1)
  }

  console.log(`=== pipeline ${pipelineId} ===`)
  console.log(JSON.stringify(
    { status: p.status, current_stage: p.current_stage, mode: p.mode, failure_reason: p.failure_reason, reserved_credits: p.reserved_credits, spent_credits: p.spent_credits, created_at: p.created_at, updated_at: p.updated_at },
    null, 2,
  ))

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("started_at", { ascending: true, nullsFirst: true })

  console.log(`\n=== stages (${stages?.length ?? 0}) ===`)
  for (const s of stages ?? []) {
    console.log(`\n[stage] ${s.stage_name} · ${s.status} · dur=${fmtDur(s.started_at, s.completed_at)} · retries=${s.critic_retry_count ?? 0}`)
    if (s.failure_reason) console.log(`        failure_reason: ${s.failure_reason}`)
    if (s.stage_completion_blocked_reason) console.log(`        blocked_reason: ${s.stage_completion_blocked_reason}`)
    if (s.output) {
      const out = typeof s.output === "string" ? JSON.parse(s.output) : s.output
      const keys = Object.keys(out)
      console.log(`        output keys: ${keys.join(", ")}`)
    }

    const { data: calls } = await supabase
      .from("llm_calls")
      .select("role, task, model_id, duration_ms, success, input_tokens, output_tokens, cache_read_input_tokens, error, created_at")
      .eq("stage_id", s.id)
      .order("created_at", { ascending: true })
    const llmTotal = (calls ?? []).reduce((a, c) => a + (c.duration_ms ?? 0), 0)
    console.log(`        LLM total: ${fmtMs(llmTotal)} across ${calls?.length ?? 0} calls`)
    for (const c of calls ?? []) {
      console.log(`          [${c.success ? "ok" : "FAIL"}] ${c.role}/${c.task.padEnd(22)} ${c.model_id.padEnd(20)} ${fmtMs(c.duration_ms).padEnd(8)} in=${c.input_tokens}+cr=${c.cache_read_input_tokens ?? 0} out=${c.output_tokens}${c.error ? ` err=${c.error.slice(0, 80)}` : ""}`)
    }
  }

  // pipeline_entities for the CURRENT stage if it's characters/objects/locations.
  if (p.current_stage && ["characters", "objects", "locations"].includes(p.current_stage)) {
    const entityType =
      p.current_stage === "characters" ? "character" :
      p.current_stage === "objects" ? "object" : "location"
    const { data: entities } = await supabase
      .from("pipeline_entities")
      .select("id, entity_type, entity_key, status, main_asset_id, metadata, created_at")
      .eq("pipeline_id", pipelineId)
      .eq("entity_type", entityType)
      .order("created_at", { ascending: true })

    console.log(`\n=== pipeline_entities (${entities?.length ?? 0}) for ${entityType} ===`)
    for (const e of entities ?? []) {
      const meta = (e.metadata ?? {}) as Record<string, unknown>
      const lastError = meta.last_error ?? meta.last_error_at ?? "—"
      console.log(`  [${e.status}] ${e.entity_key.padEnd(20)} mainAsset=${e.main_asset_id ? "Y" : "N"} last_error=${lastError}`)
    }
  }

  // Jobs tied to this pipeline (image gen, voice match etc).
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, model_identifier, status, provider, started_at, completed_at, error_message, created_at")
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false })
    .limit(30)
  console.log(`\n=== jobs (${jobs?.length ?? 0}, latest 30) ===`)
  for (const j of jobs ?? []) {
    const dur = fmtDur(j.started_at, j.completed_at ?? null)
    console.log(`  [${j.status}] ${(j.model_identifier ?? "?").padEnd(28)} prov=${j.provider ?? "?"} dur=${dur}${j.error_message ? ` err=${j.error_message.slice(0, 80)}` : ""}`)
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[probe] FAILED:", err)
    process.exit(1)
  },
)
