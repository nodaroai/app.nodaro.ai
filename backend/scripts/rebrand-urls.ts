/**
 * One-time script: replace cdn.scenenode.ai → cdn.nodaro.ai in all DB rows.
 *
 * Usage: cd backend && npx tsx scripts/rebrand-urls.ts
 *        cd backend && npx tsx scripts/rebrand-urls.ts --dry-run
 */
import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const DRY_RUN = process.argv.includes("--dry-run")

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const OLD = "cdn.scenenode.ai"
const NEW = "cdn.nodaro.ai"

function replaceInObj(obj: unknown): unknown {
  if (typeof obj === "string") return obj.replaceAll(OLD, NEW)
  if (Array.isArray(obj)) return obj.map(replaceInObj)
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = replaceInObj(v)
    return out
  }
  return obj
}

// ── Text column updates ─────────────────────────────────────

interface TextColumnDef {
  table: string
  column: string
}

const TEXT_COLUMNS: TextColumnDef[] = [
  { table: "assets", column: "r2_url" },
  { table: "characters", column: "reference_image_url" },
  { table: "characters", column: "source_image_url" },
  { table: "style_presets", column: "thumbnail_url" },
  { table: "profiles", column: "avatar_url" },
  { table: "voice_clones", column: "sample_audio_url" },
  { table: "voice_clones", column: "preview_url" },
  { table: "locations", column: "source_image_url" },
  { table: "locations", column: "main_image_url" },
  { table: "objects", column: "source_image_url" },
  { table: "objects", column: "main_image_url" },
]

async function updateTextColumns() {
  for (const { table, column } of TEXT_COLUMNS) {
    const { data, error } = await supabase
      .from(table)
      .select(`id, ${column}`)
      .like(column, `%${OLD}%`)

    if (error) {
      console.error(`  ERROR reading ${table}.${column}:`, error.message)
      continue
    }
    if (!data || data.length === 0) {
      console.log(`  ${table}.${column}: 0 rows`)
      continue
    }

    console.log(`  ${table}.${column}: ${data.length} rows`)

    if (DRY_RUN) continue

    for (const row of data) {
      const newValue = (row[column] as string).replaceAll(OLD, NEW)
      const { error: updateErr } = await supabase
        .from(table)
        .update({ [column]: newValue })
        .eq("id", row.id)
      if (updateErr) console.error(`    ERROR updating ${table} id=${row.id}:`, updateErr.message)
    }
  }
}

// ── JSONB column updates ────────────────────────────────────

interface JsonColumnDef {
  table: string
  columns: string[]
}

const JSONB_COLUMNS: JsonColumnDef[] = [
  { table: "jobs", columns: ["output_data", "input_data"] },
  { table: "workflows", columns: ["nodes", "edges"] },
  { table: "workflow_history", columns: ["nodes", "edges"] },
  { table: "assets", columns: ["metadata"] },
  { table: "projects", columns: ["settings"] },
  { table: "job_checkpoints", columns: ["data"] },
  { table: "webhook_deliveries", columns: ["payload"] },
  { table: "characters", columns: ["expressions", "poses", "lighting_variations"] },
  { table: "faces", columns: ["expressions"] },
  { table: "locations", columns: ["angles"] },
  { table: "objects", columns: ["angles", "materials", "variations"] },
]

const PAGE_SIZE = 500

async function updateJsonbColumns() {
  for (const { table, columns } of JSONB_COLUMNS) {
    const selectCols = ["id", ...columns].join(", ")

    let from = 0
    let totalUpdated = 0

    // Paginate through all rows and check for matches
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(selectCols)
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        console.error(`  ERROR reading ${table}:`, error.message)
        break
      }
      if (!data || data.length === 0) break

      for (const row of data) {
        const updates: Record<string, unknown> = {}
        for (const col of columns) {
          const val = row[col]
          if (!val) continue
          const serialized = JSON.stringify(val)
          if (!serialized.includes(OLD)) continue
          updates[col] = replaceInObj(val)
        }
        if (Object.keys(updates).length === 0) continue

        totalUpdated++
        if (DRY_RUN) continue

        const { error: updateErr } = await supabase
          .from(table)
          .update(updates)
          .eq("id", row.id)
        if (updateErr) console.error(`    ERROR updating ${table} id=${row.id}:`, updateErr.message)
      }

      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    console.log(`  ${table} [${columns.join(", ")}]: ${totalUpdated} rows`)
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log(`\nRebrand: ${OLD} → ${NEW}`)
  if (DRY_RUN) console.log("(DRY RUN — no writes)\n")
  else console.log("")

  console.log("Text columns:")
  await updateTextColumns()

  console.log("\nJSONB columns:")
  await updateJsonbColumns()

  console.log("\nDone.")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
