/**
 * `list_brand_presets` — read-only discovery tool for the brand-token preset
 * library.
 *
 * Ungated (no scope gate) — same posture as `list_shot_shapes`, `list_models`,
 * `get_node_skill`, and `start_video_director`. Returns static catalog data
 * with no DB access and no side effects.
 *
 * Data sourced from:
 *   @nodaro/shared (BRAND_PRESET_IDS, BRAND_PRESETS, BRAND_PRESET_META)
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpSession } from "../session.js"
import { BRAND_PRESET_IDS, BRAND_PRESETS, BRAND_PRESET_META } from "@nodaro/shared"

/** Pure catalog builder (unit-testable without an McpServer). */
export function listBrandPresets() {
  return BRAND_PRESET_IDS.map((id) => {
    const t = BRAND_PRESETS[id]
    const m = BRAND_PRESET_META[id]
    return {
      id,
      label: m.label,
      mood: m.mood,
      description: m.description,
      palette: { bg: t.palette.bg, text: t.palette.text, accent: t.palette.accent },
      fonts: t.fonts,
    }
  })
}

export function registerBrandPresetTools(
  server: McpServer,
  _session: McpSession,
): void {
  // ── list_brand_presets (ungated — pure catalog discovery) ──
  server.registerTool(
    "list_brand_presets",
    {
      title: "List Brand Presets",
      description:
        `Return the catalog of all ${BRAND_PRESET_IDS.length} brand-token presets (id, label, ` +
        "mood, description, palette summary, fonts). A brand preset is a named " +
        "palette+font pairing (e.g. midnight-violet, editorial-cream) passed as the " +
        "`brand` param to the video director so every blueprint accent and text style " +
        "stays consistent. Call this BEFORE authoring a brief that specifies a brand to " +
        "pick the right preset id. Read-only, idempotent, free of side effects. No credits.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(listBrandPresets(), null, 2) }],
      }
    },
  )
}
