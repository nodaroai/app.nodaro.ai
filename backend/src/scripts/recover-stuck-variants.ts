/**
 * One-shot admin recovery for character entities stuck at status='approved'
 * without variants. Reproduces what POST /v1/pipelines/:id/entities/:eid/
 * retry-variants does, but bulk + service-role + no UI dependency.
 *
 * Symptom this addresses: pipelines 65c57374 and acf01be1 (both 2026-05-26)
 * landed at Stage 2 with 1 character having full variant set + 3 character
 * entities at status='approved' with zero pipeline_entity_variants rows AND
 * no variant_generation_error / variants_failed_count metadata. The engine
 * silently skipped variant generation for them; the post-loop variant-batch
 * gate then required every(variants_awaiting_approval=true) and exited
 * without transitioning. Stage row stuck at status='running' forever.
 *
 * Usage:
 *   npx tsx src/scripts/recover-stuck-variants.ts             # all stuck pipelines (default 30min stale cutoff)
 *   npx tsx src/scripts/recover-stuck-variants.ts <pipelineId># specific pipeline
 *   npx tsx src/scripts/recover-stuck-variants.ts --dry       # preview only (works with both)
 */
import { config } from "../lib/config.js"
import { createClient } from "@supabase/supabase-js"
import { enqueuePipelineRun } from "../ee/pipelines/queue.js"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry") || args.includes("--dry-run")
const pipelineIdArg = args.find((a) => !a.startsWith("--"))

const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
)

interface StuckEntity {
  id: string
  entity_key: string
  pipelineId: string
  userId: string
  hasFailureMarkers: boolean
}

async function findStuckEntities(): Promise<StuckEntity[]> {
  // Find running pipelines (filtered by id if user passed one).
  let q = supabase
    .from("pipelines")
    .select("id, user_id, status, current_stage")
    .eq("status", "running")
    .eq("current_stage", "characters")
  if (pipelineIdArg) q = q.eq("id", pipelineIdArg)
  const { data: pipelines, error } = await q
  if (error) throw new Error("pipelines query failed: " + error.message)

  const stuck: StuckEntity[] = []
  for (const p of pipelines ?? []) {
    const { data: entities } = await supabase
      .from("pipeline_entities")
      .select("id, entity_key, status, metadata")
      .eq("pipeline_id", p.id as string)
      .eq("entity_type", "character")
      .eq("status", "approved")
    for (const e of entities ?? []) {
      const meta = (e.metadata ?? {}) as Record<string, unknown>
      // Skip entities that already have variants_awaiting_approval set —
      // those completed successfully and don't need recovery.
      if (meta.variants_awaiting_approval === true) continue

      // Check if any variants exist (approved OR pending). If pending,
      // generation is in flight — leave it alone.
      const { data: variants } = await supabase
        .from("pipeline_entity_variants")
        .select("variant_key, status")
        .eq("entity_id", e.id as string)
      const hasPending = (variants ?? []).some((v) => v.status === "pending")
      const hasApproved = (variants ?? []).some(
        (v) => v.status === "approved",
      )
      // Skip if there are pending generations — not stuck, just slow.
      if (hasPending) continue
      // Skip if there are approved variants AND the metadata is in flight
      // (partial-failure path with failed rows already cleaned up).
      const hasFailureMarkers =
        typeof meta.variant_generation_error === "string" ||
        (typeof meta.variants_failed_count === "number" &&
          (meta.variants_failed_count as number) > 0)
      if (hasApproved && !hasFailureMarkers) continue

      stuck.push({
        id: e.id as string,
        entity_key: e.entity_key as string,
        pipelineId: p.id as string,
        userId: p.user_id as string,
        hasFailureMarkers,
      })
    }
  }
  return stuck
}

async function recoverEntity(stuck: StuckEntity): Promise<void> {
  // Delete any failed variant rows (mirrors retry-variants route).
  await supabase
    .from("pipeline_entity_variants")
    .delete()
    .eq("entity_id", stuck.id)
    .eq("status", "failed")

  // Clear failure markers from entity metadata.
  const { data: entity } = await supabase
    .from("pipeline_entities")
    .select("metadata")
    .eq("id", stuck.id)
    .single()
  if (entity) {
    const meta = (entity.metadata ?? {}) as Record<string, unknown>
    const cleared: Record<string, unknown> = { ...meta }
    delete cleared.variants_failed_count
    delete cleared.variants_total_count
    delete cleared.variant_generation_error
    delete cleared.variant_generation_error_at
    await supabase
      .from("pipeline_entities")
      .update({ metadata: cleared })
      .eq("id", stuck.id)
  }
}

async function main() {
  console.log(
    `[recover-stuck-variants] scope=${pipelineIdArg ?? "all-running-characters-pipelines"} dry=${dryRun}`,
  )

  const stuck = await findStuckEntities()
  console.log(`\nFound ${stuck.length} stuck entit${stuck.length === 1 ? "y" : "ies"}\n`)
  if (stuck.length === 0) {
    process.exit(0)
  }

  // Group by pipeline for the enqueue (one enqueue per pipeline regardless
  // of how many entities it has stuck — drivePipeline reprocesses all).
  const byPipeline = new Map<string, { userId: string; entities: StuckEntity[] }>()
  for (const s of stuck) {
    if (!byPipeline.has(s.pipelineId)) {
      byPipeline.set(s.pipelineId, { userId: s.userId, entities: [] })
    }
    byPipeline.get(s.pipelineId)!.entities.push(s)
  }

  for (const [pipelineId, info] of byPipeline) {
    console.log(`pipeline ${pipelineId.slice(0, 8)}…`)
    for (const e of info.entities) {
      const markers = e.hasFailureMarkers ? " (has failure markers)" : ""
      console.log(`  - ${e.entity_key}${markers}`)
      if (!dryRun) await recoverEntity(e)
    }
    if (!dryRun) {
      await enqueuePipelineRun({
        pipelineId,
        userId: info.userId,
        reason: "stage_advance",
      })
      console.log(`  → enqueued drivePipeline`)
    }
  }

  console.log(
    `\n[recover-stuck-variants] ${dryRun ? "DRY RUN — no changes" : `Recovered ${stuck.length} entit${stuck.length === 1 ? "y" : "ies"} across ${byPipeline.size} pipeline${byPipeline.size === 1 ? "" : "s"}`}`,
  )
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[recover-stuck-variants] FAILED:", err)
    process.exit(1)
  },
)
