import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  COMPETITOR_READ_ROLES,
  SOCIAL_PLATFORMS,
  SOCIAL_READ_DAY_PATTERN,
  SOCIAL_READ_DEFAULT_LIMIT,
  SOCIAL_READ_LIMIT_MAX,
  SOCIAL_READ_PERIODS,
  SOCIAL_READ_WINDOW_DAYS_MAX,
  SOCIAL_READ_WINDOW_HOURS_MAX,
  SAVED_POST_TAG_MAX,
  WORKSPACE_HEADER_LOWER,
  isValidTimezone,
  socialPostsDigest,
  type SocialPlatform,
  type SocialPost,
} from "@nodaro/shared"
import { config } from "../lib/config.js"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { markJobFailed } from "../lib/job-failure.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import { socialReadRange, type SocialReadRange } from "../lib/social-read-period.js"
import { readSavedPosts } from "../lib/saved-posts-store.js"
import { isWorkflowCreator } from "../lib/workflow-creator.js"
import {
  competitorPostsFromScans,
  hasUndatedPosts,
  inspirationPostOf,
  planScans,
  undatedPostIds,
  type ScanPoint,
  type ScanPosts,
} from "../lib/social-post-reads.js"
import { markJobCompleted } from "../workers/shared.js"
import { creditGuard } from "../middleware/credit-guard.js"

/**
 * Read Inspiration and Read Competitor — sync-HTTP node routes, called by the
 * editor's Run and by the orchestrator alike (`SYNC_HTTP_ROUTES`). Both read
 * what the account already holds, so both are free (`creditGuard` with
 * `checkOnly` keeps the edition and account gates, reserves nothing), and both
 * answer through a `jobs` row so a run's history shows them: returning a
 * `jobId` routes the orchestrator down its job-polling branch, where the
 * node's output is rebuilt from `output_data` (`buildNodeOutputFromJobData`).
 *
 * Both emit posts the way Social Search does — `json` the posts, `text` their
 * digest — for the period the node asks: the last N hours or days, or one
 * calendar day in the node's timezone.
 *
 * OWNER ONLY. Both read as the caller — never as a workflow's creator — and a
 * run of someone else's workflow (a published app, a shared workflow, a
 * component) is refused: the creator wrote every node after the reader, so a
 * Webhook Output there would carry the runner's saved posts, notes and brands
 * to the creator. A direct call (no workflow) reads the caller's own library.
 *
 * Read Inspiration (`POST /v1/inspiration-read`): the person's saved posts,
 * by the day they were saved, optionally one platform and one tag.
 *
 * Read Competitor (`POST /v1/competitor-read`): a tracked brand's posts as its
 * scans found them, by the day each was published. Competitors are served by
 * the Cloud plugin; this route reads them through the plugin's own routes
 * in-process, so the plugin stays the only reader of its tables. Without the
 * plugin it answers 503 `not_available`.
 */

/** A node keeps "" in a field it is not using: that is "not given", never a refusal. */
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v)

const periodFields = {
  period: z.enum(SOCIAL_READ_PERIODS).default("window"),
  windowAmount: z.coerce.number().int().min(1).max(SOCIAL_READ_WINDOW_HOURS_MAX).default(7),
  windowUnit: z.enum(["hours", "days"]).default("days"),
  day: z.preprocess(blankToUndefined, z.string().regex(SOCIAL_READ_DAY_PATTERN).optional()),
  timezone: z.preprocess(blankToUndefined, z.string().max(64).optional()),
  limit: z.coerce.number().int().min(1).max(SOCIAL_READ_LIMIT_MAX).default(SOCIAL_READ_DEFAULT_LIMIT),
  order: z.enum(["newest", "oldest"]).default("newest"),
}

/** "all" and "" mean every platform. */
const platformField = z.union([z.enum(SOCIAL_PLATFORMS), z.literal("all"), z.literal("")]).optional()

type PeriodBody = { period: "window" | "day"; windowAmount: number; windowUnit: "hours" | "days"; day?: string; timezone?: string }

/** A window in days reaches back at most a year, whichever unit names it; a day needs its date; a timezone must be one this server can read. Refused, never clamped. */
function refinePeriod(b: PeriodBody, ctx: z.RefinementCtx): void {
  if (b.period === "day" && !b.day) ctx.addIssue({ code: "custom", path: ["day"], message: "required when period is \"day\" (YYYY-MM-DD)" })
  if (b.period === "window" && b.windowUnit === "days" && b.windowAmount > SOCIAL_READ_WINDOW_DAYS_MAX) {
    ctx.addIssue({ code: "custom", path: ["windowAmount"], message: `at most ${SOCIAL_READ_WINDOW_DAYS_MAX} days` })
  }
  if (b.timezone !== undefined && !isValidTimezone(b.timezone)) ctx.addIssue({ code: "custom", path: ["timezone"], message: "not a time zone this server knows (an IANA name such as Asia/Jerusalem)" })
}

const inspirationBody = z
  .object({ platform: platformField, tag: z.string().max(SAVED_POST_TAG_MAX * 2).optional(), ...periodFields })
  .superRefine(refinePeriod)

const competitorBody = z
  .object({ competitorId: z.string().uuid({ message: "pick a competitor in the node's settings" }), platform: platformField, role: z.enum(COMPETITOR_READ_ROLES).default("all"), ...periodFields })
  .superRefine(refinePeriod)

const NOT_A_DAY = "day: not a calendar date between 1970 and 2100 (YYYY-MM-DD)"
const NO_COMPETITORS = "Competitors are not available on this server."
const NOT_YOUR_BRAND = "That competitor does not exist (or is not yours). Pick a competitor in the node's settings."
const OWNER_ONLY = "This node reads your own library, so only the workflow's owner can run it — not a published app's runners or the people it is shared with."

const platformOf = (p: string | undefined): SocialPlatform | undefined => (p && p !== "all" ? (p as SocialPlatform) : undefined)
const iso = (ms: number) => new Date(ms).toISOString()
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

/** A 400 that names the field ("windowAmount: at most 365 days"). */
function validationError(reply: FastifyReply, error: z.ZodError) {
  const issue = error.issues[0]
  const path = issue?.path.join(".")
  return reply.status(400).send({ error: { code: "validation_error", message: issue ? (path ? `${path}: ${issue.message}` : issue.message) : "invalid request" } })
}

/** The per-user call limit: one call reads a whole period, so no lane — the editor, a run, a token — needs more. */
function perUserLimit(max: number) {
  return { rateLimit: { max, timeWindow: "1 minute" } }
}

/**
 * Whether the caller may run a reader inside this workflow: only the person
 * who built it. No workflow (a direct call) is the caller reading their own
 * library. Someone else's workflow is refused, and so is one that is gone: a
 * run already under way when its workflow (and the app published from it) is
 * deleted still carries the creator's steps after this node.
 */
async function ownerMayRun(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<boolean> {
  const workflowId = extractWorkflowId(req.body as Record<string, unknown>)
  if (!workflowId) return true
  const { creator, error } = await isWorkflowCreator(workflowId, userId)
  if (error) {
    sendInternalError(reply, req, error, "Failed to check the workflow")
    return false
  }
  if (!creator) {
    reply.status(403).send({ error: { code: "owner_only", message: OWNER_ONLY } })
    return false
  }
  return true
}

async function startJob(req: FastifyRequest, userId: string, nodeType: string, input: Record<string, unknown>) {
  const body = req.body as Record<string, unknown>
  return insertJob(req, {
    user_id: userId,
    workflow_id: extractWorkflowId(body) || null,
    node_id: extractNodeId(body) || null,
    status: "processing",
    input_data: buildJobInputData(input, nodeType),
    provider: nodeType,
    job_type: nodeType,
  })
}

/**
 * Ends the job with the posts and answers the caller; an empty list is
 * `text: ""` (the nodes behind it that need text are skipped). A completion
 * the job's result policy held or blocked answers with the job alone — never
 * the posts the policy kept back.
 */
async function finish(reply: FastifyReply, jobId: string, posts: readonly SocialPost[], range: SocialReadRange) {
  const text = socialPostsDigest(posts)
  const output = { json: posts, text, generatedText: text, count: posts.length, from: iso(range.from), to: iso(range.to) }
  const completed = await markJobCompleted(jobId, { output_data: output })
  if (!completed) return reply.send({ jobId })
  return reply.send({ jobId, posts, text, count: posts.length, from: output.from, to: output.to })
}

/** A plugin route, in-process, as the caller: the secret opens the door, `x-internal-user-id` names whose data it reads, the workspace rides along. */
async function pluginGet(app: FastifyInstance, req: FastifyRequest, userId: string, url: string): Promise<{ readonly status: number; readonly body: unknown }> {
  const workspace = req.headers[WORKSPACE_HEADER_LOWER]
  const res = await app.inject({
    method: "GET",
    url,
    headers: {
      "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
      "x-internal-user-id": userId,
      ...(typeof workspace === "string" ? { [WORKSPACE_HEADER_LOWER]: workspace } : {}),
    },
  })
  let body: unknown = null
  try {
    body = res.json()
  } catch {
    body = null
  }
  return { status: res.statusCode, body }
}

class ScanReadError extends Error {}

/** Reads the scans a few at a time. A scan gone since the history was read (404) is skipped; any other failure fails the read rather than return part of the period. */
async function readScans(app: FastifyInstance, req: FastifyRequest, userId: string, competitorId: string, scans: readonly ScanPoint[]): Promise<ScanPosts[]> {
  const out: ScanPosts[] = []
  for (let i = 0; i < scans.length; i += 4) {
    const batch = scans.slice(i, i + 4)
    const pages = await Promise.all(
      batch.map((s) => pluginGet(app, req, userId, `/v1/competitors/${encodeURIComponent(competitorId)}?scan=${encodeURIComponent(s.id)}`)),
    )
    pages.forEach((page, j) => {
      if (page.status === 404) return
      const latest = isObject(page.body) && isObject(page.body.latestScan) ? page.body.latestScan : null
      if (page.status !== 200 || !latest) throw new ScanReadError(`competitor scan answered ${page.status}`)
      out.push({ at: typeof latest.at === "string" ? latest.at : batch[j]!.at, posts: latest.posts })
    })
  }
  return out
}

export async function socialPostReadRoutes(app: FastifyInstance): Promise<void> {
  // Read Inspiration — 0 credits; the same scope the saved-posts list asks of an app token.
  app.post("/v1/inspiration-read", {
    config: perUserLimit(60),
    preHandler: [requireAppScope("assets:read"), creditGuard(() => "inspiration-read", { checkOnly: true, skipStorageCheck: true })],
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = inspirationBody.safeParse(req.body)
    if (!parsed.success) return validationError(reply, parsed.error)
    const { platform, tag, limit, order } = parsed.data
    const range = socialReadRange(parsed.data)
    if (!range) return reply.status(400).send({ error: { code: "validation_error", message: NOT_A_DAY } })
    if (!(await ownerMayRun(req, reply, userId))) return reply

    const { data: job, error: jobErr } = await startJob(req, userId, "inspiration-read", parsed.data)
    if (jobErr || !job) return sendInternalError(reply, req, jobErr, "Failed to create job")

    const { posts: saved, error } = await readSavedPosts({ userId, from: iso(range.from), to: iso(range.to), platform: platformOf(platform), tag, order, limit })
    if (error) {
      await markJobFailed(job.id, { error_message: "Failed to read saved posts" })
      return sendInternalError(reply, req, error, "Failed to read saved posts")
    }
    return finish(reply, job.id, saved.map((post) => inspirationPostOf(post)), range)
  })

  // Read Competitor — 0 credits; the scope the competitor routes ask of an app token.
  // One call reads up to 40 scans in-process, so its limit is the tighter one.
  app.post("/v1/competitor-read", {
    config: perUserLimit(30),
    preHandler: [requireAppScope("assets:read"), creditGuard(() => "competitor-read", { checkOnly: true, skipStorageCheck: true })],
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = competitorBody.safeParse(req.body)
    if (!parsed.success) return validationError(reply, parsed.error)
    const { competitorId, platform, role, limit, order } = parsed.data
    const asked = socialReadRange(parsed.data)
    if (!asked) return reply.status(400).send({ error: { code: "validation_error", message: NOT_A_DAY } })
    if (!(await ownerMayRun(req, reply, userId))) return reply

    // The brand first — no job row for a brand that is not the caller's.
    const list = await pluginGet(app, req, userId, "/v1/competitors")
    if (list.status === 404) return reply.status(503).send({ error: { code: "not_available", message: NO_COMPETITORS } })
    if (list.status !== 200 || !isObject(list.body) || !Array.isArray(list.body.data)) {
      return sendInternalError(reply, req, new Error(`competitors list answered ${list.status}`), "Failed to read the competitor")
    }
    const brand = (list.body.data as unknown[]).find((b) => isObject(b) && b.id === competitorId)
    if (!brand) return reply.status(404).send({ error: { code: "not_found", message: NOT_YOUR_BRAND } })
    // The plan keeps scans this many months; an older one may linger until the
    // brand's next scan, so the range is held to the plan here.
    const months = typeof list.body.historyMonths === "number" && list.body.historyMonths > 0 ? list.body.historyMonths : 12
    const kept = Date.now() - months * 31 * 24 * 3_600_000
    const range: SocialReadRange = { from: Math.max(asked.from, kept), to: asked.to }

    const { data: job, error: jobErr } = await startJob(req, userId, "competitor-read", parsed.data)
    if (jobErr || !job) return sendInternalError(reply, req, jobErr, "Failed to create job")

    if (range.from >= range.to) return finish(reply, job.id, [], range)
    const history = await pluginGet(app, req, userId, `/v1/competitors/${encodeURIComponent(competitorId)}/history`)
    const points = isObject(history.body) && Array.isArray(history.body.scans) ? (history.body.scans as unknown[]) : null
    if (history.status !== 200 || !points) {
      await markJobFailed(job.id, { error_message: "Failed to read the competitor's scans" })
      return sendInternalError(reply, req, new Error(`competitor history answered ${history.status}`), "Failed to read the competitor's scans")
    }
    const plan = planScans(points.filter((p): p is ScanPoint => isObject(p) && typeof p.id === "string" && typeof p.at === "string"), range)
    try {
      const scans = await readScans(app, req, userId, competitorId, plan.read)
      // An undated post the scan before the period already held was first seen
      // before it — read that scan only when the period's scans hold one.
      const before = plan.before && hasUndatedPosts(scans) ? await readScans(app, req, userId, competitorId, [plan.before]) : []
      const seenBefore = before[0] ? undatedPostIds(before[0]) : new Set<string>()
      const posts = competitorPostsFromScans(scans, { range, role, platform: platformOf(platform), order, limit }, seenBefore)
      return finish(reply, job.id, posts, range)
    } catch (err) {
      if (!(err instanceof ScanReadError)) throw err
      await markJobFailed(job.id, { error_message: "Failed to read the competitor's scans" })
      return sendInternalError(reply, req, err, "Failed to read the competitor's scans")
    }
  })
}

/** The two request schemas, for the orchestrator dispatch test (the body a graph run posts must be one the route accepts). */
export { inspirationBody as inspirationReadBody, competitorBody as competitorReadBody }
