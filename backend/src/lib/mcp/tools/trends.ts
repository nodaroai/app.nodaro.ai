/**
 * MCP trend verbs — the agent's face of `/v1/trends` (ee/routes/trends.ts): a
 * trend is a ready-made Cast Swap recipe, a short clip whose slots (people,
 * pets, products, the place) the user fills with their own pictures.
 *
 *   list_trends     GET  /v1/trends                 jobs:read
 *   get_trend       GET  /v1/trends/:slug           jobs:read
 *   estimate_trend  POST /v1/trends/:slug/estimate  workflows:execute
 *   run_trend       POST /v1/trends/:slug/runs      workflows:execute
 *
 * Price confirmation follows `cast_swap`: without `confirm`, `run_trend`
 * returns the quote (nothing is created or charged); `confirm: true`, only
 * after the user accepted it, runs, and the job is followed with `get_job` /
 * `wait_for_job` like any other.
 *
 * HIDDEN data never leaves: the routes already answer with public fields only,
 * and every result here is rebuilt field by field from those (never spread),
 * so a field a route might add later does not reach the agent by accident.
 * The route is the authority on every rule (required slots, chips per kind,
 * image caps, draft only at 480p); this file maps snake_case to its body.
 *
 * Cloud-only: registered behind `hasCredits()` in server.ts — off-cloud the
 * routes are not served and a call answers `not_available`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { mcpInject } from "../internal-request.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { registerTask } from "../tasks.js"
import { isRouterNotFound } from "./_studio-helpers.js"
import { clientRequestIdSchema, errorResult, GET_JOB_POLL_HINT, idempotencyHeaders } from "./_verb-helpers.js"

const readGate: ToolGate = { required: ["jobs:read"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

const NOT_AVAILABLE = "Trends are a Nodaro Cloud feature and are not served on this deployment."

export interface RegisterTrendToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

// ── inputs ──────────────────────────────────────────────────────────────────

/**
 * The route's own slug shape (migration 549), so a path can never be smuggled
 * in; `runs` is reserved (`GET /v1/trends/runs` is the run list), never a slug.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const notReserved = (s: string) => s !== "runs"
const RESERVED = { message: '"runs" is reserved; it is not a trend slug.' }
const slug = z.string().regex(SLUG_RE).refine(notReserved, RESERVED).describe("The trend's slug (from list_trends).")

const chip = z.enum(["new", "original"]).optional()

const slotInput = z.object({
  images: z.array(z.string().url()).max(3).optional(),
  body: chip,
  outfit: chip,
  hair: chip,
  coat: chip,
  shape: chip,
  finish: chip,
})

/** The inputs estimate_trend and run_trend share (a SCHEMA_FRAGMENTS entry of tool-schema-walk.test.ts, read through `runBody(args)`). */
export const trendRunShape = {
  slug,
  slots: z
    .record(z.string().regex(/^[a-z0-9_]{1,32}$/), slotInput)
    .describe(
      "By the trend's slot keys (get_trend): 1–3 image URLs of ONE subject each. Every required slot needs images; an optional slot left out takes the example's. " +
        'Chips, each "new" (from the images) or "original" (as in the clip): person body/outfit/hair, pet body/coat, product shape/finish.',
    ),
  example: z.number().int().min(1).optional().describe("The example (1-based, default 1) whose pictures fill optional slots left out."),
  details: z.string().max(1000).optional().describe("The user's own words; mention a slot as {slot:<key>}."),
  preview: z.boolean().optional().describe("true = a 4 s preview (when the trend's previewSec is 4)."),
  resolution: z.enum(["480p", "720p", "1080p"]).optional().describe('Default "480p".'),
  draft: z.boolean().optional().describe("Default true; only at 480p."),
}

type RunArgs = z.infer<z.ZodObject<typeof trendRunShape>> & { session_id?: string }

/** The route's camelCase body; an empty images list is left out (the slot then takes the example's). */
function runBody(args: RunArgs): Record<string, unknown> {
  const slots: Record<string, Record<string, unknown>> = {}
  for (const [key, { images, ...chips }] of Object.entries(args.slots)) {
    slots[key] = { ...(images && images.length > 0 ? { images } : {}), ...chips }
  }
  return {
    slots,
    ...(args.example !== undefined ? { example: args.example } : {}),
    ...(args.details !== undefined ? { details: args.details } : {}),
    ...(args.preview !== undefined ? { preview: args.preview } : {}),
    ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
    ...(args.draft !== undefined ? { draft: args.draft } : {}),
    ...(args.session_id !== undefined ? { sessionId: args.session_id } : {}),
  }
}

// ── outputs (whitelists of the public route shapes) ─────────────────────────

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number => (typeof v === "number" ? v : 0)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

const NEED_KINDS = ["person", "location", "product", "pet"] as const
const CHIPS = ["body", "outfit", "hair", "coat", "shape", "finish"] as const

/** `{ data }` unwrapped, or null when the body is not JSON. */
function dataOf(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as unknown
    return isRec(parsed) && "data" in parsed ? parsed.data : parsed
  } catch {
    return null
  }
}

function cardView(c: Rec): Rec {
  const cover = isRec(c.cover) ? c.cover : {}
  const needs = isRec(c.needs) ? c.needs : {}
  const description = str(c.description)
  const poster = str(cover.posterUrl)
  return {
    id: str(c.id) ?? "",
    slug: str(c.slug) ?? "",
    name: str(c.name) ?? "",
    ...(description ? { description } : {}),
    tags: strings(c.tags),
    badges: strings(c.badges),
    cover: { videoUrl: str(cover.videoUrl) ?? "", ...(poster ? { posterUrl: poster } : {}), width: num(cover.width), height: num(cover.height) },
    needs: Object.fromEntries(NEED_KINDS.map((k) => [k, num(needs[k])])),
    durationSec: num(c.durationSec),
    isFavorite: c.isFavorite === true,
  }
}

function detailView(d: Rec): Rec {
  return {
    ...cardView(d),
    version: num(d.version),
    previewSec: d.previewSec === 4 ? 4 : null,
    resolutions: strings(d.resolutions),
    slots: (Array.isArray(d.slots) ? d.slots.filter(isRec) : []).map((s) => {
      const hint = str(s.hint)
      const given = isRec(s.defaults) ? s.defaults : {}
      const defaults = Object.fromEntries(CHIPS.filter((k) => given[k] === "new" || given[k] === "original").map((k) => [k, given[k]]))
      return {
        key: str(s.key) ?? "",
        label: str(s.label) ?? "",
        kind: str(s.kind) ?? "",
        required: s.required === true,
        ...(hint ? { hint } : {}),
        ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
      }
    }),
    examples: (Array.isArray(d.examples) ? d.examples.filter(isRec) : []).map((ex) => {
      const poster = str(ex.posterUrl)
      const slots = isRec(ex.slots) ? ex.slots : {}
      return {
        videoUrl: str(ex.videoUrl) ?? "",
        ...(poster ? { posterUrl: poster } : {}),
        width: num(ex.width),
        height: num(ex.height),
        slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, strings(v)])),
      }
    }),
  }
}

function cardLine(c: Rec): string {
  const needs = c.needs as Record<string, number>
  const need = NEED_KINDS.filter((k) => needs[k]! > 0).map((k) => `${needs[k]} ${k}`).join(", ")
  const tags = (c.tags as string[]).length > 0 ? ` · ${(c.tags as string[]).join(", ")}` : ""
  return `- ${String(c.name)} (slug ${String(c.slug)}) — ${need || "no slots"}, ${String(c.durationSec)} s${tags}${c.isFavorite ? " · favorite" : ""}`
}

interface TrendQuote {
  expectedCredits: number
  holdCredits: number
  breakdown: Rec
}

function quoteOf(body: string): TrendQuote | null {
  const q = dataOf(body)
  if (!isRec(q) || typeof q.expectedCredits !== "number" || typeof q.holdCredits !== "number") return null
  const breakdown = isRec(q.breakdown)
    ? Object.fromEntries(Object.entries(q.breakdown).filter(([, v]) => typeof v === "number" && Number.isFinite(v)))
    : {}
  return { expectedCredits: q.expectedCredits, holdCredits: q.holdCredits, breakdown }
}

function quoteSentence(q: TrendQuote, preview: boolean | undefined): string {
  const held = q.holdCredits !== q.expectedCredits ? ` (up to ${q.holdCredits} held while it runs)` : ""
  return `This trend ${preview ? "preview " : ""}run costs about ${q.expectedCredits} credits${held}.`
}

// ── errors ──────────────────────────────────────────────────────────────────

const failure = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const })

/** A route refusal as a tool error: a router 404 is `not_available`; a slot error also names the slot's key. */
function refusal(statusCode: number, body: string) {
  if (isRouterNotFound(statusCode, body)) {
    return errorResult(404, JSON.stringify({ error: { code: "not_available", message: NOT_AVAILABLE } }))
  }
  const res = errorResult(statusCode, body)
  const parsed = (() => {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return null
    }
  })()
  const err = isRec(parsed) && isRec(parsed.error) ? parsed.error : {}
  const code = str(err.code)
  if (statusCode === 503 && (code === "trend_unavailable" || code === "engine_unsupported")) {
    return failure(`Nodaro: this trend cannot run right now. [${code}]`)
  }
  const slot = str(err.slot)
  if (slot && statusCode >= 400 && statusCode < 500) return failure(`${res.content[0].text} (slot "${slot}")`)
  return res
}

// ── tools ───────────────────────────────────────────────────────────────────

export function registerTrendTools({ server, session, fastify }: RegisterTrendToolsOpts): void {
  if (passesGate(session, readGate)) {
    server.registerTool(
      "list_trends",
      {
        title: "List Trends",
        description:
          "Ready-made video trends: a short clip whose people, pets, products or place the user can replace with their own pictures. " +
          "Each with its slug, what it needs and its length. Filter by `query`, `tag` or `favorites`; page with `cursor`.",
        inputSchema: {
          query: z.string().max(200).optional().describe("Search words."),
          tag: z.string().min(1).max(100).optional(),
          favorites: z.boolean().optional().describe("true = only the user's favorites."),
          cursor: z.string().max(500).optional().describe("next from the previous call."),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const query: Record<string, string> = {}
        if (args.query?.trim()) query.q = args.query
        if (args.tag) query.tag = args.tag
        if (args.favorites === true) query.favorites = "1"
        if (args.cursor) query.cursor = args.cursor
        const res = await mcpInject(fastify, session, { method: "GET", url: "/v1/trends", ...(Object.keys(query).length > 0 ? { query } : {}) })
        if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
        let page: Rec
        try {
          page = JSON.parse(res.body) as Rec
        } catch {
          return failure("The trend list could not be read.")
        }
        const trends = (Array.isArray(page.data) ? page.data.filter(isRec) : []).map(cardView)
        const next = str(page.next) ?? null
        const more = next ? `\n\nMore: call again with cursor "${next}".` : ""
        return {
          content: [{ type: "text" as const, text: (trends.length > 0 ? trends.map(cardLine).join("\n") : "No trends.") + more }],
          structuredContent: { trends, next },
        }
      },
    )

    server.registerTool(
      "get_trend",
      {
        title: "Get Trend",
        description:
          "One trend: its slots (key, label, kind, required, hint, default chips), its examples (the result video and the pictures each slot used), " +
          "previewSec and resolutions. Fill estimate_trend / run_trend `slots` by these keys.",
        inputSchema: {
          slug: z.string().regex(SLUG_RE).refine(notReserved, RESERVED).describe("The trend's slug (from list_trends)."),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const res = await mcpInject(fastify, session, { method: "GET", url: `/v1/trends/${args.slug}` })
        if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
        const detail = dataOf(res.body)
        if (!isRec(detail)) return failure("The trend could not be read.")
        const view = detailView(detail)
        return { content: [{ type: "text" as const, text: JSON.stringify(view) }], structuredContent: view }
      },
    )
  }

  if (!passesGate(session, executeGate)) return

  server.registerTool(
    "estimate_trend",
    {
      title: "Estimate Trend",
      description:
        "Quote a trend run (free; nothing starts): the credits it is expected to cost and the amount held while it runs. Takes run_trend's arguments.",
      inputSchema: {
        ...trendRunShape,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const res = await mcpInject(fastify, session, { method: "POST", url: `/v1/trends/${args.slug}/estimate`, payload: runBody(args) })
      if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
      const quote = quoteOf(res.body)
      if (!quote) return failure("The trend quote could not be read.")
      return {
        content: [{ type: "text" as const, text: `${quoteSentence(quote, args.preview)} Nothing was charged; run_trend starts it.` }],
        structuredContent: { ...quote },
      }
    },
  )

  server.registerTool(
    "run_trend",
    {
      title: "Run Trend",
      description:
        "Make a trend's video with the user's pictures. Without `confirm` it returns the PRICE QUOTE only (nothing is charged): show the credits to the user, " +
        "and call again with `confirm: true` only once they accept. That returns a job id: poll it with wait_for_job. " +
        "Image URLs must be http(s): upload local files with the upload tools first.",
      inputSchema: {
        ...trendRunShape,
        session_id: z.string().min(1).optional().describe("A generation session; accepted, not yet applied (runs are not filed into sessions yet)."),
        confirm: z.boolean().optional().describe("true ONLY after the user accepted the quoted credits in this conversation."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const payload = runBody(args)

      if (args.confirm !== true) {
        const est = await mcpInject(fastify, session, { method: "POST", url: `/v1/trends/${args.slug}/estimate`, payload })
        if (est.statusCode >= 400) return refusal(est.statusCode, est.body)
        const quote = quoteOf(est.body)
        if (!quote) return failure("The trend quote could not be read.")
        return {
          content: [
            {
              type: "text" as const,
              text:
                `${quoteSentence(quote, args.preview)} ` +
                "Present this to the user; call run_trend again with the same arguments and confirm: true once they accept.",
            },
          ],
          structuredContent: { ...quote, confirmed: false },
        }
      }

      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: `/v1/trends/${args.slug}/runs`,
        payload,
        headers: idempotencyHeaders(args.client_request_id),
      })
      if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
      const data = dataOf(res.body)
      const jobId = isRec(data) ? str(data.jobId) : undefined
      if (!jobId) return failure("The trend run was submitted, but its job id could not be read.")
      registerTask({ taskId: jobId, userId: session.userId, kind: "video" })
      return {
        content: [{ type: "text" as const, text: `The trend run started (job ${jobId}). To follow it, ${GET_JOB_POLL_HINT}.` }],
        structuredContent: { jobId, confirmed: true },
      }
    },
  )
}
