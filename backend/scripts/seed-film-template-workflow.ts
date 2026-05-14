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
 * On second+ runs with identical TEMPLATE_GRAPH, no DB writes happen.
 *
 * Required env vars:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (admin, bypasses RLS)
 *   NODARO_SYSTEM_USER_ID     — UUID of the system account that owns the
 *                                "nodaro-internal" project. Must already
 *                                exist as a row in `public.profiles`.
 *
 * Usage:
 *   cd backend && npx tsx scripts/seed-film-template-workflow.ts
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
 */
import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

// ── Env wiring ──────────────────────────────────────────────

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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── Constants ───────────────────────────────────────────────

const PROJECT_NAME = "nodaro-internal"
const WORKFLOW_NAME = "Film Director — Reference Template"
const WORKFLOW_DESCRIPTION =
  "Reference workflow demonstrating manually-constructed node types for " +
  "the Film Director skill (spec §5.4 Layer 2). Seeded by " +
  "backend/scripts/seed-film-template-workflow.ts. Do not edit by hand — " +
  "re-run the seed script to update."

// ── Template graph ──────────────────────────────────────────
//
// React Flow v12 node shape: { id, type, position: {x, y}, data, ... }.
// Backend stores nodes/edges as separate JSONB columns (`workflows.nodes`,
// `workflows.edges`). Each `data._description` field is read by the skill,
// not the runtime — it's a hint for Claude explaining the node's role.

interface TemplateNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  width?: number
  height?: number
}

interface TemplateEdge {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
}

const TEMPLATE_NODES: readonly TemplateNode[] = [
  // ── Stage 1: Script display ──────────────────────────────
  {
    id: "tpl_script_display",
    type: "text-prompt",
    position: { x: 0, y: 0 },
    data: {
      _description:
        "Stage 1 'Script display' node. After the user approves the " +
        "screenplay, the skill writes the full text here so the canvas " +
        "shows the script as the first artifact. Use this exact shape: " +
        "type='text-prompt', data.text=<screenplay string>, " +
        "data.label='Script', data.variables={}.",
      label: "Script",
      text:
        "FADE IN:\n\n" +
        "EXT. SEASIDE CLIFF — GOLDEN HOUR\n\n" +
        "A lone figure stands at the edge, wind catching their coat. " +
        "They look out over the water, unmoving.\n\n" +
        "FADE OUT.",
      variables: {},
    },
    width: 360,
    height: 220,
  },

  // ── Stage 2: Shot list (table) ───────────────────────────
  {
    id: "tpl_shot_list",
    type: "list",
    position: { x: 440, y: 0 },
    data: {
      _description:
        "Stage 2 'Shot list' node. Each row is one shot. Columns: " +
        "shot_number (text), description (text), duration_s (text), " +
        "camera (text), notes (text). The skill writes the approved " +
        "shot list here after Stage 2 negotiation.",
      label: "Shot List",
      columns: [
        { id: "col_shot", name: "Shot", handleId: "col_shot", type: "text" },
        { id: "col_desc", name: "Description", handleId: "col_desc", type: "text" },
        { id: "col_dur", name: "Duration (s)", handleId: "col_dur", type: "text" },
        { id: "col_cam", name: "Camera", handleId: "col_cam", type: "text" },
        { id: "col_notes", name: "Notes", handleId: "col_notes", type: "text" },
      ],
      rows: [
        ["1", "Wide establishing — cliff at golden hour", "5", "Wide, static", "Anchor frame for sequence"],
        ["2", "Medium — figure's back, wind in coat", "4", "Medium, slight push-in", "Match cliff geo from shot 1"],
        ["3", "Close — face in profile, eyes on horizon", "3", "Close-up, static", "Same lighting key"],
      ],
      fieldMappings: {},
      viewMode: "list",
    },
    width: 720,
    height: 320,
  },

  // ── Director annotations ─────────────────────────────────
  {
    id: "tpl_sticky_note",
    type: "sticky-note",
    position: { x: 0, y: 320 },
    data: {
      _description:
        "Free-form annotation. Use one or more sticky notes for director " +
        "notes (continuity reminders, lighting cues, post-pipeline TODOs). " +
        "Color hex is free-form; default dark navy with white text. " +
        "Width/height define the canvas footprint in pixels.",
      label: "Director Notes",
      text:
        "Continuity:\n" +
        "• Shot 1 → Shot 2: match cliff geometry and sun angle.\n" +
        "• Shot 2 → Shot 3: identical key-light direction.\n" +
        "\n" +
        "Audio:\n" +
        "• Score: ambient strings, low register.\n" +
        "• SFX: wind bed across all three shots.",
      color: "#2d2d44",
      textColor: "#ffffff",
      width: 360,
      height: 260,
      fontSize: "base",
      bold: false,
      italic: false,
      alignment: "left",
    },
    width: 360,
    height: 260,
  },

  // ── Utility: combine-text (stitch prompts) ───────────────
  {
    id: "tpl_combine_text",
    type: "combine-text",
    position: { x: 440, y: 380 },
    data: {
      _description:
        "Utility that joins multiple upstream text outputs into one " +
        "string. Useful when a prompt is composed from several Text " +
        "Prompt nodes (e.g., character description + setting + camera). " +
        "Auto-executes — no Run button needed.",
      label: "Combine Prompt Parts",
      separator: "newline",
      customSeparator: "",
      combinedText: "",
    },
    width: 320,
    height: 160,
  },

  // ── Utility: split-text (script → per-shot rows) ─────────
  {
    id: "tpl_split_text",
    type: "split-text",
    position: { x: 800, y: 380 },
    data: {
      _description:
        "Utility that splits a multi-line string into individual rows " +
        "that downstream list/loop nodes can iterate over. Default " +
        "separator is newline. Auto-executes.",
      label: "Split Script Into Shots",
      separator: "double-newline",
      customSeparator: "",
      trimWhitespace: true,
      removeEmpty: true,
    },
    width: 320,
    height: 160,
  },

  // ── Preview pane (review canvas) ─────────────────────────
  {
    id: "tpl_preview",
    type: "preview",
    position: { x: 1160, y: 380 },
    data: {
      _description:
        "Read-only collector that displays whatever upstream nodes " +
        "feed it (text, images, video, audio). Use one Preview at the " +
        "end of each stage so the user can sanity-check the artifacts " +
        "before moving on. `previewItems` and `itemOrder` are populated " +
        "by the runtime — start them empty.",
      label: "Review Pane",
      previewItems: [],
      itemOrder: [],
    },
    width: 480,
    height: 320,
  },

  // ── Per-shot scene container ─────────────────────────────
  {
    id: "tpl_scene_example",
    type: "scene",
    position: { x: 0, y: 720 },
    data: {
      _description:
        "Per-shot 'Scene' container — holds the full creative brief for " +
        "one shot (duration, framing, lens, lighting, mood, dialogue). " +
        "The skill spawns one Scene node per row of the Shot List. The " +
        "generated_* fields are runtime-only; start them empty/idle so " +
        "the canvas shows the node in its un-run state.",
      label: "Scene 1",
      sceneName: "Cliff — Wide Establishing",
      sceneNumber: 1,
      duration: 5,
      summary: "Lone figure on seaside cliff at golden hour. Wide static.",
      characters: [],
      dialogue: [],
      locations: [],
      timeOfDay: "sunset",
      weather: "clear",
      lighting: "natural",
      objects: [],
      aspectRatio: "16:9",
      shotType: "wide",
      cameraAngle: "eye-level",
      cameraMovement: "static",
      depthOfField: "deep",
      lensType: "wide",
      mood: ["contemplative"],
      colorPalette: ["amber", "teal"],
      visualStyle: "cinematic",
      narration: "",
      musicMood: "ambient-strings",
      soundEffects: ["wind"],
      transitionIn: "cut",
      transitionOut: "cut",
      directorNotes: "Anchor frame; match geometry into shot 2.",
      referenceUrls: [],
      generatedPrompt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      generatedImageUrl: "",
      fieldMappings: {},
      sourceScriptNodeId: "",
      sourceSceneIndex: -1,
      autoSyncWithScript: false,
      audioAssignments: [],
      videoProvider: "minimax",
      generatedVideoResults: [],
      activeVideoResultIndex: 0,
      generatedVideoUrl: "",
      videoExecutionStatus: "idle",
    },
    width: 480,
    height: 600,
  },
] as const

// No edges in the template — its purpose is structural reference, not flow.
// The skill builds edges itself when wiring real workflows together.
const TEMPLATE_EDGES: readonly TemplateEdge[] = [] as const

const TEMPLATE_SETTINGS = {
  _description:
    "Settings for the Film Director reference template. Empty by " +
    "design — the skill does not depend on workflow-level settings.",
} as const

// ── Helpers ─────────────────────────────────────────────────

interface ProjectRow {
  id: string
  name: string
}

interface WorkflowRow {
  id: string
  nodes: unknown
  edges: unknown
  settings: unknown
  description: string | null
}

async function ensureProject(): Promise<ProjectRow> {
  console.log(`Looking up "${PROJECT_NAME}" project for system user…`)
  const { data: existing, error: selectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", SYSTEM_USER_ID)
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
  const { data: created, error: insertError } = await supabase
    .from("projects")
    .insert({
      user_id: SYSTEM_USER_ID,
      name: PROJECT_NAME,
      description:
        "Internal project that owns canonical reference workflows used " +
        "by Nodaro skills (e.g., the Film Director template). Not " +
        "user-facing.",
      settings: {},
    })
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

function stableStringify(value: unknown): string {
  // Deep stable sort keys so we can compare against DB rows even if the
  // jsonb roundtrip re-orders fields. Doesn't sort arrays — order matters
  // for the React Flow graph.
  return JSON.stringify(value, function replacer(_, v: unknown): unknown {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const ordered: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        ordered[k] = (v as Record<string, unknown>)[k]
      }
      return ordered
    }
    return v
  })
}

function graphIsUnchanged(existing: WorkflowRow): boolean {
  return (
    stableStringify(existing.nodes) === stableStringify(TEMPLATE_NODES) &&
    stableStringify(existing.edges) === stableStringify(TEMPLATE_EDGES) &&
    stableStringify(existing.settings) === stableStringify(TEMPLATE_SETTINGS) &&
    existing.description === WORKFLOW_DESCRIPTION
  )
}

async function upsertWorkflow(projectId: string): Promise<{ id: string; created: boolean; changed: boolean }> {
  console.log(`Upserting workflow "${WORKFLOW_NAME}"…`)
  const { data: existing, error: selectError } = await supabase
    .from("workflows")
    .select("id, nodes, edges, settings, description")
    .eq("user_id", SYSTEM_USER_ID)
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
    console.log(`  → Found existing workflow ${row.id}, applying update…`)
    const { error: updateError } = await supabase
      .from("workflows")
      .update({
        nodes: TEMPLATE_NODES,
        edges: TEMPLATE_EDGES,
        settings: TEMPLATE_SETTINGS,
        description: WORKFLOW_DESCRIPTION,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)

    if (updateError) {
      throw new Error(`Failed to update workflow: ${updateError.message}`)
    }
    console.log(`  → Updated workflow ${row.id} ✓`)
    return { id: row.id, created: false, changed: true }
  }

  console.log(`  → Not found, inserting…`)
  const { data: created, error: insertError } = await supabase
    .from("workflows")
    .insert({
      user_id: SYSTEM_USER_ID,
      project_id: projectId,
      name: WORKFLOW_NAME,
      description: WORKFLOW_DESCRIPTION,
      nodes: TEMPLATE_NODES,
      edges: TEMPLATE_EDGES,
      settings: TEMPLATE_SETTINGS,
    })
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
  console.log("Seeding Film Director reference template workflow…")
  console.log(`  System user: ${SYSTEM_USER_ID}`)
  console.log(`  Project:     ${PROJECT_NAME}`)
  console.log(`  Workflow:    ${WORKFLOW_NAME}\n`)

  const project = await ensureProject()
  const result = await upsertWorkflow(project.id)

  console.log("")
  if (result.created) {
    console.log(`Seeded ✓ (created workflow ${result.id})`)
  } else if (result.changed) {
    console.log(`Seeded ✓ (updated workflow ${result.id})`)
  } else {
    console.log(`No changes (already seeded) ✓ (workflow ${result.id})`)
  }
  console.log("")
  console.log(`Skill should reference this workflow by UUID:`)
  console.log(`  ${result.id}`)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error("\nFatal error:", message)
  process.exit(1)
})
