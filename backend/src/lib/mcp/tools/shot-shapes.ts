/**
 * `list_shot_shapes` / `get_shot_shape` — read-only discovery tools for the
 * shot-sequence blueprint catalog.
 *
 * Both tools are ungated (no scope gate) — same posture as `list_models`,
 * `get_node_skill`, and `start_video_director`. They return static catalog data
 * with no DB access and no side effects.
 *
 * Data sourced from:
 *   backend/src/services/shot-sequence/blueprint-params.ts
 *   (BLUEPRINT_IDS, BLUEPRINT_META, BLUEPRINT_PARAM_SCHEMAS)
 *
 * Param schema rendered via `zod-to-json-schema` (already a backend dep).
 */
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpSession } from "../session.js"
import {
  BLUEPRINT_IDS,
  BLUEPRINT_META,
  BLUEPRINT_PARAM_SCHEMAS,
  type BlueprintId,
} from "../../../services/shot-sequence/blueprint-params.js"

/**
 * One worked-params example per blueprint, taken from the video-director
 * doctrine (backend/skills/video-director/doctrine.md). These are filled
 * examples showing real param values the director uses.
 */
const BLUEPRINT_EXAMPLES: Record<BlueprintId, Record<string, unknown>> = {
  "comparison-split": {
    left: "The old way",
    right: "With Nodaro",
    leftBadge: "Hours of work",
    rightBadge: "30 seconds",
    accentColor: "#8B5CF6",
  },
  "constellation-hub": {
    hubLabel: "NODARO",
    nodes: [{ label: "Slack" }, { label: "Notion" }, { label: "Figma" }, { label: "GitHub" }],
    finisher: "orbit",
    accentColor: "#8B5CF6",
  },
  "cta-morph-press": {
    label: "Start free",
    sublabel: "No credit card needed",
    accentColor: "#8B5CF6",
  },
  "cursor-ui-demo": {
    screens: ["https://cdn.nodaro.ai/uploads/ui-1.png", "https://cdn.nodaro.ai/uploads/ui-2.png"],
    targets: [{ xPct: 28, yPct: 42 }, { xPct: 72, yPct: 66 }],
    labels: ["Search anything", "Open the result"],
    cursorColor: "#22D3EE",
    accentColor: "#22D3EE",
  },
  "dataviz-countup": {
    value: 8,
    suffix: "hrs/day",
    label: "wasted on manual work",
    accentColor: "#EF4444",
  },
  "device-surface-showcase": {
    deviceImage: "https://cdn.nodaro.ai/uploads/device.png",
    screens: ["https://cdn.nodaro.ai/uploads/screen-1.png", "https://cdn.nodaro.ai/uploads/screen-2.png"],
    headlines: ["Dashboard", "One-tap export"],
    accentColor: "#8B5CF6",
  },
  "grid-card-assemble": {
    items: [{ label: "Auto-sync" }, { label: "Zero config" }, { label: "Live preview" }],
    columns: 3,
    accentColor: "#8B5CF6",
  },
  "kinetic-type-beats": {
    lines: ["Still guessing?", "There's a better way."],
    accentColor: "#8B5CF6",
  },
  "logo-assemble-lockup": {
    brand: "NODARO",
    tagline: "Motion. On your words.",
    accentColor: "#8B5CF6",
  },
  "overwhelm-surround": {
    surfaces: [{ label: "Email" }, { label: "Editor" }, { label: "Spreadsheet" }],
    markers: ["Slack", "Docs", "Calendar", "Tickets"],
    subjectLabel: "You",
    demands: ["Review this", "Export that", "Re-render", "New format", "Fix timing"],
    accentColor: "#EF4444",
  },
  "spatial-pan-stations": {
    stations: [
      { label: "2019", sublabel: "First cut" },
      { label: "2022", sublabel: "Templates" },
      { label: "Today", sublabel: "Directed by AI" },
    ],
    variant: "timeline",
    accentColor: "#8B5CF6",
  },
  "ticker-takeover": {
    leadIn: "Your next video could be",
    options: ["a demo", "an explainer", "a launch"],
    hero: "NODARO",
    accentColor: "#8B5CF6",
  },
  "titlecard-reveal": {
    title: "10× faster to ship",
    subtitle: "No code. No setup.",
    motion: "slide-up",
  },
  "typewriter-reveal": {
    text: "NODARO",
    sublabel: "Motion. On your words.",
    accentColor: "#8B5CF6",
  },
  "waterfall-reveal": {
    text: "Content, sentiment, engagement",
    sublabel: "All in one place.",
    accentColor: "#8B5CF6",
  },
}

export function registerShotShapeTools(
  server: McpServer,
  _session: McpSession,
): void {
  // ── list_shot_shapes (ungated — pure catalog discovery) ──
  server.registerTool(
    "list_shot_shapes",
    {
      title: "List Shot Shapes",
      description:
        `Return the catalog of all ${BLUEPRINT_IDS.length} shot-sequence blueprints (id, roles, description, ` +
        "defaultDurationFrames). A blueprint is a parameterised shot-shape — a named " +
        "animation beat (e.g. kinetic-type-beats, titlecard-reveal) used inside a " +
        "ShotSequenceBrief. Call this BEFORE authoring a brief to pick the right blueprint " +
        "for each beat role. Text/shape only — blueprints carry no pricing or credit info " +
        "(the standard render-video credit applies to the overall render, not to individual " +
        "blueprints). Read-only, idempotent, free of side effects. No credits.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const shapes = BLUEPRINT_IDS.map((id) => ({
        id,
        ...BLUEPRINT_META[id],
      }))
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shapes, null, 2) }],
      }
    },
  )

  // ── get_shot_shape (ungated — pure catalog discovery) ──
  server.registerTool(
    "get_shot_shape",
    {
      title: "Get Shot Shape",
      description:
        "Return detailed information for a specific shot-sequence blueprint: its metadata " +
        "(roles, description, defaultDurationFrames), a JSON-schema descriptor of the " +
        "params it accepts, and a filled worked example. Use this to inspect a blueprint's " +
        "exact param contract before writing a `blueprint` reveal in a ShotSequenceBrief. " +
        "Text/shape only — blueprints carry no pricing or credit info. " +
        "Read-only, idempotent, free of side effects. No credits.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .max(64)
          .describe(
            `Blueprint id to look up. Known ids: ${BLUEPRINT_IDS.join(", ")}.`,
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args: { id: string }) => {
      const meta = BLUEPRINT_META[args.id as BlueprintId]
      if (!meta) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text:
                `Unknown blueprint id "${args.id}". ` +
                `Known ids: ${BLUEPRINT_IDS.join(", ")}.`,
            },
          ],
        }
      }
      const id = args.id as BlueprintId
      const schema = BLUEPRINT_PARAM_SCHEMAS[id]
      const paramSchema = zodToJsonSchema(schema, { target: "openApi3" })
      const example = BLUEPRINT_EXAMPLES[id]
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id,
                ...meta,
                paramSchema,
                example,
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
