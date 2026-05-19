import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CHARACTER_STYLES, LOCATION_ATMOSPHERE_PROVIDERS } from "@nodaro/shared"
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
 * Location platform tools.
 *
 * Two read-only discovery tools (`list_locations` / `get_location`) plus
 * the creative + reversible-write subset of the REST surface:
 * `create_location` / `update_location` / `approve_main_image` /
 * `recaption_location` / `generate_location_motion`. Location candidate +
 * variant-asset generation already lives as a verb tool in
 * `verbs-clo.ts::generate_location` — we do NOT duplicate it here.
 * `generate_location_motion` stays in this file because it dispatches to
 * a distinct route (`/v1/generate-location-motion`) with its own
 * motion-specific input shape (`motion_prompt`, source frame, atmosphere
 * provider) and a different i2v credit profile — mirrors the
 * `generate_character_motion` placement in `characters.ts`.
 *
 * INTENTIONAL OMISSIONS: `delete_location` and `restore_location` are
 * NOT exposed via MCP. Destructive (or destructive-adjacent) operations
 * driven by an LLM are dangerous — prompt injection or hallucination can
 * trigger them unexpectedly, and the LLM doesn't always have the user
 * context to make those calls safely. Users still archive + restore
 * through REST (`DELETE /v1/locations/:id`, `POST /v1/locations/:id/restore`)
 * — those are explicit user actions, not LLM-driven. The same principle
 * applies to any future tool addition here: MCP exposes creation,
 * modification, and reversible state changes; deletion, restoration, and
 * permanent destructive operations stay REST/SDK/CLI only.
 *
 * Scope gates:
 *   - `assets:read` — list_locations, get_location
 *   - `assets:write` — create_location, update_location, approve_main_image,
 *     recaption_location
 *   - `workflows:execute` — generate_location_motion (it produces an i2v
 *     job that consumes credits, same gate as `generate_character_motion`)
 *
 * All tools are scoped to `session.userId`. Read tools query Supabase
 * service-role with a manual `user_id` filter; mutation tools that fire
 * approval/caption/motion side-effects go through `fastify.inject()` with
 * the internal-orchestrator-secret so the auth middleware accepts `userId`
 * from the request body.
 */

interface AssetEntry {
  name: string
  url: string
}

interface ReferencePhoto {
  url: string
  kind: string
}

interface LocationRow {
  id: string
  name: string
  description: string | null
  canonical_description: string | null
  source_image_url: string | null
  category: string | null
  style: string | null
  style_lock: boolean | null
  time_of_day: AssetEntry[] | null
  weather: AssetEntry[] | null
  angles: AssetEntry[] | null
  lighting: AssetEntry[] | null
  seasons: AssetEntry[] | null
  atmosphere_motions: AssetEntry[] | null
  reference_photos: ReferencePhoto[] | null
  updated_at: string
  created_at: string
}

/**
 * Row shape returned by `list_locations`. Includes the full JSONB asset
 * arrays — we COUNT them in JS via `summarize()` because PostgREST's `select=`
 * syntax does not support inline SQL function calls like
 * `jsonb_array_length(coalesce(col, '[]'::jsonb))`. Same precedent as
 * `characters.ts::CharacterSummaryRow`. Future optimization: add a Postgres
 * RPC that returns the count-only summary and call it via `supabase.rpc()`.
 */
interface LocationSummaryRow {
  id: string
  name: string
  description: string | null
  canonical_description: string | null
  source_image_url: string | null
  category: string | null
  style: string | null
  style_lock: boolean | null
  time_of_day: AssetEntry[] | null
  weather: AssetEntry[] | null
  angles: AssetEntry[] | null
  lighting: AssetEntry[] | null
  seasons: AssetEntry[] | null
  atmosphere_motions: AssetEntry[] | null
  updated_at: string
}

const SUMMARY_COLUMNS =
  "id, name, description, canonical_description, source_image_url, category, style, style_lock, " +
  "time_of_day, weather, angles, lighting, seasons, atmosphere_motions, updated_at"

const FULL_COLUMNS =
  "id, name, description, canonical_description, source_image_url, category, style, style_lock, " +
  "time_of_day, weather, angles, lighting, seasons, atmosphere_motions, reference_photos, " +
  "created_at, updated_at"

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

function summarize(row: LocationSummaryRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    canonicalDescription: row.canonical_description,
    sourceImageUrl: row.source_image_url,
    category: row.category,
    style: row.style,
    styleLock: row.style_lock ?? true,
    assetCounts: {
      timeOfDay: (row.time_of_day ?? []).length,
      weather: (row.weather ?? []).length,
      angles: (row.angles ?? []).length,
      lighting: (row.lighting ?? []).length,
      seasons: (row.seasons ?? []).length,
      atmosphereMotions: (row.atmosphere_motions ?? []).length,
    },
    updatedAt: row.updated_at,
  }
}

function detail(row: LocationRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    canonicalDescription: row.canonical_description,
    sourceImageUrl: row.source_image_url,
    category: row.category,
    style: row.style,
    styleLock: row.style_lock ?? true,
    timeOfDay: row.time_of_day ?? [],
    weather: row.weather ?? [],
    angles: row.angles ?? [],
    lighting: row.lighting ?? [],
    seasons: row.seasons ?? [],
    atmosphereMotions: row.atmosphere_motions ?? [],
    referencePhotos: row.reference_photos ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Synthetic canvas node id used when an MCP caller creates a location
 * without supplying one. The `locations.node_id` column is set on every
 * row to keep editor-flow rows linkable to a React Flow node, but
 * MCP-managed locations never have a canvas node so we stamp a fixed
 * sentinel — the editor's library list ignores `node_id` entirely.
 * Mirrors the `MCP_SYNTHETIC_NODE_ID` in `characters.ts`.
 */
const MCP_SYNTHETIC_NODE_ID = "mcp-managed"

export interface RegisterLocationToolsOpts {
  server: McpServer
  session: McpSession
  /**
   * Optional Fastify instance for tools that proxy through `/v1/...` routes
   * (`approve_main_image`, `recaption_location`). When omitted, those tools
   * won't register — primarily for the read-only test path.
   */
  fastify?: FastifyInstance
}

export function registerLocationTools(opts: RegisterLocationToolsOpts): void {
  registerReadTools(opts)
  registerWriteTools(opts)
  registerGenerationTools(opts)
}

// ─────────────────────────────────────────────────────────────────────────────
// READ tools — list + get (assets:read)
// ─────────────────────────────────────────────────────────────────────────────

function registerReadTools({ server, session }: RegisterLocationToolsOpts): void {
  if (!passesGate(session, readGate)) return

  server.registerTool(
    "list_locations",
    {
      title: "List Locations",
      description:
        "List the caller's saved locations with summary fields — name, " +
        "description, main image URL, asset counts (time of day / weather / " +
        "angles / lighting / seasons / atmosphere motions), and identity copy " +
        "(canonical description, category, style, style lock). Use this to " +
        "discover which locations are available before generating an image " +
        "or video that references them. Follow up with `get_location` to get " +
        "the actual asset URLs for a specific variant, then pass those URLs " +
        "as reference images to `generate_image` / `image_to_image` / " +
        "`generate_video`. Sorted by most-recently created first. Archived " +
        "locations are excluded by default — pass `archived: true` to list " +
        "the archive instead.",
      inputSchema: {
        archived: z
          .boolean()
          .optional()
          .describe(
            "When true, list soft-deleted (archived) locations instead of active ones.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const wantArchived = args.archived === true
      let query = supabase
        .from("locations")
        .select(SUMMARY_COLUMNS)
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
      query = wantArchived
        ? query.not("deleted_at", "is", null)
        : query.is("deleted_at", null)
      const { data, error } = await query
      if (error) return err(`Error: ${error.message}`)
      // PostgREST's TS inference can't represent the full projection cleanly
      // (it falls back to a generic-error union for JSONB columns), so we
      // route the cast through `unknown` to assert the runtime shape. The
      // `LocationSummaryRow` type above documents that exact shape.
      const rows = (data ?? []) as unknown as LocationSummaryRow[]
      return ok({ data: rows.map(summarize) })
    },
  )

  server.registerTool(
    "get_location",
    {
      title: "Get Location",
      description:
        "Get full detail for one location by ID — every time-of-day / " +
        "weather / angle / lighting / season / atmosphere-motion asset with " +
        "its name and URL, plus reference photos and identity fields. Call " +
        "this after `list_locations` to find the right asset URL to pass as " +
        "a reference image when generating. Returns an error if the location " +
        "is not found or not owned by the caller.",
      inputSchema: {
        id: z.string().uuid().describe("The location's UUID (from list_locations)."),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { data, error } = await supabase
        .from("locations")
        .select(FULL_COLUMNS)
        .eq("id", args.id)
        .eq("user_id", session.userId)
        .is("deleted_at", null)
        .maybeSingle()
      if (error) return err(`Error: ${error.message}`)
      if (!data) return err("Location not found")
      return ok({ data: detail(data as unknown as LocationRow) })
    },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE tools — create / update / approve_main_image / recaption_location
// (assets:write)
// ─────────────────────────────────────────────────────────────────────────────

function registerWriteTools(opts: RegisterLocationToolsOpts): void {
  const { server, session, fastify } = opts
  if (!passesGate(session, writeGate)) return

  // ── create_location ──
  server.registerTool(
    "create_location",
    {
      title: "Create Location",
      description:
        "Create a new location row with basic identity fields (name + optional " +
        "description, category, style). Returns the new location id. The " +
        "location has no main image yet — call `generate_location` next to " +
        "produce candidate images, then `approve_main_image` to anchor one. " +
        "Use this when the user wants to add a new named location to their " +
        "library before generating any media that references it.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(200)
          .describe("Display name for the location (e.g. 'Rainy Tokyo Alley')."),
        description: z.string().max(2000).optional(),
        category: z
          .string()
          .max(50)
          .optional()
          .describe("Free-form category tag (e.g. 'interior', 'exterior', 'urban')."),
        style: z
          .string()
          .max(50)
          .optional()
          .describe("Free-form style tag (e.g. 'cinematic', 'documentary', 'noir')."),
        nodeId: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Canvas node id for editor linkage. MCP callers typically omit this " +
            "— a synthetic sentinel is used so the row isn't tied to any React " +
            "Flow node.",
          ),
        projectId: z.string().uuid().optional(),
        workflowId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const row = {
        user_id: session.userId,
        node_id: args.nodeId ?? MCP_SYNTHETIC_NODE_ID,
        workflow_id: args.workflowId ?? null,
        project_id: args.projectId ?? null,
        name: args.name,
        description: args.description ?? null,
        category: args.category ?? null,
        style: args.style ?? null,
        time_of_day: [],
        weather: [],
        angles: [],
        lighting: [],
        seasons: [],
        atmosphere_motions: [],
        reference_photos: [],
        style_lock: true,
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from("locations")
        .insert(row)
        .select("id, name")
        .single()
      if (error || !data) {
        return err(`Error: ${error?.message ?? "Failed to create location"}`)
      }
      const created = data as { id: string; name: string }
      return okText(
        `Created location "${created.name}" (id ${created.id}). Next: call generate_location with attachToLocationId=${JSON.stringify(created.id)} to produce candidate main images, then approve_main_image to anchor one.`,
        { id: created.id, name: created.name },
      )
    },
  )

  // ── update_location ──
  server.registerTool(
    "update_location",
    {
      title: "Update Location",
      description:
        "Update an existing location's identity fields. Only the fields you " +
        "supply get written — omitted fields are not touched. Pass " +
        "`expectedUpdatedAt` (from `get_location`) to enable optimistic " +
        "concurrency control: the update fails with a conflict error if the " +
        "row changed since you last read it. Worker-owned asset buckets " +
        "(timeOfDay, weather, angles, lighting, seasons, atmosphereMotions) " +
        "are NOT writable here — they're appended atomically by the worker " +
        "via the `append_location_asset` RPC.",
      inputSchema: {
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        category: z.string().max(50).optional(),
        style: z.string().max(50).optional(),
        styleLock: z
          .boolean()
          .optional()
          .describe(
            "When true, every variant gen passes the main image as reference for layout consistency.",
          ),
        canonicalDescription: z
          .string()
          .max(4000)
          .optional()
          .describe("LLM-authored scene description. Manual edits override the auto-caption."),
        expectedUpdatedAt: z
          .string()
          .optional()
          .describe(
            "Optimistic concurrency token (the `updatedAt` from get_location). " +
            "When provided and stale, the call returns a conflict error.",
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
      if (args.category !== undefined) patch.category = args.category
      if (args.style !== undefined) patch.style = args.style
      if (args.styleLock !== undefined) patch.style_lock = args.styleLock
      if (args.canonicalDescription !== undefined) {
        patch.canonical_description = args.canonicalDescription
      }

      if (Object.keys(patch).length === 1) {
        return err("Nothing to update — pass at least one field besides id.")
      }

      // Optimistic concurrency control is folded into the UPDATE: when
      // `expectedUpdatedAt` is supplied, we add `.eq("updated_at", X)` so the
      // UPDATE only fires if the row's `updated_at` still matches the
      // caller's snapshot. That's atomic — no pre-SELECT round-trip and no
      // race window between the read and the write. `.maybeSingle()` returns
      // `data: null` (no error) when the row was filtered out (stale token
      // OR row removed), and we distinguish the two by `null` here.
      let query = supabase
        .from("locations")
        .update(patch)
        .eq("id", args.id)
        .eq("user_id", session.userId)
      if (args.expectedUpdatedAt !== undefined) {
        query = query.eq("updated_at", args.expectedUpdatedAt)
      }
      const { data, error } = await query
        .select("id, name, updated_at")
        .maybeSingle()
      if (error) {
        return err(`Error: ${error.message ?? "Failed to update location"}`)
      }
      if (!data) {
        if (args.expectedUpdatedAt !== undefined) {
          return err(
            "Location was modified since you last read it. Fetch the latest with get_location and retry.",
          )
        }
        return err("Location not found")
      }
      const updated = data as { id: string; name: string; updated_at: string }
      return okText(`Updated location "${updated.name}" (id ${updated.id}).`, {
        id: updated.id,
        updatedAt: updated.updated_at,
      })
    },
  )

  // NOTE: `delete_location` and `restore_location` are INTENTIONALLY NOT
  // exposed via MCP. Destructive operations driven by an LLM are risky —
  // even a soft delete is hard to undo without context the LLM doesn't have,
  // and prompt injection / hallucination can trigger them unexpectedly.
  // Users (and SDK/CLI integrations on their behalf) can still archive +
  // restore through the REST surface (`DELETE /v1/locations/:id`,
  // `POST /v1/locations/:id/restore`) — those are explicit user actions,
  // not LLM-driven. Keep this comment so future tool additions remember the
  // boundary: MCP exposes creation / generation / modification (reversible),
  // never deletion / restoration / permanent state changes.

  // ── approve_main_image ──
  server.registerTool(
    "approve_main_image",
    {
      title: "Approve Main Image",
      description:
        "Approve a completed `generate_location` candidate job as the " +
        "location's main image. Sets `source_image_url` on the location row " +
        "and fires an LLM caption (Claude Sonnet vision) inline to populate " +
        "`canonical_description`. Returns the new main-image URL plus the " +
        "caption. The caption is the empty string on LLM sub-failure (main " +
        "image still set; retry with `recaption_location`).",
      inputSchema: {
        location_id: z.string().uuid(),
        candidate_job_id: z
          .string()
          .uuid()
          .describe(
            "The job id from a completed `generate_location` call. The job " +
            "must be status=completed and belong to the caller.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      if (!fastify) {
        return err(
          "approve_main_image is not available in this server build (no Fastify instance).",
        )
      }
      const res = await fastify.inject({
        method: "POST",
        url: `/v1/locations/${encodeURIComponent(args.location_id)}/approve-main-image`,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload: {
          candidateJobId: args.candidate_job_id,
          userId: session.userId,
        },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let parsed: { sourceImageUrl?: string; canonicalDescription?: string } | null = null
      try {
        parsed = JSON.parse(res.body) as {
          sourceImageUrl?: string
          canonicalDescription?: string
        }
      } catch {
        /* fall through */
      }
      const captionEmpty = !parsed?.canonicalDescription
      return okText(
        `Approved main image for location ${args.location_id}.${captionEmpty ? " (LLM caption sub-failed — retry with recaption_location.)" : ""}`,
        {
          locationId: args.location_id,
          sourceImageUrl: parsed?.sourceImageUrl,
          canonicalDescription: parsed?.canonicalDescription ?? "",
        },
      )
    },
  )

  // ── recaption_location ──
  server.registerTool(
    "recaption_location",
    {
      title: "Recaption Location",
      description:
        "Re-run the LLM caption (Claude Sonnet vision) against the location's " +
        "current main image and persist the new `canonical_description`. Use " +
        "after a main-image update or when the previous caption is " +
        "unsatisfactory. Returns 400 `no_source_image` if no main image is " +
        "set; 502 on LLM failure.",
      inputSchema: { location_id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      if (!fastify) {
        return err(
          "recaption_location is not available in this server build (no Fastify instance).",
        )
      }
      const res = await fastify.inject({
        method: "POST",
        url: `/v1/locations/${encodeURIComponent(args.location_id)}/llm-caption`,
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
        `Refreshed canonical description for location ${args.location_id}.`,
        {
          locationId: args.location_id,
          canonicalDescription: parsed?.canonicalDescription ?? "",
        },
      )
    },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION tools — generate_location_motion only
// (workflows:execute)
//
// Location candidate + variant-asset generation lives in
// `verbs-clo.ts::generate_location` (kind="main" / kind="asset"). Motion
// clips stay here because they dispatch to a distinct route
// (`/v1/generate-location-motion`) with a different input shape and i2v
// credit profile — mirrors `generate_character_motion` in `characters.ts`.
// ─────────────────────────────────────────────────────────────────────────────

function registerGenerationTools(opts: RegisterLocationToolsOpts): void {
  const { server, session, fastify } = opts
  if (!passesGate(session, executeGate)) return
  if (!fastify) return

  server.registerTool(
    "generate_location_motion",
    {
      title: "Generate Location Motion Clip",
      description:
        "Animate a location into an ambient camera-move clip via " +
        "image-to-video. The motion_prompt describes the camera move and " +
        "any subtle world motion (e.g. 'slow dolly-in, leaves drift across " +
        "frame', 'drone fly-over, neon signs flicker'). Pass " +
        "`attach_to_location_id` to auto-append the result to the " +
        "location's `atmosphere_motions[]` bucket on completion. " +
        "`source_image_url` is REQUIRED — typically the location's " +
        "approved main image. Returns the i2v job id — poll via `get_job` " +
        "until completion. Credit cost depends on the provider.",
      inputSchema: {
        motion_prompt: z
          .string()
          .min(1)
          .max(2000)
          .describe(
            "Camera-move + ambient-motion description (e.g. 'slow dolly-in', 'drone fly-over').",
          ),
        source_image_url: z
          .string()
          .url()
          .describe(
            "Source frame — typically the location's approved main image URL.",
          ),
        provider: z
          .enum(LOCATION_ATMOSPHERE_PROVIDERS)
          .optional()
          .default("kling")
          .describe("i2v provider. Defaults to 'kling'."),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Display name for the location (used in the generated prompt context).",
          ),
        category: z.string().max(100).optional(),
        style: z.enum(CHARACTER_STYLES).optional(),
        canonical_description: z
          .string()
          .max(4000)
          .optional()
          .describe(
            "Canonical scene description (preferred prompt context; falls back to category + name).",
          ),
        attach_to_location_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "When set, append the result to this location's atmosphere_motions[] bucket.",
          ),
        attach_name: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Display name for the atmosphere-motion entry (defaults to motion description)."),
        refine_from_video_url: z
          .string()
          .url()
          .optional()
          .describe(
            "Phase 2 #2 refinement path: when set, the worker routes to " +
            "video-to-video using THIS clip as the source instead of running " +
            "image-to-video from `source_image_url`. Use this to iterate on " +
            "an existing atmosphere clip with a new prompt (e.g. 'same shot " +
            "but light rain instead of fog'). Routes through providers with " +
            "the video-to-video capability (currently Wan 2.6 via KIE).",
          ),
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
        sourceImageUrl: args.source_image_url,
        provider: args.provider,
        name: args.name,
        userId: session.userId,
        mcp_client: session.clientName,
      }
      if (args.category) payload.category = args.category
      if (args.style) payload.style = args.style
      if (args.canonical_description) {
        payload.canonicalDescription = args.canonical_description
      }
      if (args.attach_to_location_id) {
        payload.attachToLocationId = args.attach_to_location_id
      }
      if (args.attach_name) payload.attachName = args.attach_name
      if (args.refine_from_video_url) {
        payload.refineFromVideoUrl = args.refine_from_video_url
      }

      const res = await fastify.inject({
        method: "POST",
        url: "/v1/generate-location-motion",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      // Video widget — the iframe polls `get_asset` for the rendered clip.
      return jobResultWithWidget({
        jobId,
        label: "location motion",
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
