/**
 * Trend Radar — `/v1/trend-radar/*` (Cloud, admin session only).
 *
 * The queue of candidate trends the daily run found, one candidate with its
 * readings and posts, the admin's decisions (approve into a draft trend,
 * keep watching, reject), the settings the run reads, and "Run now". Every
 * route answers a signed-in ADMIN session alone: an API key or an app's
 * OAuth token gets `403 forbidden` (`rejectProgrammaticAuth`), like billing —
 * a first-party app (the admin page, tools.nodaro.ai) calls them through
 * `@nodaro/sdk`'s `client.trendRadar` with the person's own session.
 *
 * `POST /v1/trend-radar/internal/tick` is the cron's door (`lib/trend-radar-
 * cron.ts`): the internal secret only, never a user.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { config } from "../../lib/config.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import { TrendSlugTakenError, createTrend } from "../lib/trends/store.js"
import { trendVersionDataSchema } from "../lib/trends/schemas.js"
import { israelParts } from "../notifications/israel-time.js"
import {
  TrendRadarUnavailableError,
  claimRunDay,
  listCandidates,
  readCandidate,
  readCandidateRow,
  readPublicSettings,
  readSettings,
  readSummary,
  replaceSources,
  toCard,
  updateCandidate,
  updateOpenCandidate,
  writeSettings,
} from "../lib/trend-radar/store.js"
import { makeSearch, runDue, runTrendRadar } from "../lib/trend-radar/run.js"
import { attachTopPostClip } from "../lib/trend-radar/attach-clip.js"
import { TREND_CANDIDATE_SORTS, TREND_CANDIDATE_STATUSES, TREND_RADAR_SOURCE_KINDS } from "../lib/trend-radar/types.js"

const SESSION_ONLY_MSG = "Trend Radar answers a signed-in admin session only"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const listQuery = z.object({
  status: z.enum(TREND_CANDIDATE_STATUSES).optional(),
  sort: z.enum(TREND_CANDIDATE_SORTS).optional(),
  cursor: z.string().regex(/^\d{1,9}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const idParams = z.object({ id: z.string().regex(UUID_RE, "Not a candidate id.") })

const rejectBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })

const sourceBody = z.strictObject({
  id: z.string().regex(UUID_RE).optional(),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(TREND_RADAR_SOURCE_KINDS),
  url: z.url({ protocol: /^https$/ }).max(2000).nullable(),
  enabled: z.boolean(),
})

const settingsBody = z.strictObject({
  sources: z.array(sourceBody).max(50).optional(),
  thresholds: z
    .strictObject({
      minCreators: z.int().min(1).max(100).optional(),
      windowDays: z.int().min(1).max(90).optional(),
      risingPct: z.number().min(0).max(1000).optional(),
      slowingPct: z.number().min(0).max(100).optional(),
      maxClipSec: z.int().min(1).max(120).optional(),
      dailySearchBudget: z.int().min(0).max(1000).optional(),
    })
    .optional(),
  alerts: z.strictObject({ slackNewCandidate: z.boolean().optional(), slackDailySummary: z.boolean().optional() }).optional(),
  retentionDays: z.int().min(1).max(365).optional(),
  runAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Run time is HH:MM.").optional(),
})

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function failed(reply: FastifyReply, req: FastifyRequest, e: unknown, what: string) {
  if (e instanceof TrendRadarUnavailableError) {
    return reply.status(503).send({ error: { code: "not_available", message: "Trend Radar is not available on this server yet." } })
  }
  return sendInternalError(reply, req, e, what)
}

/** An approved candidate has a draft trend: it is decided in the trends admin now, not here. */
function approvedAlready(reply: FastifyReply) {
  return reply.status(409).send({ error: { code: "already_approved", message: "This candidate was approved; its draft trend is in the trends admin." } })
}

/** The admin-session gate every public route of this file runs. */
async function adminSession(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (rejectProgrammaticAuth(req, reply, SESSION_ONLY_MSG)) return reply
  return requireAdmin(req, reply)
}

/** One run at a time per process; a second ask while one runs answers the running one. */
let running: Promise<unknown> | null = null

function startRun(app: FastifyInstance): Promise<unknown> {
  if (!running) {
    running = runTrendRadar({ search: makeSearch(app) })
      .catch((e: unknown) => {
        app.log.error({ err: e }, "[trend-radar] run failed")
      })
      .finally(() => {
        running = null
      })
  }
  return running
}

export async function trendRadarRoutes(app: FastifyInstance): Promise<void> {
  openApiRegistry.registerPath({
    method: "get",
    path: "/v1/trend-radar/candidates",
    description: "The candidate trends the daily radar run found. Admin session only (Cloud).",
    responses: { 200: { description: "A page of candidate cards", content: { "application/json": { schema: z.object({ data: z.array(z.any()), next: z.string().nullable() }) } } } },
  })

  app.get("/v1/trend-radar/summary", { preHandler: adminSession }, async (req, reply) => {
    try {
      return { data: await readSummary() }
    } catch (e) {
      return failed(reply, req, e, "Failed to read the radar summary")
    }
  })

  app.get("/v1/trend-radar/candidates", { preHandler: adminSession }, async (req, reply) => {
    const q = listQuery.safeParse(req.query ?? {})
    if (!q.success) return badRequest(reply, q.error)
    try {
      return await listCandidates(q.data)
    } catch (e) {
      return failed(reply, req, e, "Failed to list candidates")
    }
  })

  app.get("/v1/trend-radar/candidates/:id", { preHandler: adminSession }, async (req, reply) => {
    const p = idParams.safeParse(req.params)
    if (!p.success) return badRequest(reply, p.error)
    try {
      const settings = await readSettings()
      const c = await readCandidate(p.data.id, settings.thresholds)
      if (!c) return reply.status(404).send({ error: { code: "not_found", message: "Candidate not found" } })
      return { data: c }
    } catch (e) {
      return failed(reply, req, e, "Failed to read the candidate")
    }
  })

  app.post("/v1/trend-radar/candidates/:id/approve", { preHandler: adminSession }, async (req, reply) => {
    const p = idParams.safeParse(req.params)
    if (!p.success) return badRequest(reply, p.error)
    try {
      const row = await readCandidateRow(p.data.id)
      if (!row) return reply.status(404).send({ error: { code: "not_found", message: "Candidate not found" } })
      if (row.status === "approved" && row.trend_id) return { data: { trendId: row.trend_id, clip: "none" } }
      const data = trendVersionDataSchema.safeParse({ name: { en: row.name }, source: null, previewStart: 0, slots: [], references: [], examples: [] })
      if (!data.success) return badRequest(reply, data.error)
      // Claim the row first (a conditional write): two approves at once, or
      // the daily run writing meanwhile, cannot each create a draft trend.
      const claimed = await updateOpenCandidate(row.id, { status: "approved", event: { event: "approved", detail: "Approved by an admin" } })
      if (!claimed) {
        const latest = await readCandidateRow(row.id)
        if (latest?.status === "approved" && latest.trend_id) return { data: { trendId: latest.trend_id, clip: "none" } }
        return reply.status(409).send({ error: { code: "not_open", message: "This candidate was decided already" } })
      }
      let slug = row.slug
      let trendId: string | null = null
      try {
        for (let attempt = 0; attempt < 5 && !trendId; attempt++) {
          try {
            trendId = (await createTrend({ slug, data: data.data, ...(req.userId ? { createdBy: req.userId } : {}) })).id
          } catch (e) {
            if (!(e instanceof TrendSlugTakenError)) throw e
            slug = `${row.slug}-${attempt + 2}`
          }
        }
      } finally {
        // No draft: give the row back as it was, so the approve can be tried again.
        if (!trendId) await updateCandidate(row.id, { status: row.status, event: { event: "approve_failed", detail: "No draft trend was created" } }).catch(() => undefined)
      }
      if (!trendId) return reply.status(409).send({ error: { code: "slug_taken", message: "A trend with this name exists already" } })
      await updateCandidate(row.id, { trendId, event: { event: "draft_created", detail: `Draft trend ${slug}` } })
      await audit(req, "approve_trend_candidate", "trend_radar_candidate", row.id, { trendId, slug })
      // The top post becomes the draft's source clip in the background (as
      // the approving admin); the candidate's history says how it went.
      const post = row.top_post
      const clip = post && req.userId ? "attaching" : "none"
      if (post && req.userId) {
        void attachTopPostClip({ trendId, candidateId: row.id, post, userId: req.userId }).catch((e: unknown) => {
          req.log.warn({ err: e, trendId }, "[trend-radar] attaching the top post's clip failed")
        })
      }
      return { data: { trendId, clip } }
    } catch (e) {
      return failed(reply, req, e, "Failed to approve the candidate")
    }
  })

  app.post("/v1/trend-radar/candidates/:id/watch", { preHandler: adminSession }, async (req, reply) => {
    const p = idParams.safeParse(req.params)
    if (!p.success) return badRequest(reply, p.error)
    try {
      const row = await readCandidateRow(p.data.id)
      if (!row) return reply.status(404).send({ error: { code: "not_found", message: "Candidate not found" } })
      if (row.status === "approved") return approvedAlready(reply)
      const updated = await updateCandidate(row.id, { status: "watching", rejectReason: null, event: { event: "watching", detail: "Kept watching by an admin" } })
      await audit(req, "watch_trend_candidate", "trend_radar_candidate", row.id, {})
      return { data: toCard(updated) }
    } catch (e) {
      return failed(reply, req, e, "Failed to update the candidate")
    }
  })

  app.post("/v1/trend-radar/candidates/:id/reject", { preHandler: adminSession }, async (req, reply) => {
    const p = idParams.safeParse(req.params)
    if (!p.success) return badRequest(reply, p.error)
    const b = rejectBody.safeParse(req.body)
    if (!b.success) return badRequest(reply, b.error)
    try {
      const row = await readCandidateRow(p.data.id)
      if (!row) return reply.status(404).send({ error: { code: "not_found", message: "Candidate not found" } })
      if (row.status === "approved") return approvedAlready(reply)
      const updated = await updateCandidate(row.id, { status: "rejected", rejectReason: b.data.reason, event: { event: "rejected", detail: b.data.reason } })
      await audit(req, "reject_trend_candidate", "trend_radar_candidate", row.id, { reason: b.data.reason })
      return { data: toCard(updated) }
    } catch (e) {
      return failed(reply, req, e, "Failed to reject the candidate")
    }
  })

  app.get("/v1/trend-radar/settings", { preHandler: adminSession }, async (req, reply) => {
    try {
      return { data: await readPublicSettings() }
    } catch (e) {
      return failed(reply, req, e, "Failed to read the radar settings")
    }
  })

  app.put("/v1/trend-radar/settings", { preHandler: adminSession }, async (req, reply) => {
    const b = settingsBody.safeParse(req.body)
    if (!b.success) return badRequest(reply, b.error)
    try {
      if (b.data.sources) await replaceSources(b.data.sources)
      // Whoever saves is the runner: the daily searches are theirs.
      await writeSettings({
        ...(b.data.thresholds ? { thresholds: b.data.thresholds } : {}),
        ...(b.data.alerts ? { alerts: b.data.alerts } : {}),
        ...(b.data.retentionDays !== undefined ? { retentionDays: b.data.retentionDays } : {}),
        ...(b.data.runAt !== undefined ? { runAt: b.data.runAt } : {}),
        ...(req.userId ? { runnerUserId: req.userId } : {}),
      })
      await audit(req, "update_trend_radar_settings", "trend_radar_settings", "1", { keys: Object.keys(b.data).sort() })
      return { data: await readPublicSettings() }
    } catch (e) {
      return failed(reply, req, e, "Failed to save the radar settings")
    }
  })

  app.post("/v1/trend-radar/run", { preHandler: adminSession }, async (req, reply) => {
    try {
      if (req.userId) await writeSettings({ runnerUserId: req.userId })
      const startedAt = new Date().toISOString()
      void startRun(app)
      await audit(req, "run_trend_radar", "trend_radar_settings", "1", {})
      return reply.status(202).send({ data: { runId: startedAt, startedAt } })
    } catch (e) {
      return failed(reply, req, e, "Failed to start the run")
    }
  })

  // The cron's tick: the internal secret alone (the auth hook checked it).
  app.post("/v1/trend-radar/internal/tick", async (req, reply) => {
    if (req.authKind !== "internal" || !config.INTERNAL_ORCHESTRATOR_SECRET) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    }
    try {
      const now = new Date()
      const settings = await readSettings()
      if (!runDue(settings, now)) return { data: { ran: false } }
      // The day is claimed before the run, once across processes: a run that
      // fails is not asked again every minute until midnight.
      if (!(await claimRunDay(israelParts(now).date))) return { data: { ran: false } }
      void startRun(app)
      return { data: { ran: true } }
    } catch (e) {
      if (e instanceof TrendRadarUnavailableError) return { data: { ran: false } }
      return failed(reply, req, e, "Failed to tick the radar")
    }
  })
}
