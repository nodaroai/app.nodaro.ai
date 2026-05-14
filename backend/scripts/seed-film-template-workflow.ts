/**
 * Seed the Film Director reference template workflow.
 *
 ***REDACTED-OSS-SCRUB***
 ***REDACTED-OSS-SCRUB***
 *
 * Purpose:
 * The Film Director skill's Stage 0 fetches this workflow via the MCP
 * `get_workflow_json` tool to learn the canonical JSON shape for
 * manually-constructed node types — the ones that don't have a dedicated
 * generation MCP tool (Script display, shot-list table, sticky-note
 * annotations, preview cards, scene containers, etc.). Generation-tool-
 * created nodes (generate_image / animate_image / generate_character / …)
 * are NOT in this template — those tools self-attach the right node
 * structure to the user's workflow when called with `workflowId`.
 *
 * Idempotent: safe to re-run. Looks up by (user_id, project_id, name).
 * On second+ runs with identical TEMPLATE_GRAPH, no DB writes happen. On
 * updates, ONLY the fields whose stable-stringify differs are written —
 * hand-edits to other columns (e.g., a manually-toggled `is_template`
 * flag) are preserved.
 *
 * Required env vars:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (admin, bypasses RLS)
 *   NODARO_SYSTEM_USER_ID     — UUID of the system account that owns the
 *                                "nodaro-internal" project. Must already
 *                                exist as a row in `public.profiles`.
 *                                Validated as a UUID at startup — a
 *                                malformed value fails fast with a clear
 *                                error message (was an opaque pg error).
 *
 * Usage:
 *   cd backend && npx tsx scripts/seed-film-template-workflow.ts
 *   cd backend && npx tsx scripts/seed-film-template-workflow.ts --dry-run
 *
 * `--dry-run` prints the would-be insert/update payload (truncated) without
 * writing to the database. Useful for verifying changes before running on
 * production.
 *
 * NOTE on schema:
 * The `public.workflows` table does NOT have a `slug` column. Spec drafts
 * referenced one — the actual schema (migration 001) uses `name` + `(user_id,
 * project_id)` as the natural key. This script uses `WORKFLOW_NAME` below as
 * the lookup discriminator. If the skill needs a stable URL, it should
 * reference the workflow by UUID (returned at the end of this script).
 *
 * Template node types included (one example each):
 *   - text-prompt    — generic text holder, used as the Script display node
 *                       that anchors Stage 1's approved screenplay on canvas
 *   - list           — N-column table for the Stage 2 shot list
 *   - sticky-note    — director-style annotation (stage notes, TODOs)
 *   - combine-text   — utility: stitch multi-shot prompts into one string
 *   - split-text     — utility: split a multi-line script into per-shot rows
 *   - preview        — utility: assemble visible artifacts for review
 *   - scene          — per-shot container with timing/style/dialogue fields
 *
 * Everything else (generate_image / image_to_video / generate_character /
 * voice_design / suno_generate / lip_sync / combine_videos / …) is reached
 * by calling the matching MCP tool, which builds the right node itself.
 *
 * The pure template constant + helper functions live in
 * `backend/src/lib/film-template.ts` so they can be unit-tested without
 * pulling in this script's I/O side effects.
 */
import "dotenv/config"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  PROJECT_NAME,
  TEMPLATE_EDGES,
  TEMPLATE_NODES,
  TEMPLATE_SETTINGS,
  UUID_REGEX,
  WORKFLOW_DESCRIPTION,
  WORKFLOW_NAME,
  type WorkflowRow,
  diffWorkflow,
  graphIsUnchanged,
} from "../src/lib/film-template.js"

// ── Helpers ─────────────────────────────────────────────────

interface ProjectRow {
  id: string
  name: string
}

async function ensureProject(
  supabase: SupabaseClient,
  systemUserId: string,
  dryRun: boolean,
): Promise<ProjectRow> {
  console.log(`Looking up "${PROJECT_NAME}" project for system user…`)
  const { data: existing, error: selectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", systemUserId)
    .eq("name", PROJECT_NAME)
    .maybeSingle()

  if (selectError) {
    throw new Error(`Failed to look up project: ${selectError.message}`)
  }
  if (existing) {
    console.log(`  → Found existing project ${existing.id}`)
    return existing as ProjectRow
  }

  console.log(`  → Not found, creating…`)
  const insertPayload = {
    user_id: systemUserId,
    name: PROJECT_NAME,
    description:
      "Internal project that owns canonical reference workflows used " +
      "by Nodaro skills (e.g., the Film Director template). Not " +
      "user-facing.",
    settings: {},
  }

  if (dryRun) {
    console.log(`  → [DRY RUN] would INSERT projects:`, truncate(insertPayload))
    return { id: "00000000-0000-0000-0000-000000000000", name: PROJECT_NAME }
  }

  const { data: created, error: insertError } = await supabase
    .from("projects")
    .insert(insertPayload)
    .select("id, name")
    .single()

  if (insertError || !created) {
    throw new Error(
      `Failed to create project: ${insertError?.message ?? "unknown error"}`,
    )
  }
  console.log(`  → Created project ${(created as ProjectRow).id}`)
  return created as ProjectRow
}

/** Truncate a payload preview for dry-run logging — keeps logs readable. */
function truncate(payload: Record<string, unknown>, max = 240): string {
  const json = JSON.stringify(payload)
  return json.length <= max ? json : `${json.slice(0, max)}… (${json.length} chars total)`
}

async function upsertWorkflow(
  supabase: SupabaseClient,
  systemUserId: string,
  projectId: string,
  dryRun: boolean,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  console.log(`Upserting workflow "${WORKFLOW_NAME}"…`)
  const { data: existing, error: selectError } = await supabase
    .from("workflows")
    .select("id, nodes, edges, settings, description")
    .eq("user_id", systemUserId)
    .eq("project_id", projectId)
    .eq("name", WORKFLOW_NAME)
    .maybeSingle()

  if (selectError) {
    throw new Error(`Failed to look up workflow: ${selectError.message}`)
  }

  if (existing) {
    const row = existing as WorkflowRow
    if (graphIsUnchanged(row)) {
      console.log(`  → No changes (already seeded) ✓  (id=${row.id})`)
      return { id: row.id, created: false, changed: false }
    }

    // Build a minimal UPDATE payload: only include fields that actually
    // differ. Preserves hand-edits to columns this script doesn't manage.
    const diff = diffWorkflow(row)
    const updates: Record<string, unknown> = {}
    if (diff.descriptionChanged) updates.description = WORKFLOW_DESCRIPTION
    if (diff.nodesChanged) updates.nodes = TEMPLATE_NODES
    if (diff.edgesChanged) updates.edges = TEMPLATE_EDGES
    if (diff.settingsChanged) updates.settings = TEMPLATE_SETTINGS

    if (Object.keys(updates).length === 0) {
      // Defensive: graphIsUnchanged() said no, but diffWorkflow() says
      // nothing differs. The two helpers should agree — log + skip.
      console.log(`  → No changes after diff (already seeded) ✓  (id=${row.id})`)
      return { id: row.id, created: false, changed: false }
    }

    updates.updated_at = new Date().toISOString()
    const changedFields = Object.keys(updates).filter((k) => k !== "updated_at")
    console.log(
      `  → Found existing workflow ${row.id}, updating fields: [${changedFields.join(", ")}]…`,
    )

    if (dryRun) {
      console.log(`  → [DRY RUN] would UPDATE workflows id=${row.id}:`, truncate(updates))
      return { id: row.id, created: false, changed: true }
    }

    const { error: updateError } = await supabase
      .from("workflows")
      .update(updates)
      .eq("id", row.id)

    if (updateError) {
      throw new Error(`Failed to update workflow: ${updateError.message}`)
    }
    console.log(`  → Updated workflow ${row.id} ✓`)
    return { id: row.id, created: false, changed: true }
  }

  console.log(`  → Not found, inserting…`)
  const insertPayload = {
    user_id: systemUserId,
    project_id: projectId,
    name: WORKFLOW_NAME,
    description: WORKFLOW_DESCRIPTION,
    nodes: TEMPLATE_NODES,
    edges: TEMPLATE_EDGES,
    settings: TEMPLATE_SETTINGS,
  }

  if (dryRun) {
    console.log(`  → [DRY RUN] would INSERT workflows:`, truncate(insertPayload))
    return { id: "00000000-0000-0000-0000-000000000000", created: true, changed: true }
  }

  const { data: created, error: insertError } = await supabase
    .from("workflows")
    .insert(insertPayload)
    .select("id")
    .single()

  if (insertError || !created) {
    throw new Error(
      `Failed to insert workflow: ${insertError?.message ?? "unknown error"}`,
    )
  }
  const row = created as { id: string }
  console.log(`  → Created workflow ${row.id} ✓`)
  return { id: row.id, created: true, changed: true }
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  // CLI args
  const DRY_RUN = process.argv.includes("--dry-run")

  // Env wiring
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const SYSTEM_USER_ID = process.env.NODARO_SYSTEM_USER_ID

  if (!SUPABASE_URL) {
    console.error("Missing env var: SUPABASE_URL")
    process.exit(1)
  }
  if (!SUPABASE_KEY) {
    console.error("Missing env var: SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }
  if (!SYSTEM_USER_ID) {
    console.error(
      "Missing env var: NODARO_SYSTEM_USER_ID (UUID of the system account that owns the nodaro-internal project)",
    )
    process.exit(1)
  }

  // Validate UUID format up front — a malformed value otherwise reaches
  // Supabase and returns an opaque `invalid input syntax for type uuid`
  // error that operators have struggled to debug.
  if (!UUID_REGEX.test(SYSTEM_USER_ID)) {
    console.error(
      `Malformed env var NODARO_SYSTEM_USER_ID: "${SYSTEM_USER_ID}"\n` +
        `   Expected a UUID like "550e8400-e29b-41d4-a716-446655440000".\n` +
        `   Find or create a Nodaro user in the profiles table and copy its id.`,
    )
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log("DRY RUN MODE — no DB writes will occur\n")
  }

  console.log("Seeding Film Director reference template workflow…")
  console.log(`  System user: ${SYSTEM_USER_ID}`)
  console.log(`  Project:     ${PROJECT_NAME}`)
  console.log(`  Workflow:    ${WORKFLOW_NAME}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const project = await ensureProject(supabase, SYSTEM_USER_ID, DRY_RUN)
  const result = await upsertWorkflow(supabase, SYSTEM_USER_ID, project.id, DRY_RUN)

  console.log("")
  if (DRY_RUN) {
    console.log(`Dry run complete ✓ (no writes performed)`)
  } else if (result.created) {
    console.log(`Seeded ✓ (created workflow ${result.id})`)
  } else if (result.changed) {
    console.log(`Seeded ✓ (updated workflow ${result.id})`)
  } else {
    console.log(`No changes (already seeded) ✓ (workflow ${result.id})`)
  }
  console.log("")
  if (!DRY_RUN) {
    console.log(`Skill should reference this workflow by UUID:`)
    console.log(`  ${result.id}`)
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error("\nFatal error:", message)
  process.exit(1)
})
