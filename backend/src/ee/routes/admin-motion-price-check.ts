/**
 * The admin Motion price check: every Nodaro Motion run of a date range —
 * what it held, what it took, that in USD, and what its steps cost us — with
 * a run's steps laid out against the quote it was admitted on.
 *
 *   POST /v1/admin/motion-price-check/runs          { from, to, filters…, sort, dir, offset, limit, kieUsd? }
 *   POST /v1/admin/motion-price-check/runs/:jobId   { kieUsd? }
 *   POST /v1/admin/motion-price-check/kie-real      { token, from, to }
 *
 * Every figure is computed in the database, before any paging, by the Motion
 * price check's functions (`admin_motion_run_list`, `admin_motion_runs`,
 * `admin_motion_tree`, `admin_motion_task_ids`), read with the service role.
 * This route holds no price: the USD value of one credit is the platform's
 * `CREDIT_BASE_USD`, always this constant and never the caller's, and KIE's
 * own figures arrive as `kieUsd`, the map the KIE route answered, which the
 * page sends back with each request. All three are POSTs because that map can
 * hold 10,000 tasks.
 *
 * The functions reach the shared database only with the release that ships
 * them, and staging runs ahead of it: until then each route answers 503
 * `motion_price_check_unavailable` with a sentence the page shows, never a
 * 500. Admins only.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { config } from "../../lib/config.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { isMissingFunctionError } from "../../lib/postgrest-errors.js"
import { supabase } from "../../lib/supabase.js"
import { formatZodError } from "../../lib/zod-error.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { kieFailureMessage, kieUsdSchema, motionTaskIdsOf, noMotionTasks, readKieReal } from "../lib/motion-price-check/kie-real.js"
import { LOCAL_ROUTES } from "../lib/motion-price-check/steps.js"
import { listOf, runDetailOf, type MotionSort } from "../lib/motion-price-check/wire.js"

/** The two runs routes carry `kieUsd` (up to 10,000 tasks). */
const RUNS_BODY_LIMIT = 2_097_152
/** The longest range a request reads (the page offers 30 days; one more keeps a daylight-saving change inside it). */
const MAX_RANGE_MS = 31 * 86_400_000
/** The list function's offset is an INT. */
const MAX_OFFSET = 2_147_483_647

const FAILED = "Failed to read the Motion price check"
const UNAVAILABLE = {
  code: "motion_price_check_unavailable",
  message: "Motion price check needs the database update that ships with the next production release.",
} as const

const instant = z.string().datetime({ offset: true })

/** `from` before `to`, at most `MAX_RANGE_MS` apart. */
function inRange(b: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const span = Date.parse(b.to) - Date.parse(b.from)
  if (Number.isNaN(span)) return
  if (span <= 0) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be after from" })
  else if (span > MAX_RANGE_MS) ctx.addIssue({ code: "custom", path: ["to"], message: "A range is at most 31 days" })
}

const SORTS = ["margin_usd", "margin_pct", "paid_usd", "taken", "created_at"] as const satisfies readonly MotionSort[]

const listBody = z
  .object({
    from: instant,
    to: instant,
    engine: z.enum(["prism", "pulse"]).optional(),
    style: z.enum(["precise", "flex"]).optional(),
    kind: z.enum(["trend", "hand"]).optional(),
    resolution: z.string().min(1).max(32).optional(),
    flaggedOnly: z.boolean().optional(),
    sort: z.enum(SORTS).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    offset: z.number().int().min(0).max(MAX_OFFSET).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    kieUsd: kieUsdSchema.optional(),
  })
  .superRefine(inRange)

const detailParams = z.object({ jobId: z.string().uuid() })
const detailBody = z.object({ kieUsd: kieUsdSchema.optional() })

const kieBody = z
  .object({
    // Trimmed before anything uses it: a token pasted with whitespace around it is the token without it.
    token: z.string().trim().min(1).max(4000),
    from: instant,
    to: instant,
  })
  .superRefine(inRange)

function invalid(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

/**
 * A database read that failed: 503 while the functions are not in the
 * database yet, else the generic 500. The 503 is logged once, with its route
 * and the database's own error (never the request's body, so never a token):
 * a call that drifts from a function's signature answers the same "missing
 * function" codes, and this line is how it is told apart.
 */
function readFailed(reply: FastifyReply, req: FastifyRequest, errors: readonly unknown[]): FastifyReply {
  const missing = errors.find(isMissingFunctionError)
  if (missing !== undefined) {
    req.log.warn({ route: req.routeOptions.url, err: missing }, "Motion price check: a database function is missing")
    return reply.status(503).send({ error: UNAVAILABLE })
  }
  return sendInternalError(reply, req, errors[0], FAILED)
}

const rowsOf = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r)) : []

export async function adminMotionPriceCheckRoutes(app: FastifyInstance): Promise<void> {
  // The range's runs, filtered, sorted and paged, with the totals over every filtered run.
  app.post("/v1/admin/motion-price-check/runs", { preHandler: requireAdmin, bodyLimit: RUNS_BODY_LIMIT }, async (req, reply) => {
    const parsed = listBody.safeParse(req.body ?? {})
    if (!parsed.success) return invalid(reply, parsed.error)
    const b = parsed.data
    const sort = b.sort ?? "margin_usd"
    try {
      const { data, error } = await supabase.rpc("admin_motion_run_list", {
        p_from: b.from,
        p_to: b.to,
        p_credit_usd: CREDIT_BASE_USD,
        p_kie_usd: b.kieUsd ?? {},
        p_local_routes: LOCAL_ROUTES,
        p_engine: b.engine ?? null,
        p_style: b.style ?? null,
        p_kind: b.kind ?? null,
        p_resolution: b.resolution ?? null,
        // false is no filter, as the function reads it.
        p_flagged: b.flaggedOnly ?? false,
        p_sort: sort,
        p_dir: b.dir ?? (sort === "margin_usd" || sort === "margin_pct" ? "asc" : "desc"),
        p_offset: b.offset ?? 0,
        p_limit: b.limit ?? 50,
      })
      if (error) return readFailed(reply, req, [error])
      return reply.send({ data: listOf(data, b.kieUsd !== undefined) })
    } catch (err) {
      return sendInternalError(reply, req, err, FAILED)
    }
  })

  // One run, by its id whatever its date: its steps, its quote's lines and what it reused.
  app.post("/v1/admin/motion-price-check/runs/:jobId", { preHandler: requireAdmin, bodyLimit: RUNS_BODY_LIMIT }, async (req, reply) => {
    const params = detailParams.safeParse(req.params)
    if (!params.success) return invalid(reply, params.error)
    const parsed = detailBody.safeParse(req.body ?? {})
    if (!parsed.success) return invalid(reply, parsed.error)
    const { jobId } = params.data
    const kieUsd = parsed.data.kieUsd ?? {}
    try {
      const [runs, tree] = await Promise.all([
        supabase.rpc("admin_motion_runs", {
          p_from: null,
          p_to: null,
          p_run_id: jobId,
          p_credit_usd: CREDIT_BASE_USD,
          p_kie_usd: kieUsd,
          p_local_routes: LOCAL_ROUTES,
        }),
        supabase.rpc("admin_motion_tree", { p_run_ids: [jobId], p_kie_usd: kieUsd, p_local_routes: LOCAL_ROUTES }),
      ])
      const errors = [runs.error, tree.error].filter((e) => e !== null && e !== undefined)
      if (errors.length > 0) return readFailed(reply, req, errors)
      const [run] = rowsOf(runs.data)
      if (!run) return reply.status(404).send({ error: { code: "not_found", message: "Motion run not found" } })
      return reply.send({ data: runDetailOf(run, rowsOf(tree.data)) })
    } catch (err) {
      return sendInternalError(reply, req, err, FAILED)
    }
  })

  // KIE's own figures for the range's Motion tasks, read once per view with the admin's dashboard token.
  // The token is never logged or answered: it goes to KIE and nowhere else.
  app.post("/v1/admin/motion-price-check/kie-real", { preHandler: requireAdmin }, async (req, reply) => {
    if (!config.KIE_UNIQUE_ID) {
      return reply.status(503).send({
        error: { code: "kie_not_configured", message: "KIE real costs need the server's KIE account id (KIE_UNIQUE_ID)." },
      })
    }
    const parsed = kieBody.safeParse(req.body ?? {})
    if (!parsed.success) return invalid(reply, parsed.error)
    const { token, from, to } = parsed.data
    try {
      const { data, error } = await supabase.rpc("admin_motion_task_ids", { p_from: from, p_to: to })
      if (error) return readFailed(reply, req, [error])
      const motionTaskIds = motionTaskIdsOf(data)
      const range = { from: new Date(from), to: new Date(to) }
      if (motionTaskIds.size === 0) return reply.send({ data: noMotionTasks(range) })
      const result = await readKieReal({ token, ...range, motionTaskIds })
      if ("failed" in result) {
        return reply.status(502).send({
          error: { code: "kie_fetch_failed", message: kieFailureMessage(result.failed), details: { errors: result.failed } },
        })
      }
      return reply.send({ data: result })
    } catch (err) {
      return sendInternalError(reply, req, err, FAILED)
    }
  })
}
