import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"

const readGate: ToolGate = { required: ["assets:read"] }

/**
 * Character discovery tools.
 *
 * `list_characters` returns a flat list of the caller's characters with
 * summary fields (portrait URL, asset counts, identity copy). `get_character`
 * returns the full record for one character — every expression/pose/motion/
 * angle/lighting variant with its URL, plus reference photos and per-variant
 * real-life-ref URLs.
 *
 * Use case: an LLM client asks the user to "make a photo of Kira smiling and
 * Shira laughing at the park". The model calls `list_characters` → finds
 * matching names → calls `get_character` on each → picks the expression URLs
 * that match "smile" / "laugh" → passes those URLs as references to
 * `generate_image` / `image_to_image`.
 *
 * Both tools are scoped to `session.userId` (the service-role client bypasses
 * RLS, so the manual `user_id` filter is the only thing keeping characters
 * from leaking across users). Archived characters (`deleted_at IS NOT NULL`)
 * are excluded — they're not selectable in the editor either.
 *
 * Gated on `assets:read` (same scope as the gallery; characters are
 * reference-asset entities).
 */

interface AssetEntry {
  name: string
  url: string
}

interface ReferencePhoto {
  url: string
  kind: string
}

interface CharacterRow {
  id: string
  name: string
  description: string | null
  canonical_description: string | null
  source_image_url: string | null
  seed_prompt: string | null
  gender: string | null
  style: string | null
  base_outfit: string | null
  expressions: AssetEntry[] | null
  poses: AssetEntry[] | null
  motions: AssetEntry[] | null
  angles: AssetEntry[] | null
  body_angles: AssetEntry[] | null
  lighting_variations: AssetEntry[] | null
  reference_photos: ReferencePhoto[] | null
  real_life_refs_by_variant: Record<string, string[]> | null
  updated_at: string
  created_at: string
}

const SUMMARY_COLUMNS =
  "id, name, description, canonical_description, source_image_url, seed_prompt, gender, style, base_outfit, expressions, poses, motions, angles, body_angles, lighting_variations, updated_at"

const FULL_COLUMNS =
  "id, name, description, canonical_description, source_image_url, seed_prompt, gender, style, base_outfit, expressions, poses, motions, angles, body_angles, lighting_variations, reference_photos, real_life_refs_by_variant, created_at, updated_at"

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  }
}

function summarize(row: CharacterRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    canonicalDescription: row.canonical_description,
    portraitUrl: row.source_image_url,
    seedPrompt: row.seed_prompt,
    gender: row.gender,
    style: row.style,
    baseOutfit: row.base_outfit,
    assetCounts: {
      expressions: (row.expressions ?? []).length,
      poses: (row.poses ?? []).length,
      motions: (row.motions ?? []).length,
      angles: (row.angles ?? []).length,
      bodyAngles: (row.body_angles ?? []).length,
      lightingVariations: (row.lighting_variations ?? []).length,
    },
    updatedAt: row.updated_at,
  }
}

function detail(row: CharacterRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    canonicalDescription: row.canonical_description,
    portraitUrl: row.source_image_url,
    seedPrompt: row.seed_prompt,
    gender: row.gender,
    style: row.style,
    baseOutfit: row.base_outfit,
    expressions: row.expressions ?? [],
    poses: row.poses ?? [],
    motions: row.motions ?? [],
    angles: row.angles ?? [],
    bodyAngles: row.body_angles ?? [],
    lightingVariations: row.lighting_variations ?? [],
    referencePhotos: row.reference_photos ?? [],
    realLifeRefsByVariant: row.real_life_refs_by_variant ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function registerCharacterTools(server: McpServer, session: McpSession): void {
  if (!passesGate(session, readGate)) return

  server.registerTool(
    "list_characters",
    {
      title: "List Characters",
      description:
        "List the caller's saved characters with summary fields — name, " +
        "description, portrait URL, asset counts (expressions/poses/motions/" +
        "angles/body angles/lighting variations), and identity copy " +
        "(canonical description, seed prompt, style, base outfit). Use this " +
        "to discover which characters are available before generating an " +
        "image or video that references them. Follow up with `get_character` " +
        "to get the actual asset URLs for a specific expression or pose, " +
        "then pass those URLs as reference images to `generate_image` / " +
        "`image_to_image` / `generate_video`. Sorted by most-recently updated " +
        "first. Archived characters are excluded.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max characters to return (default 50, max 100)."),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const limit = args.limit ?? 50
      const { data, error } = await supabase
        .from("characters")
        .select(SUMMARY_COLUMNS)
        .eq("user_id", session.userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit)
      if (error) return err(`Error: ${error.message}`)
      const rows = (data ?? []) as CharacterRow[]
      return ok({ data: rows.map(summarize) })
    },
  )

  server.registerTool(
    "get_character",
    {
      title: "Get Character",
      description:
        "Get full detail for one character by ID — every expression / pose / " +
        "motion / head-angle / body-angle / lighting-variation asset with its " +
        "name and URL, plus reference photos and any per-variant real-life " +
        "reference URLs. Call this after `list_characters` to find the right " +
        "asset URL to pass as a reference image when generating. Returns an " +
        "error if the character is not found or not owned by the caller.",
      inputSchema: {
        id: z.string().uuid().describe("The character's UUID (from list_characters)."),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { data, error } = await supabase
        .from("characters")
        .select(FULL_COLUMNS)
        .eq("id", args.id)
        .eq("user_id", session.userId)
        .is("deleted_at", null)
        .maybeSingle()
      if (error) return err(`Error: ${error.message}`)
      if (!data) return err("Character not found")
      return ok({ data: detail(data as CharacterRow) })
    },
  )
}
