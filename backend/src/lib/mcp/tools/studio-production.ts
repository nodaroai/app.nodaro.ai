import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { supabase } from "../../supabase.js"
import { mcpInject } from "../internal-request.js"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { errorResult } from "./_verb-helpers.js"
import { isUuid } from "./_id-guard.js"

/**
 * The studio production family — a film, from a story to a document, over MCP.
 *
 * A production is a Nodaro workflow whose `settings.studio` holds the shots, and
 * these tools reach it through `/v1/studio/productions/*` (never Supabase
 * directly): the ROUTES own the semantics, so an agent, the studio app and the
 * copilot cannot end up with three opinions about one row.
 *
 * Phase 0's six are the read half plus the two ways a production comes into
 * existence. The shape of the loop is the recast family's, because it is the
 * shape that works: read the format, validate for free until it is right, then
 * land it once.
 *
 *   get_studio_production_skill  →  validate_studio_plan  →  create/import
 *   list_studio_productions      →  get_studio_production
 *
 * Nothing here spends a credit. Nothing here deletes a production. Editing,
 * generating, voicing, scoring, exporting and sharing arrive with their own
 * routes and carry their own confirmation classes.
 */

const readGate: ToolGate = { required: ["workflows:read"] }
const writeGate: ToolGate = { required: ["workflows:write"] }

export interface RegisterStudioProductionToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * The one header these routes need beyond what `mcpInject` already sends.
 * The orchestrator secret is deliberately not here: it belongs to every
 * injected request, so it lives in `mcpInject` where nobody can forget it.
 */
function internalHeaders(userId: string): Record<string, string> {
  return { "x-internal-user-id": userId }
}

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  }
}

function markdownResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

/** The `{ data: … }` envelope every studio production route replies with. */
function unwrap<T>(body: string): T {
  return (JSON.parse(body) as { data: T }).data
}

export function registerStudioProductionTools({
  server,
  session,
  fastify,
}: RegisterStudioProductionToolsOpts): void {
  const headers = () => internalHeaders(session.userId)

  // ── the skill (ungated — reading the format costs nothing, and it is the
  //    first thing any author needs) ─────────────────────────────────────────
  server.registerTool(
    "get_studio_production_skill",
    {
      title: "Studio Production Skill",
      description:
        "How to author and operate a Nodaro Studio production — the lane for " +
        '"make me a film/short/ad of X" when the user wants shots they can edit ' +
        "afterwards at studio.nodaro.ai. `part: \"operating\"` (the default) is " +
        "the tool map and the loop; \"authoring\" is the plan format; \"catalog\" " +
        "is every picker, model and enum in full; \"schema\" is the JSON Schema. " +
        "Read it, author the plan, loop `validate_studio_plan` until valid, then " +
        "`create_studio_production`. Free.",
      inputSchema: {
        part: z
          .enum(["operating", "authoring", "catalog", "schema"])
          .optional()
          .describe(
            "operating = the tool map and loop (default); authoring = the plan format; " +
              "catalog = every picker/model/enum; schema = the JSON Schema.",
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await mcpInject(fastify, session, {
        method: "GET",
        url: "/v1/studio/productions/skill",
        headers: headers(),
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const skill = unwrap<{
        skill: string
        catalog: string
        schema: Record<string, unknown>
        operating: string
      }>(res.body)
      const part = args.part ?? "operating"
      if (part === "schema") return textResult(skill.schema)
      if (part === "catalog") return markdownResult(skill.catalog)
      if (part === "authoring") return markdownResult(skill.skill)
      return markdownResult(skill.operating)
    },
  )

  // ── validate (ungated — the loop has to be free, or nobody runs it) ────────
  server.registerTool(
    "validate_studio_plan",
    {
      title: "Validate Studio Plan",
      description:
        "FREE validation of an authored studio production plan (see " +
        "`get_studio_production_skill`). Returns `{ valid, errors, warnings, " +
        "summary }` — each error names the field it is about, and the summary " +
        "says how many `cast` names found a row in the user's own library. Fix " +
        "and call again until `valid: true`. Never charges credits, persists " +
        "nothing.",
      inputSchema: {
        plan: z
          .record(z.string(), z.unknown())
          .describe("The authored `nodaro-studio-production` plan document."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: "/v1/studio/productions/validate",
        headers: headers(),
        payload: { userId: session.userId, plan: args.plan },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      return textResult(unwrap(res.body))
    },
  )

  // ── list (workflows:read) ──────────────────────────────────────────────────
  if (passesGate(session, readGate)) {
    server.registerTool(
      "list_studio_productions",
      {
        title: "List Studio Productions",
        description:
          "The user's studio productions, newest first — id, name, version, " +
          "thumbnail, whether it is shared, and how many shots it has. Archived " +
          "productions are hidden, as they are on the dashboard. Page with " +
          "`cursor` from a prior result's `nextCursor`. Read one with " +
          "`get_studio_production`.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional().describe("Default 25."),
          cursor: z
            .string()
            .optional()
            .describe("`nextCursor` from a prior result — an ISO `updatedAt`."),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const res = await mcpInject(fastify, session, {
          method: "GET",
          url: "/v1/studio/productions",
          headers: headers(),
          query: {
            ...(args.limit !== undefined ? { limit: String(args.limit) } : {}),
            ...(args.cursor ? { cursor: args.cursor } : {}),
          },
        })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        return textResult(unwrap(res.body))
      },
    )

    // ── get ────────────────────────────────────────────────────────────────
    server.registerTool(
      "get_studio_production",
      {
        title: "Get Studio Production",
        description:
          "One production: its film look, cast, folders, cuts, bin, what is " +
          "running right now, and its shots in timeline order. " +
          "`detail: \"summary\"` (the default) is counts plus each shot's " +
          "current image; `detail: \"full\"` adds every past result with the " +
          "context that made it. Pass `shot_id` to read ONE shot rather than " +
          "pulling a whole film to look at one frame. Address a result by its " +
          "`key` (the job id, or the url when no job made it) — never by " +
          "position: the user may be editing while you read.",
        inputSchema: {
          production_id: z.string().uuid().describe("The production's id."),
          detail: z
            .enum(["summary", "full"])
            .optional()
            .describe("summary = counts + active urls (default); full = every result."),
          shot_id: z.string().optional().describe("Narrow to one shot."),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        // No id guard here: `production_id` is `z.string().uuid()`, so the SDK
        // rejects a malformed id before the handler runs. `plan_job_id` below
        // is a free string and DOES need one.
        const res = await mcpInject(fastify, session, {
          method: "GET",
          url: `/v1/studio/productions/${encodeURIComponent(args.production_id)}`,
          headers: headers(),
          query: {
            ...(args.detail ? { detail: args.detail } : {}),
            ...(args.shot_id ? { shot_id: args.shot_id } : {}),
          },
        })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        return textResult(unwrap(res.body))
      },
    )
  }

  // ── create (workflows:write) ───────────────────────────────────────────────
  if (passesGate(session, writeGate)) {
    server.registerTool(
      "create_studio_production",
      {
        title: "Create Studio Production",
        description:
          "Create a studio production in the user's own Studio project — it " +
          "appears on their dashboard at studio.nodaro.ai immediately. With a " +
          "`plan`, every scene, cast binding and film look the document names " +
          "lands with it; without one, an empty production to build up. Free: " +
          "it writes a document, it generates nothing. Validate the plan first.",
        inputSchema: {
          name: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe("Used when the plan names no title of its own."),
          plan: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("A validated `nodaro-studio-production` plan document."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const res = await mcpInject(fastify, session, {
          method: "POST",
          url: "/v1/studio/productions",
          headers: headers(),
          payload: {
            mcp_client: session.clientName,
            userId: session.userId,
            ...(args.name ? { name: args.name } : {}),
            ...(args.plan ? { plan: args.plan } : {}),
          },
        })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        return textResult(unwrap(res.body))
      },
    )

    // ── import into an existing production ─────────────────────────────────
    server.registerTool(
      "import_studio_production",
      {
        title: "Import Into Studio Production",
        description:
          "Add a plan's scenes to a production that already exists — the " +
          "\"Add scenes\" lane. Appending adds shots and enrolls whoever is new " +
          "in the cast; it never renames, re-briefs or re-looks the production. " +
          "Pass a `plan` you have validated, or `plan_job_id` of a FINISHED " +
          "`studio_production` LLM run to land its output. Free.",
        inputSchema: {
          production_id: z.string().uuid().describe("The production to add scenes to."),
          plan: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("A validated plan document. Either this or `plan_job_id`."),
          plan_job_id: z
            .string()
            .optional()
            .describe(
              "A finished `llm-structured` job whose schema is `studio_production`. " +
                "A job that is still running is refused — poll `get_job` first.",
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        let plan: Record<string, unknown>
        if (args.plan) {
          plan = args.plan
        } else if (args.plan_job_id) {
          const fromJob = await planFromJob(session.userId, args.plan_job_id)
          if ("error" in fromJob) {
            return errorResult(fromJob.status, JSON.stringify({ error: fromJob.error }))
          }
          plan = fromJob.plan
        } else {
          return errorResult(
            400,
            JSON.stringify({
              error: {
                code: "plan_required",
                message: "Pass either `plan` or `plan_job_id`.",
              },
            }),
          )
        }

        const res = await mcpInject(fastify, session, {
          method: "POST",
          url: `/v1/studio/productions/${encodeURIComponent(args.production_id)}/import`,
          headers: headers(),
          payload: {
            mcp_client: session.clientName,
            userId: session.userId,
            plan,
            mode: "append",
          },
        })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        return textResult(unwrap(res.body))
      },
    )
  }
}

interface PlanFromJobOk {
  readonly plan: Record<string, unknown>
}
interface PlanFromJobRefusal {
  readonly status: number
  readonly error: { readonly code: string; readonly message: string }
}
type PlanFromJob = PlanFromJobOk | PlanFromJobRefusal

/**
 * A finished Director run's output, as a plan.
 *
 * Three refusals, each a different mistake and each said differently so the
 * model can correct itself rather than retry blindly: a job that is not the
 * caller's (or is not a job at all) is `not_found`; one that has not finished is
 * `not_finished` with its status, so the answer is "poll, then call again";
 * one that finished but is not a studio plan is `not_studio_plan`, so the answer
 * is "you have the wrong job id".
 */
async function planFromJob(userId: string, jobId: string): Promise<PlanFromJob> {
  if (!isUuid(jobId)) {
    return {
      status: 404,
      error: { code: "not_found", message: `Job ${jobId} not found (expected a job UUID)` },
    }
  }
  const { data } = await supabase
    .from("jobs")
    .select("id, status, input_data, output_data")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!data) {
    return { status: 404, error: { code: "not_found", message: `Job ${jobId} not found` } }
  }

  const row = data as unknown as {
    status?: string | null
    input_data?: Record<string, unknown> | null
    output_data?: Record<string, unknown> | null
  }
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
