import type { FastifyInstance } from "fastify"

import { mcpInject, type McpInjectOptions } from "../internal-request.js"
import type { McpSession } from "../session.js"
import { errorResult } from "./_verb-helpers.js"
import { isUuid } from "./_id-guard.js"

/**
 * The plumbing the studio production family shares.
 *
 * Every tool in that family is a dispatcher: it injects a request into
 * `/v1/studio/productions/*` with the caller's identity, and hands back what
 * came out. The routes own the semantics — the owner check, the projection, the
 * compare-and-swap, the pricing — so an agent, the studio app and the copilot
 * cannot end up with three opinions about one row. What lives here is only the
 * part every tool repeats: how the request is addressed, how a reply is
 * rendered, and how a refusal is passed on without being re-worded.
 *
 * The routes are served by the Nodaro Cloud plugin. On a deployment that does
 * not install it they are not registered at all, so the router answers its own
 * 404 — which is why `studioError` exists rather than a probe at registration.
 */

/**
 * The family's tool names, in registration order.
 *
 * ONE list: a test pins the registered surface to it, the operating-guide
 * drift check reads it, and the docs rows are written against it. A
 * hand-typed name in a second place is exactly the drift this
 * removes.
 */
export const STUDIO_PRODUCTION_TOOL_NAMES = [
  "get_studio_production_skill",
  "validate_studio_plan",
  "list_studio_productions",
  "get_studio_production",
  "plan_studio_export",
  "create_studio_production",
  "import_studio_production",
  "edit_studio_production",
  "share_studio_production",
  "clone_studio_production",
  "describe_studio_production",
  "generate_studio_still",
  "generate_studio_keyframe",
  "generate_studio_clip",
  "new_studio_shot_from_frame",
  "voice_studio_shot",
  "revoice_studio_clip",
  "score_studio_production",
] as const

export type StudioProductionToolName = (typeof STUDIO_PRODUCTION_TOOL_NAMES)[number]

/**
 * The confirmation class a tool carries on its definition, in the vocabulary
 * the operating guide uses: `$` spends credits, `P` changes who can reach the
 * work. A tool with neither changes only the caller's own document.
 *
 * `edit_studio_production` deliberately carries none: its operations are
 * opaque to this layer (the route validates them), so a batch cannot be
 * classified here without a second copy of the vocabulary that would drift.
 */
export type StudioConfirmClass = "$" | "P"

/** The `_meta` block that stamps a tool's confirmation class. */
export function confirmMeta(confirm: StudioConfirmClass): { nodaro: { confirm: StudioConfirmClass } } {
  return { nodaro: { confirm } }
}

/**
 * The one header these routes need beyond what `mcpInject` already sends.
 * The orchestrator secret is deliberately not here: it belongs to every
 * injected request, so it lives in `mcpInject` where nobody can forget it.
 */
export function internalHeaders(userId: string): Record<string, string> {
  return { "x-internal-user-id": userId }
}

/** Inject into a studio production route as the calling MCP user. */
export function studioInject(
  fastify: FastifyInstance,
  session: McpSession,
  opts: Omit<McpInjectOptions, "headers">,
) {
  return mcpInject(fastify, session, { ...opts, headers: internalHeaders(session.userId) })
}

/**
 * The body every POST in this family carries, plus whatever the tool adds.
 *
 * `mcp_client` is the provenance stamp — it is what makes a job started from a
 * chat distinguishable from one the user started in the app — and `userId` is
 * the same identity the header carries, sent the way every other MCP write
 * sends it.
 */
export function studioPayload(
  session: McpSession,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { mcp_client: session.clientName, userId: session.userId, ...extra }
}

/** The `{ data: … }` envelope every studio production route replies with. */
export function unwrap<T>(body: string): T {
  return (JSON.parse(body) as { data: T }).data
}

export function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  }
}

export function markdownResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

/** A route's `{ data: … }` reply, rendered as a tool result. */
export function viewResult(body: string) {
  return textResult(unwrap(body))
}

/** The family's own `{ error: { code } }`, when the body carries one. */
function familyErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } }
    const code = parsed?.error?.code
    return typeof code === "string" ? code : null
  } catch {
    return null
  }
}

/**
 * Is this refusal the ROUTER's rather than the family's?
 *
 * A 404 whose body carries no `error.code` is Fastify's own unmatched-route
 * answer: the route is not registered on this deployment at all. The family's
 * own 404 — "that production does not exist" — always names a code, and the
 * two mean opposite things, so no caller may treat them alike.
 */
export function isRouterNotFound(statusCode: number, body: string): boolean {
  return statusCode === 404 && familyErrorCode(body) === null
}

/**
 * Is this refusal "somebody else is writing this row right now"?
 *
 * The routes apply a write by compare-and-swap and, when they keep losing the
 * swap, answer `409 production_busy` — a transient "read it again and retry",
 * not a fault. It is selected by SHAPE, the way a router 404 is, because the
 * status alone does not say it: a caller who must distinguish "the write did
 * not land because the document moved" from "the write was wrong" reads the
 * code, never the number.
 */
export function isProductionBusy(statusCode: number, body: string): boolean {
  return statusCode === 409 && familyErrorCode(body) === "production_busy"
}

/** The zero-based index of the refused operation, when the route named one. */
function opIndexOf(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { error?: { opIndex?: unknown } }
    const index = parsed?.error?.opIndex
    return typeof index === "number" ? index : null
  } catch {
    return null
  }
}

/**
 * A route refusal, as a tool error.
 *
 * Three cases, and the two special ones are why this exists rather than a bare
 * `errorResult`:
 *
 *  - **A router 404** — a body with no `error.code` — means the family is not
 *    served on this deployment at all. Rendered generically it reads as
 *    "invalid request", which sends a model round a repair loop for a document
 *    that was never the problem. It becomes `not_available` instead.
 *  - **A refused batch** carries `opIndex`: a batch is atomic, so the caller
 *    needs "operation 3, and why" rather than "somewhere in there". The generic
 *    renderer reads only `code` and `message`, so the index would be dropped
 *    exactly where it is the whole answer.
 *
 * Everything else — every other 4xx, and every 5xx, whose bodies can carry
 * internal detail — goes through the shared renderer untouched.
 */
export function studioError(statusCode: number, body: string) {
  if (isRouterNotFound(statusCode, body)) {
    return errorResult(
      404,
      JSON.stringify({
        error: {
          code: "not_available",
          message:
            "Studio productions are a Nodaro Cloud feature and are not served on this deployment.",
        },
      }),
    )
  }
  const opIndex = statusCode >= 400 && statusCode < 500 ? opIndexOf(body) : null
  if (opIndex === null) return errorResult(statusCode, body)
  const generic = errorResult(statusCode, body)
  return {
    ...generic,
    content: [
      {
        type: "text" as const,
        text: `${generic.content[0].text} (operation ${opIndex}; the batch is atomic, so nothing was written)`,
      },
    ],
  }
}

interface PlanFromJobOk {
  readonly plan: Record<string, unknown>
}
interface PlanFromJobRefusal {
  readonly status: number
  readonly error: { readonly code: string; readonly message: string }
}
export type PlanFromJob = PlanFromJobOk | PlanFromJobRefusal

/** A route's own `{ error: { code, message } }`, when it sent one. */
function routeError(body: string): PlanFromJobRefusal["error"] | null {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }
    const code = parsed.error?.code
    const message = parsed.error?.message
    if (typeof code === "string" && typeof message === "string") return { code, message }
  } catch {
    // Not JSON — the route said nothing this reader can pass on.
  }
  return null
}

/**
 * A finished Director run's output, as a plan.
 *
 * The ROW comes from `GET /v1/jobs/:id` (a tool asks a route), so the read is
 * already the caller's own and already carries the outward projection every
 * other job reader sees. What is left is the reading, and its refusals: each a
 * different mistake, each said differently so the model can correct itself
 * rather than retry blindly. A job that is not the caller's (or is not a job at
 * all) is `not_found`; one that has not finished is `not_finished` with its
 * status, so the answer is "poll, then call again"; one that finished but is
 * not a studio plan is `not_studio_plan`, so the answer is "you have the wrong
 * job id"; one that finished with nothing is `no_output`, so the answer is
 * "start a new run".
 */
export async function planFromJob(
  fastify: FastifyInstance,
  session: McpSession,
  jobId: string,
): Promise<PlanFromJob> {
  if (!isUuid(jobId)) {
    return {
      status: 404,
      error: { code: "not_found", message: `Job ${jobId} not found (expected a job UUID)` },
    }
  }
  const res = await studioInject(fastify, session, {
    method: "GET",
    url: `/v1/jobs/${encodeURIComponent(jobId)}`,
  })
  if (res.statusCode === 404) {
    // "Not yours" and "does not exist" are the same answer, and it names the id
    // the model passed so it can tell WHICH of several ids it got wrong.
    return { status: 404, error: { code: "not_found", message: `Job ${jobId} not found` } }
  }
  if (res.statusCode >= 400) {
    // Anything else is the route's to explain, not this reader's to rephrase.
    return {
      status: res.statusCode,
      error: routeError(res.body) ?? {
        code: "job_read_failed",
        message: `Could not read job ${jobId}.`,
      },
    }
  }

  const row = unwrap<{
    status?: string | null
    input_data?: Record<string, unknown> | null
    output_data?: Record<string, unknown> | null
  }>(res.body)
  if (row.status !== "completed") {
    return {
      status: 409,
      error: {
        code: "not_finished",
        message:
          `Job ${jobId} is ${row.status ?? "pending"}. Poll \`get_job\` until it is ` +
          `completed, then call this again.`,
      },
    }
  }
  // `input_data.type` — NOT the `job_type` column. `buildJobInputData` stamps
  // the type into the projection at INSERT, whereas `job_type` is written by
  // the queue worker at pickup; `GET /v1/jobs` filters `input_data->>type` for
  // exactly that reason, and the studio client narrows a run the same way
  // (`schemaName`, which rides through from the request body). Reading the
  // column here refused every genuine Director run.
  const jobType = row.input_data?.type
  const schemaName = row.input_data?.schemaName
  if (jobType !== "llm-structured" || schemaName !== "studio_production") {
    return {
      status: 400,
      error: {
        code: "not_studio_plan",
        message:
          `Job ${jobId} is not a studio production run (` +
          `${typeof jobType === "string" ? jobType : "unknown"}${
            typeof schemaName === "string" ? `/${schemaName}` : ""
          }). Use the job id of an \`llm-structured\` run whose schema is ` +
          `\`studio_production\`.`,
      },
    }
  }
  // The completion write is an ENVELOPE — `{ output, inputTokens, outputTokens }`
  // (workers/handlers/llm-structured.ts) — so the plan is `output_data.output`
  // and nothing else. Falling back to the envelope itself would land the token
  // counts as if they were a production.
  const plan = row.output_data?.output
  if (!plan || typeof plan !== "object") {
    // NOT `not_finished`: this row is terminal, so "poll and call again" would
    // send the model round a loop that can never end. The run finished and
    // produced nothing — the only way forward is a new draft.
    return {
      status: 422,
      error: {
        code: "no_output",
        message:
          `Job ${jobId} finished without a plan. Start a new Director run — ` +
          `polling this one will not produce anything.`,
      },
    }
  }
  return { plan: plan as Record<string, unknown> }
}
