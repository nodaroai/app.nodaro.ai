import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import {
  mergeCast,
  parseProduction,
  stripTransientSettings,
  toProductionSummary,
  toProductionView,
  type ViewableWorkflow,
} from "@nodaro/studio-production"
import type {
  StudioListProductionsResponse,
  StudioPlanIssue,
  StudioProductionView,
} from "@nodaro/shared"

import { sendInternalError } from "../lib/http-errors.js"
import { requireScope, type Scope } from "../lib/scopes.js"
import { supabase } from "../lib/supabase.js"
import type { AccessLevel } from "../lib/workflow-access.js"
import {
  loadWorkflowFor,
  WORKFLOW_ACCESS_COLS,
} from "../lib/workflow-route-access.js"
import { mentionCandidatesFor } from "../lib/studio-productions/candidates.js"
import {
  landPlan,
  serializeAppend,
  serializeCreate,
} from "../lib/studio-productions/land-plan.js"
import { ensureStudioProject } from "../lib/studio-productions/project.js"
import { studioProductionSkill } from "../lib/studio-productions/skill.js"
import { validatePlan } from "../lib/studio-productions/validate.js"

/**
 * `/v1/studio/productions` — the platform as the studio production's reader and
 * writer.
 *
 * A production is a workflow whose `settings.studio` holds the shots, and until
 * now the only code that could read that document ran in a browser tab. These
 * routes run the SAME codec (`@nodaro/studio-production`) server-side, so an
 * agent, the studio app and the copilot all see one production rather than
 * three opinions about one row.
 *
 * Phase 0 lands the read half plus the two ways a production comes into
 * existence: the skill an author reads, the free validation loop, the list, the
 * create-from-plan, and the get. Editing, generating and sharing arrive with
 * their own routes.
 *
 * Every route is owner-checked through `loadWorkflowFor`, which answers 404 —
 * never 403 — to a caller who cannot see the row, so an id cannot be probed.
 */

// ── request schemas ────────────────────────────────────────────────────────

const productionIdParams = z.object({ id: z.string().uuid("Invalid production ID") })

const planBody = z.object({
  plan: z.record(z.string(), z.unknown()),
})

const listQuery = z.object({
  limit: z
    .preprocess(
      (v) => (typeof v === "string" ? Number(v) : v),
      z.number().int().min(1).max(100),
    )
    .optional(),
  cursor: z.string().optional(),
  /** Include the rows the dashboard hides. Off by default — see D12. */
  includeArchived: z
    .string()
    .optional()
    .transform((v) => v === "true"),
})

const getQuery = z.object({
  detail: z.enum(["summary", "full"]).optional(),
  shot_id: z.string().optional(),
})

const createBody = z.object({
  name: z.string().min(1).max(200).optional(),
  plan: z.record(z.string(), z.unknown()).optional(),
})

const importBody = z.object({
  plan: z.record(z.string(), z.unknown()),
  mode: z.literal("append").optional(),
})

// ── small shared helpers (the same shapes routes/workflows.ts uses) ─────────

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({
    error: { code: "unauthorized", message: "Authentication required" },
  })
}

function validationError(reply: FastifyReply, message: string, path?: string) {
  return reply.status(400).send({
    error: { code: "validation_error", message, ...(path ? { path } : {}) },
  })
}

function notFound(reply: FastifyReply) {
  return reply
    .status(404)
    .send({ error: { code: "not_found", message: "Production not found" } })
}

function authorize(req: FastifyRequest, reply: FastifyReply, scope?: Scope): string | null {
  if (!req.userId) {
    unauthorized(reply)
    return null
  }
  if (scope && req.appAuthorization) {
    const err = requireScope(req.appAuthorization.scopes, scope)
    if (err) {
      reply.status(err.statusCode).send(err.body)
      return null
    }
  }
  return req.userId
}

function parseWith<S extends z.ZodTypeAny>(
  reply: FastifyReply,
  schema: S,
  input: unknown,
  fallback: string,
): z.infer<S> | null {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  validationError(reply, parsed.error.issues[0]?.message ?? fallback)
  return null
}

/**
 * The columns a production read needs.
 *
 * `WORKFLOW_ACCESS_COLS` is not optional decoration: `toAccessRow` THROWS when
 * one of the four is missing, deliberately, because `row.workspace_id ?? null`
 * on a column nobody selected would read as "this is personal" — the permissive
 * answer, invented from an absence.
 */
const PRODUCTION_COLS = `${WORKFLOW_ACCESS_COLS}, name, thumbnail_url, version, nodes, edges, settings, updated_at`
const SUMMARY_COLS = `${WORKFLOW_ACCESS_COLS}, name, thumbnail_url, version, settings, updated_at`

/** A workflow row as the codec wants it. */
function asViewable(row: Record<string, unknown>): ViewableWorkflow {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    version: (row.version as number) ?? 1,
    updatedAt: (row.updated_at as string) ?? new Date(0).toISOString(),
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    nodes: (row.nodes as ViewableWorkflow["nodes"]) ?? [],
    edges: (row.edges as ViewableWorkflow["edges"]) ?? [],
    settings: (row.settings as Record<string, unknown>) ?? {},
  }
}

/**
 * The row as the codec should read it FOR THIS CALLER.
 *
 * A reader who is not the OWNER gets the same projection the public share read
 * gives (D12): `settings.studio` carries the owner's working state beside the
 * film — the recycle bin above all, which holds every shot, still and clip they
 * deleted, prompts and urls intact. Somebody granted `view`, or even `edit`,
 * was given the work; they were not given the things its owner threw away.
 *
 * Applied on the way OUT and nowhere else. What gets WRITTEN is always
 * assembled from the stored row, so a collaborator's append can never destroy a
 * bin it was not allowed to read. The strip list is the package's own, so this
 * and `GET /v1/public/workflows/:id` cannot disagree about what "transient"
 * means.
 */
function viewableFor(row: Record<string, unknown>, access: AccessLevel): ViewableWorkflow {
  if (access === "own") return asViewable(row)
  return asViewable({
    ...row,
    settings: stripTransientSettings(
      row.settings as Record<string, unknown> | null | undefined,
    ),
  })
}

/**
 * Is this workflow a studio production at all?
 *
 * Two answers, and the second one is not decoration. `settings.studio` is what
 * makes a row a production — but the studio also keeps an INTERNAL store there:
 * a workflow named "Studio favorites (internal)" whose `settings.studio` is
 * `{ hidden: true, favorites }` and holds no film at all. It is production-
 * shaped and is not a production: listing it shows a 0-shot card the user never
 * made, and an append into it would replace their favorites with a shot index.
 *
 * Deliberately NOT "does it carry a v3 shot index": the codec reads a v1
 * legacy workflow — a bare `generate-image` node IS a shot — and those rows
 * must stay readable without being migrated first (pinned by the package's own
 * view test).
 */
function isProduction(row: Record<string, unknown>): boolean {
  const settings = row.settings as { studio?: unknown } | null | undefined
  if (!settings || typeof settings !== "object" || settings.studio === undefined) return false
  const studio = settings.studio as { hidden?: unknown } | null
  return !studio || typeof studio !== "object" || studio.hidden !== true
}

// ── the list's cursor ───────────────────────────────────────────────────────

/**
 * A page boundary, as `(updated_at, id)`.
 *
 * WHY A COMPOSITE: `updated_at` is trigger-bumped, and one bulk write stamps an
 * identical `now()` on every row it touched. A bare `updated_at.lt.<ts>` cursor
 * then skips EVERY row tied with the last row of the page — whole pages vanish
 * with nothing to show for it. Pairing the timestamp with the row id gives a
 * total order, so the boundary lands between two specific rows.
 *
 * The same scheme as `lib/keyset-cursor.ts`, which is not reused here only
 * because it is keyed on `created_at` in both its filter and its slice; the
 * strictness is copied verbatim and for its reason: the decoded fields are
 * interpolated into a PostgREST `.or(...)` string, so a value carrying a comma
 * or a paren would inject filter conditions. Opaque on the wire — callers only
 * ever echo `nextCursor` back.
 */
interface ListCursor {
  updatedAt: string
  id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// ISO-8601 as PostgREST returns it, and deliberately without the filter
// metacharacters `,` `(` `)`.
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/

/** Decode + strict-validate; null for anything that is not one of ours. */
function decodeListCursor(raw: string): ListCursor | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const { updatedAt, id } = parsed as Record<string, unknown>
  if (typeof updatedAt !== "string" || !ISO_TS_RE.test(updatedAt)) return null
  if (typeof id !== "string" || !UUID_RE.test(id)) return null
  return { updatedAt, id }
}

function encodeListCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64")
}

/** "Strictly after this row" under `ORDER BY updated_at DESC, id DESC`. */
function listCursorFilter(c: ListCursor): string {
  return `updated_at.lt.${c.updatedAt},and(updated_at.eq.${c.updatedAt},id.lt.${c.id})`
}

/**
 * The two flag filters, as PostgREST predicates.
 *
 * "Absent, or not true" — never `not.eq.true`, which PostgREST renders as
 * `NOT (x = 'true')`: NULL for every row without the key, and a NULL predicate
 * drops the row. Written that way these would hide every ordinary production
 * and list only the ones somebody had explicitly un-archived.
 */
const NOT_HIDDEN = "settings->studio->>hidden.is.null,settings->studio->>hidden.neq.true"
const NOT_ARCHIVED = "settings->studio->>archived.is.null,settings->studio->>archived.neq.true"

export async function studioProductionRoutes(app: FastifyInstance): Promise<void> {
  // ── the skill (ungated: reading the format costs nothing and is the first
  //    thing any author needs) ───────────────────────────────────────────────
  app.get("/v1/studio/productions/skill", async (req, reply) => {
    const userId = authorize(req, reply)
    if (!userId) return
    return { data: studioProductionSkill() }
  })

  // ── validate: free, persists nothing, resolves against the caller's library ─
  app.post("/v1/studio/productions/validate", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return
    const body = parseWith(reply, planBody, req.body ?? {}, "Invalid plan")
    if (!body) return

    try {
      const candidates = await mentionCandidatesFor(userId)
      return { data: validatePlan(body.plan, candidates) }
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to validate plan")
    }
  })

  // ── list: the caller's own Studio project ──────────────────────────────────
  app.get("/v1/studio/productions", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return
    const query = parseWith(reply, listQuery, req.query ?? {}, "Invalid query")
    if (!query) return

    const limit = query.limit ?? 25
    // A cursor the caller invented is a 400, not a 500 from Postgres and not a
    // silent page one — which a rolling-load client would append forever.
    const cursor = query.cursor ? decodeListCursor(query.cursor) : null
    if (query.cursor && !cursor) return validationError(reply, "Invalid cursor", "cursor")

    try {
      const projectId = await ensureStudioProject(userId)
      /**
       * EVERY filter is the QUERY's, none is applied to the rows afterwards.
       * A page that fetches `limit + 1` and then drops rows in memory answers
       * short AND stops minting a cursor once the survivors fit under the
       * limit — 30 productions, 10 archived, `limit = 25`, and four of them are
       * unreachable forever. The probe row can only decide the boundary if the
       * database decided the contents.
       */
      let q = supabase
        .from("workflows")
        .select(SUMMARY_COLS)
        .eq("user_id", userId)
        .eq("project_id", projectId)
        // The "Studio" project is PERSONAL; a list that says nothing about
        // workspaces silently mixes the two the day workspaces exist.
        .is("workspace_id", null)
        // A production is a row carrying a studio document. A bare workflow
        // that shares the project is not one.
        .not("settings->>studio", "is", null)
        // ...and neither is the studio's own internal store row.
        .or(NOT_HIDDEN)
        // Both keys, so the cursor's tiebreak has an order to break.
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        // One extra row decides whether there is a next page without a count.
        .limit(limit + 1)
      // Archived is a SOFT HIDE the dashboard honours; an agent that listed
      // them would resurrect rows the user deliberately put away (D12).
      if (!query.includeArchived) q = q.or(NOT_ARCHIVED)
      if (cursor) q = q.or(listCursorFilter(cursor))

      const { data, error } = await q
      if (error) return sendInternalError(reply, req, error, "Failed to list productions")

      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
      const page = rows.slice(0, limit)
      // The cursor is minted from the last row of the PAGE, never the probe.
      const last = page[page.length - 1]
      const body: StudioListProductionsResponse = {
        data: page.map((row) => toProductionSummary(asViewable(row))),
        ...(rows.length > limit && last
          ? {
              nextCursor: encodeListCursor({
                updatedAt: String(last.updated_at),
                id: String(last.id),
              }),
            }
          : {}),
      }
      return { data: body }
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to list productions")
    }
  })

  // ── create, optionally from a plan ─────────────────────────────────────────
  app.post("/v1/studio/productions", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return
    const body = parseWith(reply, createBody, req.body ?? {}, "Invalid request")
    if (!body) return

    try {
      const landed = body.plan
        ? landPlan(body.plan, {
            candidates: await mentionCandidatesFor(userId),
            fallbackName: body.name,
          })
        : undefined
      if (landed && !landed.ok) return validationError(reply, landed.error, landed.path)

      const projectId = await ensureStudioProject(userId)
      const graph = landed?.ok ? serializeCreate(landed) : undefined
      const { data, error } = await supabase
        .from("workflows")
        .insert({
          project_id: projectId,
          user_id: userId,
          name: landed?.name ?? body.name?.trim() ?? "Untitled production",
          nodes: graph?.nodes ?? [],
          edges: graph?.edges ?? [],
          // An empty production still carries `settings.studio`: it is what
          // makes the row a PRODUCTION rather than a bare workflow, and what
          // the `app_slug` inference reads.
          settings: graph?.settings ?? { studio: { version: 3, shots: [], shotOrder: [] } },
          app_slug: "studio",
        })
        .select(PRODUCTION_COLS)
        .single()

      if (error || !data) {
        return sendInternalError(reply, req, error, "Failed to create production")
      }

      const view = toProductionView(asViewable(data as Record<string, unknown>), {
        detail: "full",
      })
      return reply.status(201).send({
        data: {
          production: view,
          ...(landed?.ok
            ? {
                warnings: landed.result.warnings.map(toPlanIssue),
                summary: {
                  shotsAdded: landed.result.shots.length,
                  castEnrolled: Object.keys(view.cast ?? {}).length,
                  castBound: landed.result.summary.castBound,
                },
              }
            : {}),
        },
      })
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to create production")
    }
  })

  // ── get ────────────────────────────────────────────────────────────────────
  app.get("/v1/studio/productions/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return
    const params = parseWith(reply, productionIdParams, req.params, "Invalid production ID")
    if (!params) return
    const query = parseWith(reply, getQuery, req.query ?? {}, "Invalid query")
    if (!query) return

    const loaded = await loadWorkflowFor(
      req,
      reply,
      userId,
      params.id,
      "view",
      PRODUCTION_COLS,
      "Failed to fetch production",
    )
    if (!loaded.ok) return
    // A workflow that is not a production is not a production the caller can
    // see — the same 404 an unreachable row gets, for the same reason.
    if (!isProduction(loaded.row)) return notFound(reply)

    const view: StudioProductionView = toProductionView(viewableFor(loaded.row, loaded.access), {
      detail: query.detail ?? "summary",
      ...(query.shot_id ? { shotId: query.shot_id } : {}),
    })
    return { data: { production: view } }
  })

  // ── import a plan into a production that already exists ────────────────────
  app.post("/v1/studio/productions/:id/import", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return
    const params = parseWith(reply, productionIdParams, req.params, "Invalid production ID")
    if (!params) return
    const body = parseWith(reply, importBody, req.body ?? {}, "Invalid plan")
    if (!body) return

    const loaded = await loadWorkflowFor(
      req,
      reply,
      userId,
      params.id,
      "edit",
      PRODUCTION_COLS,
      "Failed to fetch production",
    )
    if (!loaded.ok) return
    if (!isProduction(loaded.row)) return notFound(reply)

    try {
      const landed = landPlan(body.plan, {
        candidates: await mentionCandidatesFor(userId),
      })
      if (!landed.ok) return validationError(reply, landed.error, landed.path)

      const current = asViewable(loaded.row)
      const appended = serializeAppend(current, landed)
      /**
       * The append MERGES `settings`; it never replaces it.
       *
       * `serializeProduction` builds `settings.studio` from a fixed parameter
       * list, so writing its output whole erases every key outside that list —
       * the studio's `pendingDraft` / `pendingMusic` markers today, and
       * whatever a later version of the app writes there tomorrow. Spec §11:
       * "`settings.studio` unknown to the serializer is never erased". The
       * serializer wins wherever it has something to say (it owns the shots,
       * the order, the cast); the stored document keeps the rest, and the keys
       * BESIDE `studio` belong to other readers entirely.
       */
      const currentSettings = (loaded.row.settings as Record<string, unknown> | null) ?? {}
      const currentStudio = (currentSettings.studio as Record<string, unknown> | null) ?? {}
      const { data, error } = await supabase
        // tenant-scope-ignore: authorized by loadWorkflowFor(..., "edit") above.
        .from("workflows")
        .update({
          nodes: appended.nodes,
          edges: appended.edges,
          settings: {
            ...currentSettings,
            ...appended.settings,
            studio: { ...currentStudio, ...appended.settings.studio },
          },
        })
        .eq("id", params.id)
        .select(PRODUCTION_COLS)
        .maybeSingle()
      if (error) return sendInternalError(reply, req, error, "Failed to import plan")
      if (!data) return notFound(reply)

      const view = toProductionView(
        viewableFor(data as Record<string, unknown>, loaded.access),
        { detail: "full" },
      )
      return {
        data: {
          production: view,
          warnings: landed.result.warnings.map(toPlanIssue),
          summary: {
            shotsAdded: landed.result.shots.length,
            // The roles the merge ADDED — which on an append is not the size of
            // the cast: a name the production already knows enrolls nothing,
            // and reporting "1 enrolled" for a Kira who was already cast says
            // something happened that did not. The same pure merge
            // `serializeAppend` ran, on the same inputs.
            castEnrolled: mergeCast(parseProduction(current).cast ?? {}, landed.cast, landed.shots)
              .enrolled.length,
            castBound: landed.result.summary.castBound,
          },
        },
      }
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to import plan")
    }
  })
}

function toPlanIssue(warning: { message: string; path?: string; code: string }): StudioPlanIssue {
  return {
    path: warning.path ?? "",
    message: warning.message,
    hint: warning.code,
  }
}
