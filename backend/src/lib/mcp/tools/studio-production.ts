import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import {
  confirmMeta,
  isProductionBusy,
  isRouterNotFound,
  planFromJob,
  studioError,
  studioInject,
  studioPayload,
  markdownResult,
  textResult,
  unwrap,
  viewResult,
} from "./_studio-helpers.js"
import { registerStudioProductionRunTools } from "./studio-production-run.js"

/**
 * The studio production family — a film, from a story to a document, over MCP.
 *
 * A production is a Nodaro workflow whose `settings.studio` holds the shots,
 * and every read and write of one goes through `/v1/studio/productions/*`: the
 * ROUTES own the semantics, so an agent, the studio app and the copilot cannot
 * end up with three opinions about one row. Nothing here reads Supabase — not
 * even the one read that touches no production. `planFromJob` recovers a
 * finished Director run's plan through `GET /v1/jobs/:id`, the same route
 * `get_job` answers from, so the ownership filter and the outward projection
 * are the platform's rather than this file's.
 *
 * The loop the family is shaped around, and the order the operating guide
 * teaches it in:
 *
 *   get_studio_production_skill → validate_studio_plan → create / import
 *   list_studio_productions → get_studio_production → edit_studio_production
 *   generate_* → get_studio_production → plan_studio_export → share / clone
 *
 * This module carries the free, read and document-write halves;
 * `studio-production-run.ts` carries those that spend credits. A test pins
 * the registered names of both to `STUDIO_PRODUCTION_TOOL_NAMES`, the family's
 * one list.
 *
 * The routes are served by the Nodaro Cloud plugin, so the family is
 * registered under the edition gate rather than probed for: on a deployment
 * that does not install it, every tool answers `not_available`.
 */

const readGate: ToolGate = { required: ["workflows:read"] }
const writeGate: ToolGate = { required: ["workflows:write"] }

export interface RegisterStudioProductionToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Does this answer carry the mark of a preview?
 *
 * The literal is the whole proof: a service that previewed says so in the
 * answer, and one that merely ignored the flag cannot. Read off the unwrapped
 * body rather than the status, because both paths answer 200.
 */
function isPreview(body: string): boolean {
  try {
    return (unwrap<{ dryRun?: unknown }>(body) as { dryRun?: unknown })?.dryRun === true
  } catch {
    return false
  }
}

export function registerStudioProductionTools(opts: RegisterStudioProductionToolsOpts): void {
  const { server, session, fastify } = opts

  // ── the skill (ungated — reading the format costs nothing, and it is the
  //    first thing any author needs) ─────────────────────────────────────────
  server.registerTool(
    "get_studio_production_skill",
    {
      title: "Studio Production Skill",
      description:
        "How to author and operate a Nodaro Studio production — the lane for " +
        '"make me a film/short/ad of X" when the user wants shots they can edit ' +
        'afterwards at studio.nodaro.ai. `part: "operating"` (the default) is ' +
        'the tool map, the loop and the edit vocabulary; "authoring" is the plan ' +
        'format; "catalog" is every picker, model and enum in full; "schema" is ' +
        "the JSON Schema. Read it, author the plan, loop `validate_studio_plan` " +
        "until valid, then `create_studio_production`. Free.",
      inputSchema: {
        part: z
          .enum(["operating", "authoring", "catalog", "schema"])
          .optional()
          .describe(
            "operating = the tool map, loop and edit vocabulary (default); " +
              "authoring = the plan format; catalog = every picker/model/enum; " +
              "schema = the JSON Schema.",
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await studioInject(fastify, session, {
        method: "GET",
        url: "/v1/studio/productions/skill",
      })
      if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
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

  // ── the workflows:read half: validate, list, get, plan an export ───────────
  if (passesGate(session, readGate)) {
    // ── validate: free, but `workflows:read`, exactly as its route is.
    //    Validating resolves every `cast` name against the caller's own
    //    characters, locations, objects and creatures, so an ungated tool
    //    would be a name-existence oracle over four entity tables that the
    //    route itself refuses. Registering it where the route is means a
    //    session that cannot use it never sees it. ─────────────────────────
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
        const res = await studioInject(fastify, session, {
          method: "POST",
          url: "/v1/studio/productions/validate",
          payload: studioPayload(session, { plan: args.plan }),
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )

    // ── list ───────────────────────────────────────────────────────────────
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
            .describe("`nextCursor` from a prior result — an opaque page token."),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const res = await studioInject(fastify, session, {
          method: "GET",
          url: "/v1/studio/productions",
          query: {
            ...(args.limit !== undefined ? { limit: String(args.limit) } : {}),
            ...(args.cursor ? { cursor: args.cursor } : {}),
          },
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
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
          '`detail: "summary"` (the default) is counts plus each shot\'s ' +
          'current image; `detail: "full"` adds every past result with the ' +
          "context that made it. Pass `shot_id` to read ONE shot rather than " +
          "pulling a whole film to look at one frame. Address a result by its " +
          "`key` (the job id, or the url when no job made it) — never by " +
          "position: the user may be editing while you read. With " +
          "`workflows:write`, reading also lands whatever has finished since " +
          "the last read, so a generation you started shows up here.",
        inputSchema: {
          production_id: z.string().uuid().describe("The production's id."),
          detail: z
            .enum(["summary", "full"])
            .optional()
            .describe("summary = counts + active urls (default); full = every result."),
          shot_id: z.string().optional().describe("Narrow to one shot."),
          reconcile: z
            .boolean()
            .optional()
            .describe(
              "false: read without landing finished jobs \u2014 for an in-app " +
                "editor that lands its own. Default true.",
            ),
        },
        // NOT `readOnlyHint: true`, even though this is the read of the loop:
        // with write scope the call below lands finished work into the
        // caller's own document before reading it, and a hint that says
        // otherwise is one a host may auto-approve on.
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        // No id guard here: `production_id` is `z.string().uuid()`, so the SDK
        // rejects a malformed id before the handler runs. `plan_job_id` below
        // is a free string and DOES need one.
        const id = encodeURIComponent(args.production_id)

        // Land what has finished, THEN read. Over MCP there is no browser to
        // bring a completed generation into the document, so a pure read would
        // show a caller "still rendering" forever while the media sat finished
        // — and this is the only tool in the loop placed to do it.
        //
        // The landing call is a WRITE, so it is made only by a session that was
        // granted one. The gate is checked HERE rather than left to the route:
        // an injected request carries the caller's identity but not their
        // grant, so the route cannot see the scopes and would apply the write
        // for a read-only client. Reading stays available to everyone — the
        // tool is registered at `workflows:read` and a session without
        // `workflows:write` simply goes straight to the GET.
        //
        // Whatever IS attempted is opportunistic: the route's own `403` (a
        // viewer reading a production shared with them, who may read it but not
        // edit it), a router `404` (this deployment does not serve the landing
        // route), and `409 production_busy` (a concurrent writer — the studio
        // editor's own autosave will do it) each leave a read the GET can serve
        // perfectly well. Anything else IS reported: reading past it would hand
        // back a view that silently omits work which had in fact finished.
        // `reconcile: false` is the in-app editor's read: that editor is open
        // and lands everything it started, so a second lander here would land
        // the same finished work again under its own reading of it. Default
        // true \u2014 every client that does not say otherwise gets today's
        // behaviour.
        if (args.reconcile !== false && passesGate(session, writeGate)) {
          const landed = await studioInject(fastify, session, {
            method: "POST",
            url: `/v1/studio/productions/${id}/reconcile`,
            payload: studioPayload(session),
          })
          if (
            landed.statusCode >= 400 &&
            landed.statusCode !== 403 &&
            !isRouterNotFound(landed.statusCode, landed.body) &&
            !isProductionBusy(landed.statusCode, landed.body)
          ) {
            return studioError(landed.statusCode, landed.body)
          }
        }

        // The view handed back is this GET's, taken after the landing call.
        const res = await studioInject(fastify, session, {
          method: "GET",
          url: `/v1/studio/productions/${id}`,
          query: {
            ...(args.detail ? { detail: args.detail } : {}),
            ...(args.shot_id ? { shot_id: args.shot_id } : {}),
          },
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )

    // ── plan an export: pure, priced, runs nothing ─────────────────────────
    server.registerTool(
      "plan_studio_export",
      {
        title: "Plan Studio Export",
        description:
          "What exporting this production would run, and what it would cost — " +
          "the ordered steps and a credit estimate. Nothing is started and " +
          "nothing is charged: this is the quote to show the user before they " +
          "accept. `upscale: true` adds the 4K pass, which is expensive and is " +
          "therefore never assumed.",
        inputSchema: {
          production_id: z.string().uuid().describe("The production to plan an export for."),
          upscale: z.boolean().optional().describe("Include the 4K pass. Default false."),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const res = await studioInject(fastify, session, {
          method: "GET",
          url: `/v1/studio/productions/${encodeURIComponent(args.production_id)}/export-plan`,
          ...(args.upscale ? { query: { upscale: "true" } } : {}),
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )
  }

  // ── the workflows:write half: create, import, edit, share, clone ───────────
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
        const res = await studioInject(fastify, session, {
          method: "POST",
          url: "/v1/studio/productions",
          payload: studioPayload(session, {
            ...(args.name ? { name: args.name } : {}),
            ...(args.plan ? { plan: args.plan } : {}),
          }),
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )

    // ── import into an existing production ─────────────────────────────────
    server.registerTool(
      "import_studio_production",
      {
        title: "Import Into Studio Production",
        description:
          'Add a plan\'s scenes to a production that already exists — the ' +
          '"Add scenes" lane. Appending adds shots and enrolls whoever is new ' +
          "in the cast; it never renames, re-briefs or re-looks the production. " +
          "Pass a `plan` you have validated, or `plan_job_id` of a FINISHED " +
          "`studio_production` LLM run to land its output. Free. If the user " +
          "has this production OPEN in the studio editor, that tab saves its " +
          "own copy a moment after any edit and will overwrite what you add — " +
          "ask them to reload the editor before you import and again after.",
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
          const fromJob = await planFromJob(fastify, session, args.plan_job_id)
          if ("error" in fromJob) {
            return studioError(fromJob.status, JSON.stringify({ error: fromJob.error }))
          }
          plan = fromJob.plan
        } else {
          return studioError(
            400,
            JSON.stringify({
              error: {
                code: "plan_required",
                message: "Pass either `plan` or `plan_job_id`.",
              },
            }),
          )
        }

        const res = await studioInject(fastify, session, {
          method: "POST",
          url: `/v1/studio/productions/${encodeURIComponent(args.production_id)}/import`,
          payload: studioPayload(session, { plan, mode: "append" }),
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )

    // ── edit: the semantic write ───────────────────────────────────────────
    server.registerTool(
      "edit_studio_production",
      {
        title: "Edit Studio Production",
        description:
          "Change a production by sending a BATCH of operations — rename a " +
          "shot, reorder the timeline, select a take, enroll a cast member, " +
          "empty the bin. The operation vocabulary and every argument shape " +
          'live in `get_studio_production_skill` (`part: "operating"`); read it ' +
          "before composing a batch. Applied atomically under a " +
          "compare-and-swap: if one operation is refused the answer names its " +
          "index and NOTHING is written, and a batch composed against a " +
          "slightly older version still applies (`rebased: true` says it did). " +
          "Pass `expected_version` with `strict: true` only when you mean " +
          '"replace exactly what I read". Free — editing the document spends ' +
          "nothing.",
        inputSchema: {
          production_id: z.string().uuid().describe("The production to change."),
          ops: z
            // Opaque on purpose: the operation vocabulary is the server's, and a
            // second copy of it here would drift the first time an operation
            // gains an argument. The route validates the batch and refuses with
            // the offending operation's index.
            .array(z.record(z.string(), z.unknown()))
            .min(1)
            .max(100)
            .describe(
              "1–100 operations, applied in order. See the operating skill for " +
                "the vocabulary.",
            ),
          expected_version: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("The `version` you composed this batch against."),
          strict: z
            .boolean()
            .optional()
            .describe(
              "Refuse with a conflict instead of rebasing when the production " +
                "moved. Needs `expected_version`.",
            ),
          dry_run: z
            .boolean()
            .optional()
            .describe(
              "PREVIEW the batch instead of applying it: what each operation " +
                "would do, at which version, and nothing written. Use it to " +
                "show a person the change before they accept it.",
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const url = `/v1/studio/productions/${encodeURIComponent(args.production_id)}/ops`
        const batch = studioPayload(session, {
          // Forwarded untouched — this layer never inspects an operation.
          ops: args.ops,
          ...(args.expected_version !== undefined ? { baseVersion: args.expected_version } : {}),
          ...(args.strict !== undefined ? { strict: args.strict } : {}),
        })

        if (args.dry_run !== true) {
          const res = await studioInject(fastify, session, { method: "POST", url, payload: batch })
          if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
          return viewResult(res.body)
        }

        // A preview has to FAIL CLOSED, and asking for one is not proof of
        // getting one: this body is a strip-mode body, so a service that
        // predates the flag drops it and APPLIES the batch — the exact write
        // the preview existed to prevent, discovered only from its answer.
        //
        // So the capability is proved first, with the one batch that has never
        // written anything: the EMPTY one, which the route has always answered
        // before it touches the document. A service that understands previews
        // answers that ping with the literal below; one that does not answers
        // its ordinary empty-batch reply, and the caller's real batch is never
        // sent at all. It carries no version and no strict flag, so the ping
        // itself cannot conflict.
        const ping = await studioInject(fastify, session, {
          method: "POST",
          url,
          payload: studioPayload(session, { ops: [], dryRun: true }),
        })
        if (ping.statusCode >= 400) return studioError(ping.statusCode, ping.body)
        if (!isPreview(ping.body)) {
          return studioError(
            409,
            JSON.stringify({
              error: {
                code: "studio_preview_unavailable",
                message:
                  "This deployment's studio service cannot preview a change yet, so nothing was sent. " +
                  "Apply the batch without `dry_run`, or ask for the service to be updated.",
              },
            }),
          )
        }

        const res = await studioInject(fastify, session, {
          method: "POST",
          url,
          payload: { ...batch, dryRun: true },
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )

    // ── share: who can reach the work ──────────────────────────────────────
    server.registerTool(
      "share_studio_production",
      {
        title: "Share Studio Production",
        description:
          "Publish this production to a share link, or take it back private " +
          "(`shared: false`). Publishing makes it readable by anyone holding " +
          "the link — ASK THE USER before turning it on. Reversible at any " +
          "time, and the only way sharing changes: no edit operation can touch " +
          "it. Free.",
        inputSchema: {
          production_id: z.string().uuid().describe("The production."),
          shared: z.boolean().describe("true publishes the link; false takes it back."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        _meta: confirmMeta("P"),
      },
      async (args) => {
        const res = await studioInject(fastify, session, {
          method: "POST",
          url: `/v1/studio/productions/${encodeURIComponent(args.production_id)}/share`,
          payload: studioPayload(session, { shared: args.shared }),
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )

    // ── clone: a copy, private and visible ─────────────────────────────────
    server.registerTool(
      "clone_studio_production",
      {
        title: "Copy Studio Production",
        description:
          "Copy a production — the user's own, or one shared with them — into " +
          "their Studio project. The copy starts PRIVATE and un-archived, and " +
          "carries the graph and every landed result. Use it before a risky " +
          "round of edits, or to work from somebody else's shared film. Free.",
        inputSchema: {
          production_id: z.string().uuid().describe("The production to copy."),
          name: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe('Defaults to the source name plus " copy".'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const res = await studioInject(fastify, session, {
          method: "POST",
          url: `/v1/studio/productions/${encodeURIComponent(args.production_id)}/clone`,
          payload: studioPayload(session, { ...(args.name ? { name: args.name } : {}) }),
        })
        if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
        return viewResult(res.body)
      },
    )
  }

  // ── the seven that spend ───────────────────────────────────────────────────
  registerStudioProductionRunTools(opts)
}
