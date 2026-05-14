/**
 * Canonical Film Director reference template — pure data + helpers.
 *
 * Extracted from `backend/scripts/seed-film-template-workflow.ts` so the
 * template constant + comparison helpers can be unit-tested without the
 * script's I/O side effects. The script imports from here for the actual
 * DB seeding, and tests in `backend/src/__tests__/film-template.test.ts`
 * import from here for snapshot + round-trip validation.
 *
 * See the script's docblock for the spec context and the canvas-shape
 * rationale per node type.
 */

// ── Constants ───────────────────────────────────────────────

export const PROJECT_NAME = "nodaro-internal"
export const WORKFLOW_NAME = "Film Director — Reference Template"
export const WORKFLOW_DESCRIPTION =
  "Reference workflow demonstrating manually-constructed node types for " +
  "the Film Director skill (spec §5.4 Layer 2). Seeded by " +
  "backend/scripts/seed-film-template-workflow.ts. Do not edit by hand — " +
  "re-run the seed script to update."

/**
 * UUID v4 (or any-version) format check — lowercase or uppercase. Used to
 * validate `NODARO_SYSTEM_USER_ID` at startup so a malformed paste fails
 * with a clear error instead of an opaque `invalid input syntax for type
 * uuid` from Supabase.
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Template graph ──────────────────────────────────────────
//
// React Flow v12 node shape: { id, type, position: {x, y}, data, ... }.
// Backend stores nodes/edges as separate JSONB columns (`workflows.nodes`,
// `workflows.edges`). Each `data._description` field is read by the skill,
// not the runtime — it's a hint for Claude explaining the node's role.

export interface TemplateNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  width?: number
  height?: number
}

export interface TemplateEdge {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
}

export const TEMPLATE_NODES: readonly TemplateNode[] = [
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
export const TEMPLATE_EDGES: readonly TemplateEdge[] = [] as const

export const TEMPLATE_SETTINGS = {
  _description:
    "Settings for the Film Director reference template. Empty by " +
    "design — the skill does not depend on workflow-level settings.",
} as const

// ── Workflow row shape used by helpers ──────────────────────

export interface WorkflowRow {
  id: string
  nodes: unknown
  edges: unknown
  settings: unknown
  description: string | null
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Deep stable-sort object keys so we can compare against DB rows even after
 * a jsonb round-trip (which doesn't guarantee key order). Arrays are NOT
 * sorted — order matters for the React Flow graph.
 */
export function stableStringify(value: unknown): string {
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

/**
 * True when the on-disk template matches the DB row in every field this
 * script manages (nodes / edges / settings / description). Used to short-
 * circuit the update path when nothing has changed.
 */
export function graphIsUnchanged(existing: WorkflowRow): boolean {
  return (
    stableStringify(existing.nodes) === stableStringify(TEMPLATE_NODES) &&
    stableStringify(existing.edges) === stableStringify(TEMPLATE_EDGES) &&
    stableStringify(existing.settings) === stableStringify(TEMPLATE_SETTINGS) &&
    existing.description === WORKFLOW_DESCRIPTION
  )
}

/**
 * Returns the subset of fields whose stable-stringify differs from the
 * template. The update path uses this to build a minimal UPDATE payload
 * so hand-edits to columns we don't manage (e.g., a manually-toggled
 * `is_template` flag) are preserved.
 */
export function diffWorkflow(
  existing: WorkflowRow,
): {
  nodesChanged: boolean
  edgesChanged: boolean
  settingsChanged: boolean
  descriptionChanged: boolean
} {
  return {
    nodesChanged: stableStringify(existing.nodes) !== stableStringify(TEMPLATE_NODES),
    edgesChanged: stableStringify(existing.edges) !== stableStringify(TEMPLATE_EDGES),
    settingsChanged:
      stableStringify(existing.settings) !== stableStringify(TEMPLATE_SETTINGS),
    descriptionChanged: existing.description !== WORKFLOW_DESCRIPTION,
  }
}
