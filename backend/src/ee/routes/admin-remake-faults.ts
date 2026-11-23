/**
 * The admin Remake faults list: every Video Remake run of a range that
 * recorded a fault (the server-only `output_data.__castSwapFaults`), newest
 * first, with its faults worst first.
 *
 *   GET /v1/admin/remake-faults?from&to&severity&kind&engine&offset&limit
 *
 * Replies `{ data: { total, kinds, runs } }`: the runs matching every filter
 * (before paging), the distinct fault kinds of the range's runs (the engine
 * filter applied, not the severity or kind one: the page's kind picker), and
 * the page. Everything is read in the database, from the faulted rows alone
 * (a partial index), by migration 694's `admin_remake_fault_list`, with the
 * service role.
 *
 * The faults are a `__` key, which every job read strips for every caller
 * (`withoutServerOnlyKeys`); this route never returns a job row, only its own
 * shape, so they arrive here under `faults` and nowhere else.
 *
 * The function reaches the shared database only with the release that ships
 * it, and staging runs ahead of it: until then the route answers 503
 * `remake_faults_unavailable` with a sentence the page shows, never a 500.
 * Admins only.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { sendInternalError } from "../../lib/http-errors.js"
import { isMissingFunctionError } from "../../lib/postgrest-errors.js"
import { supabase } from "../../lib/supabase.js"
import { formatZodError } from "../../lib/zod-error.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { REMAKE_FAULT_SEVERITIES, readRemakeFaults, severityOf, type RemakeFault, type RemakeFaultSeverity } from "../lib/remake-faults.js"

/** The list function's offset is an INT. */
const MAX_OFFSET = 2_147_483_647

const FAILED = "Failed to read the Video Remake faults"
const UNAVAILABLE = {
  code: "remake_faults_unavailable",
  message: "Video Remake faults need the database update that ships with the next production release.",
} as const

const instant = z.string().datetime({ offset: true })

/** The widest range the list reads (migration 694 refuses wider). */
const MAX_RANGE_MS = 31 * 24 * 3_600_000

export const remakeFaultsQuery = z
  .object({
    from: instant,
    to: instant,
    severity: z.enum(REMAKE_FAULT_SEVERITIES).optional(),
    kind: z.string().trim().min(1).max(120).optional(),
    engine: z.enum(["prism", "pulse"]).optional(),
    offset: z.coerce.number().int().min(0).max(MAX_OFFSET).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .superRefine((q, ctx) => {
    if (Date.parse(q.to) <= Date.parse(q.from)) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be after from" })
    // The list reads every Remake run of the range (migration 694 has no index of its own): at most 31 days.
    else if (Date.parse(q.to) - Date.parse(q.from) > MAX_RANGE_MS) ctx.addIssue({ code: "custom", path: ["to"], message: "the range may span at most 31 days" })
  })

/** One faulted run, as the page reads it. */
export interface RemakeFaultRun {
  id: string
  createdAt: string
  userId: string
  email: string | null
  jobType: string | null
  status: string
  fullQuality: boolean
  engine: "prism" | "pulse"
  resolution: string | null
  draft: boolean
  worst: RemakeFaultSeverity
  faults: RemakeFault[]
}

export interface RemakeFaultList {
  total: number
  kinds: string[]
  runs: RemakeFaultRun[]
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** One row of the function's page, in the wire's names; null for a row with no id (never expected). */
function runOf(row: Rec): RemakeFaultRun | null {
  const id = str(row.id)
  if (id === null) return null
  const faults = readRemakeFaults(row.faults)
  return {
    id,
    createdAt: str(row.created_at) ?? "",
    userId: str(row.user_id) ?? "",
    email: str(row.email),
    jobType: str(row.job_type),
    status: str(row.status) ?? "",
    fullQuality: row.full_quality === true,
    engine: row.engine === "pulse" ? "pulse" : "prism",
    resolution: str(row.resolution),
    draft: row.draft === true,
    worst: faults[0]?.severity ?? severityOf(row.worst),
    faults,
  }
}

/** The function's answer, in the wire's names; tolerant of any shape (an empty list). */
export function remakeFaultListOf(data: unknown): RemakeFaultList {
  const d = isRec(data) ? data : {}
  const total = typeof d.total === "number" && Number.isFinite(d.total) ? d.total : 0
  const kinds = Array.isArray(d.kinds) ? d.kinds.filter((k): k is string => typeof k === "string") : []
  const runs = Array.isArray(d.rows)
    ? d.rows.flatMap((r) => {
      const run = isRec(r) ? runOf(r) : null
      return run === null ? [] : [run]
    })
    : []
  return { total, kinds, runs }
}

/**
 * A database read that failed: 503 while the function is not in the database
 * yet (logged once, with the database's own error), else the generic 500.
 */
function readFailed(reply: FastifyReply, req: FastifyRequest, error: unknown): FastifyReply {
  if (isMissingFunctionError(error)) {
    req.log.warn({ route: req.routeOptions.url, err: error }, "Remake faults: the database function is missing")
    return reply.status(503).send({ error: UNAVAILABLE })
  }
  return sendInternalError(reply, req, error, FAILED)
}

export async function adminRemakeFaultsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/remake-faults", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = remakeFaultsQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const q = parsed.data
    try {
      const { data, error } = await supabase.rpc("admin_remake_fault_list", {
        p_from: q.from,
        p_to: q.to,
        p_severity: q.severity ?? null,
        p_kind: q.kind ?? null,
        p_engine: q.engine ?? null,
        p_offset: q.offset ?? 0,
        p_limit: q.limit ?? 50,
      })
      if (error) return readFailed(reply, req, error)
      return reply.send({ data: remakeFaultListOf(data) })
    } catch (err) {
      return sendInternalError(reply, req, err, FAILED)
    }
  })
}
