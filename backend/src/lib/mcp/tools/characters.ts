import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CHARACTER_STYLES } from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
} from "./_verb-helpers.js"

const readGate: ToolGate = { required: ["assets:read"] }
const writeGate: ToolGate = { required: ["assets:write"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

/**
 * Character platform tools.
 *
 * Two read-only discovery tools (`list_characters` / `get_character`) plus
 * the creative + reversible-write subset of the REST surface:
 * `create_character` / `update_character` / `approve_portrait` /
 * `recaption_character` / `generate_character_motion`. Portrait + variant-
 * asset generation already live as verb tools in
 * `verbs-clo.ts::generate_character` (kind=main/asset) so we don't duplicate
 * those — character motion is split out because the underlying route has
 * its own LLM-augmentation path and credit profile.
 *
 * INTENTIONAL OMISSIONS: `delete_character` and `restore_character` are
 * NOT exposed via MCP. Destructive (or destructive-adjacent) operations
 * driven by an LLM are dangerous — prompt injection or hallucination can
 * trigger them unexpectedly, and the LLM doesn't always have the user
 * context to make those calls safely. Users still archive + restore
 * through REST (`DELETE /v1/characters/:id`, `POST /v1/characters/:id/restore`)
 * — those are explicit user actions, not LLM-driven. The same principle
 * applies to any future tool addition: MCP exposes creation, modification,
 * and generation (all reversible); deletion, restoration, and permanent
 * state changes stay REST/SDK/CLI only.
 *
 * Scope gates:
 *   - `assets:read` — list_characters, get_character
 *   - `assets:write` — create_character, update_character, approve_portrait,
 *     recaption_character
 *   - `workflows:execute` — generate_character_motion (it produces an i2v
 *     job that consumes credits, same gate as other generation verbs)
 *
 * All tools are scoped to `session.userId`. Mutation tools that touch
 * `characters` rows write via Supabase service-role with a manual
 * `user_id` filter; tools that fire generation routes go through
 * `fastify.inject()` with the internal-orchestrator-secret so the auth
 * middleware accepts `userId` from the request body.
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

/**
 * Row shape returned by `list_characters` — same identity fields as the
 * detail row, but the bulky JSONB asset arrays are replaced by SQL-side
 * counts (`*_count: number | null`). Pulling the full arrays just to call
 * `.length` is wasteful at scale; Postgres' `jsonb_array_length` lets us
 * project the count directly so we never copy the asset payloads over the
 * wire for the list view. Null arrays project to `null` from the function
 * call — `summarize()` coalesces those to 0.
 */
interface CharacterSummaryRow {
  id: string
  name: string
  description: string | null
  canonical_description: string | null
  source_image_url: string | null
  seed_prompt: string | null
  gender: string | null
  style: string | null
  base_outfit: string | null
  expressions_count: number | null
  poses_count: number | null
  motions_count: number | null
  angles_count: number | null
  body_angles_count: number | null
  lighting_variations_count: number | null
  updated_at: string
}

/**
 * Summary projection used by `list_characters`. PostgREST's projection syntax
 * `<alias>:<expr>` runs `jsonb_array_length(coalesce(col, '[]'::jsonb))` on
 * each asset bucket so we get the count without dragging the whole array over
 * the wire. The `coalesce(...)` ensures NULL JSONB columns project to 0
 * (`jsonb_array_length(NULL)` would be NULL otherwise — `summarize()` still
 * defends against that with `?? 0` for safety).
 */
const SUMMARY_COLUMNS =
  "id, name, description, canonical_description, source_image_url, seed_prompt, gender, style, base_outfit, " +
  "expressions_count:jsonb_array_length(coalesce(expressions, '[]'::jsonb)), " +
  "poses_count:jsonb_array_length(coalesce(poses, '[]'::jsonb)), " +
  "motions_count:jsonb_array_length(coalesce(motions, '[]'::jsonb)), " +
  "angles_count:jsonb_array_length(coalesce(angles, '[]'::jsonb)), " +
  "body_angles_count:jsonb_array_length(coalesce(body_angles, '[]'::jsonb)), " +
  "lighting_variations_count:jsonb_array_length(coalesce(lighting_variations, '[]'::jsonb)), " +
  "updated_at"

const FULL_COLUMNS =
  "id, name, description, canonical_description, source_image_url, seed_prompt, gender, style, base_outfit, expressions, poses, motions, angles, body_angles, lighting_variations, reference_photos, real_life_refs_by_variant, created_at, updated_at"

// Single source of truth lives in `@nodaro/shared/entity-prompts` —
// reused here so the MCP tool surface, the SDK, the CLI, and the route's
// Zod schema all stay in lockstep when a new style is added.
const STYLE_ENUM = CHARACTER_STYLES

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  }
}

function okText(text: string, structuredContent?: Record<string, unknown>) {
  return structuredContent
    ? { content: [{ type: "text" as const, text }], structuredContent }
    : { content: [{ type: "text" as const, text }] }
}

function summarize(row: CharacterSummaryRow) {
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
      // jsonb_array_length(NULL) projects to NULL — coalesce defensively to 0
      // so the output shape is stable for clients that read the counts.
      expressions: row.expressions_count ?? 0,
      poses: row.poses_count ?? 0,
      motions: row.motions_count ?? 0,
      angles: row.angles_count ?? 0,
      bodyAngles: row.body_angles_count ?? 0,
      lightingVariations: row.lighting_variations_count ?? 0,
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

/**
 * Synthetic canvas node id used when an MCP caller creates a character
 * without supplying one. The `characters.node_id` column is `NOT NULL` to
 * keep editor-flow rows linkable to a React Flow node, but MCP-managed
 * characters never have a canvas node so we stamp a fixed sentinel — the
 * editor's library list ignores `node_id` entirely.
 */
const MCP_SYNTHETIC_NODE_ID = "mcp-managed"

export interface RegisterCharacterToolsOpts {
  server: McpServer
  session: McpSession
  /**
   * Optional Fastify instance for tools that proxy through `/v1/...` routes
   * (`approve_portrait`, `recaption_character`, `generate_character_motion`).
   * When omitted, those tools won't register — primarily for the
   * `list_characters`-only test path.
   */
  fastify?: FastifyInstance
}

/**
 * Discriminate between an `RegisterCharacterToolsOpts` object and the legacy
 * positional-args call (`McpServer`, `McpSession`).
 *
 * The MCP SDK's `McpServer` exposes a private `.server` accessor; testing
 * `"server" in x` is therefore truthy for raw McpServer instances. We instead
 * check for the presence of `.session`, which only exists on the opts object.
 */
function isOpts(x: unknown): x is RegisterCharacterToolsOpts {
  return (
    typeof x === "object" &&
    x !== null &&
    "session" in (x as Record<string, unknown>) &&
    "server" in (x as Record<string, unknown>)
  )
}

export function registerCharacterTools(
  serverOrOpts: McpServer | RegisterCharacterToolsOpts,
  session?: McpSession,
): void {
  // Backwards-compatible call site: registerCharacterTools(server, session).
  // The new call site passes a single options object including `fastify`.
  const opts: RegisterCharacterToolsOpts = isOpts(serverOrOpts)
    ? serverOrOpts
    : { server: serverOrOpts, session: session as McpSession }

  registerReadTools(opts)
  registerWriteTools(opts)
  registerGenerationTools(opts)
}

// ─────────────────────────────────────────────────────────────────────────────
// READ tools — list + get (assets:read)
// ─────────────────────────────────────────────────────────────────────────────

function registerReadTools({ server, session }: RegisterCharacterToolsOpts): void {
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
      // PostgREST's TS inference can't represent the `alias:expr` projection
      // we use for the SQL-side `jsonb_array_length` counts (it falls back to
      // a generic-error union), so we route the cast through `unknown` to
      // assert the runtime shape. The `CharacterSummaryRow` type above
      // documents that exact shape — verified by the `assetCounts` test path.
      const rows = (data ?? []) as unknown as CharacterSummaryRow[]
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

// ─────────────────────────────────────────────────────────────────────────────
// WRITE tools — create/update/delete/restore + approve_portrait + recaption
// (assets:write)
// ─────────────────────────────────────────────────────────────────────────────

function registerWriteTools(opts: RegisterCharacterToolsOpts): void {
  const { server, session, fastify } = opts
  if (!passesGate(session, writeGate)) return

  // ── create_character ──
  server.registerTool(
    "create_character",
    {
      title: "Create Character",
      description:
        "Create a new character row with basic identity fields (name + optional " +
        "description, gender, style, baseOutfit, seedPrompt). Returns the new " +
        "character id. The character has no portrait yet — call " +
        "`generate_character` (kind='main') next to produce one, then " +
        "`approve_portrait` to anchor it. Use this when the user wants to add " +
        "a new named character to their library before generating any media.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Display name for the character (e.g. 'Kira'). Must be unique among the user's active characters; conflicts return a name_taken error.",
          ),
        description: z.string().max(2000).optional(),
        gender: z.string().max(50).optional(),
        style: z.enum(STYLE_ENUM).optional(),
        base_outfit: z.string().max(1000).optional(),
        seed_prompt: z
          .string()
          .max(2000)
          .optional()
          .describe("Short prompt fragment that scaffolds the canonical portrait."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        user_id: session.userId,
        node_id: MCP_SYNTHETIC_NODE_ID,
        name: args.name,
        description: args.description ?? null,
        gender: args.gender ?? null,
        style: args.style ?? null,
        base_outfit: args.base_outfit ?? null,
        seed_prompt: args.seed_prompt ?? null,
        expressions: [],
        poses: [],
        lighting_variations: [],
        angles: [],
        body_angles: [],
        motions: [],
        reference_photos: [],
        real_life_refs_by_variant: {},
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from("characters")
        .insert(payload)
        .select("id, name")
        .single()
      if (error || !data) {
        if (error?.code === "23505") {
          return err(
            `A character named "${args.name}" already exists. Pick a different name.`,
          )
        }
        return err(`Error: ${error?.message ?? "Failed to create character"}`)
      }
      const row = data as { id: string; name: string }
      return okText(
        `Created character "${row.name}" (id ${row.id}). Next: call generate_character(kind='main', name=${JSON.stringify(row.name)}, attachToCharacterId=${JSON.stringify(row.id)}) to produce a portrait.`,
        { id: row.id, name: row.name },
      )
    },
  )

  // ── update_character ──
  server.registerTool(
    "update_character",
    {
      title: "Update Character",
      description:
        "Update an existing character's identity fields. Only the fields you " +
        "supply get written — omitted fields are not touched. Pass " +
        "`expected_updated_at` (from `get_character`) to enable optimistic " +
        "concurrency control: the update fails with a conflict error if the " +
        "row changed since you last read it.",
      inputSchema: {
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        gender: z.string().max(50).optional(),
        style: z.enum(STYLE_ENUM).optional(),
        base_outfit: z.string().max(1000).optional(),
        seed_prompt: z.string().max(2000).optional(),
        expected_updated_at: z
          .string()
          .optional()
          .describe(
            "Optimistic concurrency token (the `updatedAt` from get_character). When provided and stale, the call returns a conflict error.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (args.name !== undefined) patch.name = args.name
      if (args.description !== undefined) patch.description = args.description
      if (args.gender !== undefined) patch.gender = args.gender
      if (args.style !== undefined) patch.style = args.style
      if (args.base_outfit !== undefined) patch.base_outfit = args.base_outfit
      if (args.seed_prompt !== undefined) patch.seed_prompt = args.seed_prompt

      if (Object.keys(patch).length === 1) {
        return err("Nothing to update — pass at least one field besides id.")
      }

      // Optimistic concurrency control is folded into the UPDATE: when
      // `expected_updated_at` is supplied, we add `.eq("updated_at", X)` so the
      // UPDATE only fires if the row's `updated_at` still matches the caller's
      // snapshot. That's atomic — no pre-SELECT round-trip and no race window
      // between the read and the write. `.maybeSingle()` returns `data: null`
      // (no error) when the row was filtered out (stale token OR row removed),
      // and we distinguish the two by looking at `null` here.
      let query = supabase
        .from("characters")
        .update(patch)
        .eq("id", args.id)
        .eq("user_id", session.userId)
      if (args.expected_updated_at !== undefined) {
        query = query.eq("updated_at", args.expected_updated_at)
      }
      const { data, error } = await query
        .select("id, name, updated_at")
        .maybeSingle()
      if (error) {
        if (error.code === "23505") {
          return err(
            `A character named "${args.name ?? ""}" already exists. Pick a different name.`,
          )
        }
        return err(`Error: ${error.message ?? "Failed to update character"}`)
      }
      if (!data) {
        // No row matched the UPDATE. With expected_updated_at, the most likely
        // cause is a stale token (concurrent write); without it, the row
        // doesn't exist or isn't owned by the caller. Surface both as
        // actionable messages.
        if (args.expected_updated_at !== undefined) {
          return err(
            "Character was modified since you last read it. Fetch the latest with get_character and retry.",
          )
        }
        return err("Character not found")
      }
      const row = data as { id: string; name: string; updated_at: string }
      return okText(`Updated character "${row.name}" (id ${row.id}).`, {
        id: row.id,
        name: row.name,
        updated_at: row.updated_at,
      })
    },
  )

  // NOTE: `delete_character` and `restore_character` are INTENTIONALLY NOT
  // exposed via MCP. Destructive operations driven by an LLM are risky —
  // even a soft delete is hard to undo without context the LLM doesn't have,
  // and prompt injection / hallucination can trigger them unexpectedly.
  // Users (and SDK/CLI integrations on their behalf) can still archive +
  // restore through the REST surface (`DELETE /v1/characters/:id`,
  // `POST /v1/characters/:id/restore`) — those are explicit user actions,
  // not LLM-driven. Keep this comment so future tool additions remember the
  // boundary: MCP exposes creation / generation / modification (reversible),
  // never deletion / restoration / permanent state changes.

  // ── approve_portrait ──
  server.registerTool(
    "approve_portrait",
    {
      title: "Approve Portrait",
      description:
        "Approve a completed `generate_character` job as the character's " +
        "canonical portrait. Sets `source_image_url` on the character row and " +
        "fires an LLM caption (Claude Sonnet vision) inline to populate " +
        "`canonical_description`. Returns the new portrait URL plus the " +
        "caption. The caption is null on LLM sub-failure (portrait still set; " +
        "retry with `recaption_character`).",
      inputSchema: {
        character_id: z.string().uuid(),
        candidate_job_id: z
          .string()
          .uuid()
          .describe(
            "The job id from a completed `generate_character` call. The job must be status=completed and belong to the caller.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      if (!fastify) {
        return err(
          "approve_portrait is not available in this server build (no Fastify instance).",
        )
      }
      const res = await fastify.inject({
        method: "POST",
        url: `/v1/characters/${encodeURIComponent(args.character_id)}/approve-portrait`,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload: { candidateJobId: args.candidate_job_id, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let parsed: { portraitUrl?: string; canonicalDescription?: string | null } | null = null
      try {
        parsed = JSON.parse(res.body) as {
          portraitUrl?: string
          canonicalDescription?: string | null
        }
      } catch {
        /* fall through */
      }
      return okText(
        `Approved portrait for character ${args.character_id}.${parsed?.canonicalDescription === null ? " (LLM caption sub-failed — retry with recaption_character.)" : ""}`,
        {
          characterId: args.character_id,
          portraitUrl: parsed?.portraitUrl,
          canonicalDescription: parsed?.canonicalDescription ?? null,
        },
      )
    },
  )

  // ── recaption_character ──
  server.registerTool(
    "recaption_character",
    {
      title: "Recaption Character",
      description:
        "Re-run the LLM caption (Claude Sonnet vision) against the " +
        "character's current portrait and persist the new " +
        "`canonical_description`. Use after a portrait update or when the " +
        "previous caption is unsatisfactory. Returns 400 `no_portrait` if no " +
        "portrait is set; 502 on LLM failure.",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      if (!fastify) {
        return err(
          "recaption_character is not available in this server build (no Fastify instance).",
        )
      }
      const res = await fastify.inject({
        method: "POST",
        url: `/v1/characters/${encodeURIComponent(args.id)}/llm-caption`,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload: { userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let parsed: { canonicalDescription?: string } | null = null
      try {
        parsed = JSON.parse(res.body) as { canonicalDescription?: string }
      } catch {
        /* fall through */
      }
      return okText(
        `Refreshed canonical description for character ${args.id}.`,
        { id: args.id, canonicalDescription: parsed?.canonicalDescription ?? null },
      )
    },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION tools — generate_character_motion (workflows:execute)
// ─────────────────────────────────────────────────────────────────────────────

function registerGenerationTools({
  server,
  session,
  fastify,
}: RegisterCharacterToolsOpts): void {
  if (!passesGate(session, executeGate)) return
  if (!fastify) return

  server.registerTool(
    "generate_character_motion",
    {
      title: "Generate Character Motion",
      description:
        "Animate a character's portrait into a motion clip via image-to-video. " +
        "Pass `attach_to_character_id` to use the character's anchor portrait " +
        "as the source frame and auto-attach the resulting clip to the " +
        "character's `motions[]` bucket on completion. The motion_prompt " +
        "describes WHAT moves and HOW (e.g. 'slow head turn left, eyes track " +
        "the camera, soft smile'). Returns the i2v job id — poll via " +
        "`get_job` until completion. Credit cost depends on the provider.",
      inputSchema: {
        motion_prompt: z.string().min(1).max(2000),
        name: z.string().min(1).max(200),
        attach_to_character_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "When set, use the character's anchor portrait as source and append the result to the row's motions[].",
          ),
        attach_name: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Display name for the motion entry, e.g. 'walking'."),
        source_image_url: z
          .string()
          .url()
          .optional()
          .describe(
            "Override source frame. Required when attach_to_character_id is omitted (no portrait to fall back on).",
          ),
        description: z.string().max(1000).optional(),
        motion_description: z.string().max(500).optional(),
        gender: z.string().max(50).optional(),
        style: z.enum(STYLE_ENUM).optional(),
        base_outfit: z.string().max(1000).optional(),
        provider: z
          .string()
          .optional()
          .describe("i2v provider. Defaults to 'kling'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        motionPrompt: args.motion_prompt,
        name: args.name,
        userId: session.userId,
        mcp_client: session.clientName,
      }
      if (args.attach_to_character_id) {
        payload.attachToCharacterId = args.attach_to_character_id
      }
      if (args.attach_name) payload.attachName = args.attach_name
      if (args.source_image_url) payload.sourceImageUrl = args.source_image_url
      if (args.description) payload.description = args.description
      if (args.motion_description) payload.motionDescription = args.motion_description
      if (args.gender) payload.gender = args.gender
      if (args.style) payload.style = args.style
      if (args.base_outfit) payload.baseOutfit = args.base_outfit
      if (args.provider) payload.provider = args.provider

      const res = await fastify.inject({
        method: "POST",
        url: "/v1/generate-character-motion",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      // Use the shared video-widget helper so the iframe receives the live
      // progress payload (jobId + prompt + model). The previous hand-rolled
      // `registerTask + okText` path worked but skipped the
      // `structuredContent` wiring — the widget rendered an empty card.
      return jobResultWithWidget({
        jobId,
        label: "character motion",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.motion_prompt,
          model: args.provider ?? "kling",
        },
      })
    },
  )
}
