/**
 * MCP Full Quality verbs — a finished Nodaro Motion (Cast Swap) or trend run
 * made again at 1080p, with the clip's audio, as a new job linked to it: a
 * Nodaro Motion Prism DRAFT's own take re-rendered (`kind: "same-take"`), or a
 * new Nodaro Motion Pulse take
 * from a 720p run's inputs (`kind: "new-take"`). The quote's `kind` words it;
 * an older engine answers none (a same take). The MCP face of the Cloud
 * plugin's routes:
 *
 *   estimate_full_quality  POST /v1/cast-swap/:jobId/full-quality/estimate  workflows:execute
 *   full_quality           POST /v1/cast-swap/:jobId/full-quality           workflows:execute
 *
 * Price confirmation follows `run_trend`: without `confirm`, `full_quality`
 * returns the quote (nothing is created or charged); `confirm: true`, only
 * after the user accepted it, runs, and the job is followed with `get_job` /
 * `wait_for_job` like any other. One Full Quality per draft: a repeat answers
 * the draft's existing job (`existing: true`) and charges nothing. The route
 * keys the job by the draft, so no client idempotency key is sent.
 *
 * Results are rebuilt field by field from the route's answer (never spread).
 * The route is the authority on every rule (a draft or a Nodaro Motion Pulse 720p run,
 * finished, within 7 days).
 * Its one refusal that ends on its own, 409 `full_quality_pending` (an earlier
 * try's 1080p render is being reviewed or has not started), says to try again
 * later; every other refusal is passed back as the route words it.
 *
 * `session_id` travels as `mcpInject`'s `sessionId` option, in the server-side
 * submission scope with the MCP session's grant, never in the body (an
 * internal hop ignores a body `sessionId`). The job funnel checks it as it
 * checks `cast_swap`'s: the caller's own session, and `assets:write` in the
 * grant, else the route's 404 `not_found`.
 *
 * Cloud-only: registered behind `hasCredits()` in server.ts — the routes are
 * the cloud plugin's, and a cloud boot without it answers `not_available`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { neutralBreakdown } from "../../nodaro-motion-quote.js"
import { mcpInject } from "../internal-request.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { registerTask } from "../tasks.js"
import { isRouterNotFound } from "./_studio-helpers.js"
import { errorResult, GET_JOB_POLL_HINT } from "./_verb-helpers.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

const NOT_AVAILABLE = "Nodaro Motion is a Nodaro Cloud feature and is not served on this deployment."

export interface RegisterCastSwapFullQualityToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

type FullQualityKind = "same-take" | "new-take"

interface FullQualityQuote {
  /** Absent from an older engine (then a same take). */
  kind?: FullQualityKind
  totalCredits: number
  /** `base` (the Full Quality job's own steps), and the engine's other parts by their neutral names (`motionHd`: the 1080p render, 0 when reused). */
  breakdown: { base: number; motionHd?: number } & Record<string, number>
  availableUntil: string
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** `{ data }` unwrapped, or null when the body is not JSON. */
function dataOf(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as unknown
    return isRec(parsed) && "data" in parsed ? parsed.data : parsed
  } catch {
    return null
  }
}

function quoteOf(body: string): FullQualityQuote | null {
  const q = dataOf(body)
  if (!isRec(q) || !finite(q.totalCredits) || !isRec(q.breakdown) || typeof q.availableUntil !== "string") return null
  // Only the breakdown's own numeric parts, by their neutral names (an engine before 0.395.0
  // also, or only, sends the old ones; before 0.397.0 `castSwap` for `base`); a new engine's
  // other part names pass through.
  const breakdown = neutralBreakdown(q.breakdown) as FullQualityQuote["breakdown"]
  if (!finite(breakdown.base)) return null
  const kind = q.kind === "same-take" || q.kind === "new-take" ? q.kind : undefined
  return { ...(kind ? { kind } : {}), totalCredits: q.totalCredits, breakdown, availableUntil: q.availableUntil }
}

function quoteSentence(q: FullQualityQuote): string {
  if (q.kind === "new-take") {
    return (
      `Full Quality makes a NEW take of this run at 1080p from the same inputs (it will not match the 720p run frame for frame; the 720p run stays), ` +
      `for about ${q.totalCredits} credits. Available until ${q.availableUntil}.`
    )
  }
  const reused = q.breakdown.motionHd === 0 ? " An earlier try's 1080p render is reused, so only the finishing is charged." : ""
  return `Finishing this draft at Full Quality (the same take at 1080p) costs about ${q.totalCredits} credits.${reused} Available until ${q.availableUntil}.`
}

const failure = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const })

const PENDING_HINT = "This is not final: try again later."

/** The route's error code, when its body carries one. */
function errorCodeOf(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown
    const code = isRec(parsed) && isRec(parsed.error) ? parsed.error.code : undefined
    return typeof code === "string" ? code : undefined
  } catch {
    return undefined
  }
}

/**
 * A route refusal as a tool error; only a router 404 (no error code) is
 * `not_available`, and `full_quality_pending` (it ends on its own) says to try
 * again later.
 */
function refusal(statusCode: number, body: string) {
  if (isRouterNotFound(statusCode, body)) {
    return errorResult(404, JSON.stringify({ error: { code: "not_available", message: NOT_AVAILABLE } }))
  }
  const result = errorResult(statusCode, body)
  if (errorCodeOf(body) !== "full_quality_pending") return result
  return { ...result, content: [{ type: "text" as const, text: `${result.content[0]!.text} ${PENDING_HINT}` }] }
}

/** A job id: anything else (a slash, a dot segment) is refused before a request is made. */
const JOB_ID_RE = /^[A-Za-z0-9-]{1,64}$/
const JOB_ID_HINT = "The finished run's job id: a cast_swap or trend run made as a draft, or one made on motion-pulse at 720p."
const fullQualityUrl = (id: string) => `/v1/cast-swap/${encodeURIComponent(id)}/full-quality`

export function registerCastSwapFullQualityTools({ server, session, fastify }: RegisterCastSwapFullQualityToolsOpts): void {
  if (!passesGate(session, executeGate)) return

  async function quote(id: string) {
    const res = await mcpInject(fastify, session, { method: "POST", url: `${fullQualityUrl(id)}/estimate`, payload: {} })
    if (res.statusCode >= 400) return { error: refusal(res.statusCode, res.body) }
    const q = quoteOf(res.body)
    return q ? { quote: q } : { error: failure("The Full Quality quote could not be read.") }
  }

  server.registerTool(
    "estimate_full_quality",
    {
      title: "Estimate Full Quality",
      description:
        "Quote finishing a Nodaro Motion (cast_swap) or trend run at Full Quality (free; nothing starts): a DRAFT's same take re-rendered at 1080p, " +
        'or, for a motion-pulse run at 720p, a new take at 1080p (the quote\'s kind: "same-take" or "new-take"). ' +
        "Within 7 days of the run finishing. If its Full Quality already exists, full_quality returns it free.",
      inputSchema: {
        job_id: z.string().regex(JOB_ID_RE).describe(JOB_ID_HINT),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const q = await quote(args.job_id)
      if (q.error) return q.error
      return {
        content: [{ type: "text" as const, text: `${quoteSentence(q.quote)} Nothing was charged; full_quality starts it.` }],
        structuredContent: { ...q.quote },
      }
    },
  )

  server.registerTool(
    "full_quality",
    {
      title: "Full Quality",
      description:
        "Finish a Nodaro Motion (cast_swap) or trend run at Full Quality, at 1080p with the clip's audio, as a new job: a DRAFT's same take re-rendered, " +
        "or a new take of a motion-pulse 720p run (the quote says which). " +
        "Without `confirm` it returns the PRICE QUOTE only (nothing is charged): show the credits to the user, and call again with `confirm: true` only once they accept. " +
        "That returns a job id (the existing one, free, if this run's Full Quality already exists): poll it with wait_for_job.",
      inputSchema: {
        job_id: z.string().regex(JOB_ID_RE).describe(JOB_ID_HINT),
        session_id: z.string().min(1).optional().describe("A generation session to file the result in."),
        confirm: z.boolean().optional().describe("true ONLY after the user accepted the quoted credits in this conversation."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      if (args.confirm !== true) {
        const q = await quote(args.job_id)
        if (q.error) return q.error
        return {
          content: [
            {
              type: "text" as const,
              text:
                `${quoteSentence(q.quote)} If this run already has a Full Quality job running or done, confirming returns it at no charge. ` +
                "Present this to the user; call full_quality again with confirm: true once they accept.",
            },
          ],
          structuredContent: { ...q.quote, confirmed: false },
        }
      }

      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: fullQualityUrl(args.job_id),
        payload: {},
        // The session reaches the job through the server-side scope (the
        // route ignores a relayed body's `sessionId`).
        ...(args.session_id !== undefined ? { sessionId: args.session_id } : {}),
      })
      if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
      const data = dataOf(res.body)
      const id = isRec(data) && typeof data.jobId === "string" ? data.jobId : undefined
      if (!id) return failure("Full Quality was submitted, but its job id could not be read.")
      const existing = isRec(data) && data.existing === true
      registerTask({ taskId: id, userId: session.userId, kind: "video" })
      const lead = existing
        ? `This run's Full Quality already exists (job ${id}); nothing new was started or charged.`
        : `Full Quality started (job ${id}).`
      return {
        content: [{ type: "text" as const, text: `${lead} To follow it, ${GET_JOB_POLL_HINT}.` }],
        structuredContent: { jobId: id, existing, confirmed: true },
      }
    },
  )
}
