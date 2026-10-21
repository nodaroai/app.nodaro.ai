import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { selectWithPerMinute } from "../../listing-per-minute-columns.js"
import { selectWithMax } from "../../listing-max-columns.js"
import { withListedRangeSnake } from "../../app-listing-price.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { mcpInject } from "../internal-request.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { appBaseUrl } from "../../deployment-urls.js"
import {
  extractAppInputSchema,
  flatInputsToOverrides,
  mergeInputOverrides,
} from "../extract-app-inputs.js"
import { cardResultText, clientRequestIdSchema, errorResult, idempotencyHeaders } from "./_verb-helpers.js"
import { isPreviewRefusalCode } from "@nodaro/shared/nodes"
import { isUuid } from "./_id-guard.js"
import { hasCredits } from "../../config.js"
import { LISTING_ESTIMATE_FLAG_COLUMN, listingEstimateFlag, selectWithEstimateFlag } from "../../listing-estimate-flag-column.js"

const appsReadGate: ToolGate = { required: ["apps:read"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterAppsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Apps tools.
 *
 * The pure-discovery model:
 *   1. `list_apps({ scope: "public" | "mine" })` — find apps by intent.
 *   2. `get_app_inputs({ slug })` — read the typed input schema before
 *      planning the call.
 *   3. `run_app({ slug, inputs })` — execute. `inputs` is FLAT keyed by
 *      the schema keys (not node-id) — server translates back via the
 *      schema's keyMap before sending to /v1/app/:slug/run.
 *   4. `retry_app_run({ slug, run_id, confirm })` — a run that failed is
 *      continued from where it stopped (POST /v1/app/:slug/runs/:runId/resume),
 *      quoted first and run with `confirm: true`.
 *
 * Per-user dynamic `app_<slug>` tools were dropped: they didn't scale,
 * they competed with the verb tools, and the prefer-verbs nudge in
 * their descriptions was a sign they didn't belong as first-class
 * tools.
 */
export function registerApps({ server, session, fastify }: RegisterAppsOpts): void {
  if (passesGate(session, appsReadGate)) {
    server.registerTool(
      "list_apps",
      {
        title: "List Apps",
        description:
          'Browse Nodaro apps — user-published workflows that do things the verb ' +
          'tools (generate_image / modify_image / etc.) don\'t cover on their own. ' +
          'Examples of apps live on the marketplace: "zebrify" (dress a subject as ' +
          'a zebra), "draw-me" (turn a photo into a sketch), "photo-shoot" ' +
          '(studio-lit portrait), "tidy-up" (clean up a room), "traveler" (place ' +
          'subject in a new location), "storyboard", "hair-styler", "jump", ' +
          '"dance", "material-letters". The full list grows over time — search by ' +
          'topic to find more.\n\n' +
          '**When to call this tool:** if the user asks for ANYTHING that doesn\'t ' +
          'match a direct verb tool — especially novel transformations, themed ' +
          'edits, or composite pipelines — search apps first with the relevant ' +
          'term before answering "I can\'t do that". Then call `get_app_inputs` ' +
          'on the chosen slug to learn what it needs, and `run_app` to execute.\n\n' +
          'Set `scope: "public"` (default) for the marketplace, or `scope: "mine"` ' +
          'for the caller\'s own published apps.',
        inputSchema: {
          scope: z
            .enum(["public", "mine"])
            .optional()
            .describe('"public" = marketplace (default); "mine" = caller\'s own apps'),
          limit: z.number().int().min(1).max(50).optional(),
          cursor: z.string().optional(),
          search: z.string().max(100).optional(),
          category: z.string().max(50).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const limit = args.limit ?? 20
        const scope = args.scope ?? "public"
        if (scope === "mine" && !session.userId) {
          return {
            content: [{ type: "text", text: 'scope="mine" requires authentication.' }],
            isError: true,
          }
        }
        // With the listed per-minute price (decided 2026-10-07), unless its
        // column has not reached this database yet.
        const buildQuery = (columns: string) => {
          let query = supabase
            .from("published_apps")
            .select(columns)
            .eq("is_active", true)
            .eq("publish_type", "app")
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(limit)
          if (scope === "mine") {
            query = query.eq("creator_id", session.userId!)
          } else {
            query = query.eq("is_listed", true)
          }
          if (args.cursor) query = query.lt("created_at", args.cursor)
          if (args.category) query = query.eq("category", args.category)
          if (args.search) {
            const tsQuery = args.search.trim().split(/\s+/).join(" & ")
            query = query.textSearch("search_vector", tsQuery)
          }
          return query
        }
        // With the listed "up to" (decided 2026-10-14), unless migration 517 has not reached this database.
        // And the estimate flag (migration 553), unless it has not reached this database yet.
        const { data, error } = await selectWithEstimateFlag<Record<string, unknown>[]>("published_apps", "id, slug, name, description, icon_url, estimated_credits, category, output_types, tags, total_run_count, favorite_count, created_at", (flagCols) =>
          selectWithMax<Record<string, unknown>[]>("published_apps", flagCols, (columns) =>
            selectWithPerMinute<Record<string, unknown>[]>("published_apps", columns, buildQuery, "listed"), "listed"))
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        // `estimated_credits_is_estimate: true` when the listed price holds a metered LLM estimate
        // (shown `~N`) — only while metered pricing is on; absent otherwise.
        const rows = (data ?? []).map((row) => {
          const { [LISTING_ESTIMATE_FLAG_COLUMN]: _stored, ...rest } = withListedRangeSnake(row)
          return listingEstimateFlag(row).estimatedCreditsIsEstimate ? { ...rest, [LISTING_ESTIMATE_FLAG_COLUMN]: true } : rest
        })
        const last = rows[rows.length - 1]
        const nextCursor =
          rows.length === limit && last?.created_at ? (last.created_at as string) : null
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { data: rows, scope, next_cursor: nextCursor },
                null,
                2,
              ),
            },
          ],
        }
      },
    )

    server.registerTool(
      "get_app_inputs",
      {
        title: "Get App Inputs",
        description:
          "Return the typed input schema for an app. Each entry has a `key`, `label`, `type` (image / video / audio / text / select / number / boolean / list), `required`, optional `options` for selects, and optional `maxLength` for a text input the publisher capped (a longer value is refused). Pass these `key`s to `run_app({ slug, inputs })`.",
        inputSchema: {
          slug: z.string().min(1).describe("App slug, e.g. 'photo-restoration'"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const { data, error } = await supabase
          .from("published_apps")
          .select(
            "id, slug, name, description, snapshot_settings, snapshot_nodes, is_listed, creator_id, is_active, publish_type",
          )
          .eq("slug", args.slug)
          .eq("publish_type", "app")
          .eq("is_active", true)
          .is("deleted_at", null)
          .limit(1)
          .single()
        if (error || !data) {
          return {
            content: [{ type: "text", text: `App "${args.slug}" not found.` }],
            isError: true,
          }
        }
        // Auth check: public apps are world-readable; private apps only the creator.
        if (
          !data.is_listed &&
          (!session.userId || data.creator_id !== session.userId)
        ) {
          return {
            content: [{ type: "text", text: `App "${args.slug}" not found.` }],
            isError: true,
          }
        }
        const schema = extractAppInputSchema({
          snapshotSettings: data.snapshot_settings as Record<string, unknown> | null,
          snapshotNodes: data.snapshot_nodes as
            | Array<{ id: string; type?: string; data?: Record<string, unknown> }>
            | null,
        })
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  slug: data.slug,
                  name: data.name,
                  description: data.description,
                  // Don't leak the keyMap (internal node-id mapping).
                  inputs: schema.fields,
                },
                null,
                2,
              ),
            },
          ],
        }
      },
    )
  }

  if (passesGate(session, executeGate)) {
    server.registerTool(
      "run_app",
      {
        title: "Run App",
        description:
          "Run a published app by slug. The caller pays for credits. `inputs` is a FLAT object keyed by the schema's input keys (call `get_app_inputs` first to learn them). Returns an execution_id. `inputOverrides` (advanced) sets raw node fields such as promptPrefix/promptSuffix.",
        inputSchema: {
          slug: z.string().min(1).describe("App slug, e.g. 'photo-restoration'"),
          client_request_id: clientRequestIdSchema.optional(),
          inputs: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Flat input map keyed by schema key (from get_app_inputs). Omit to use defaults.",
            ),
          inputOverrides: z
            .record(z.string(), z.record(z.string(), z.unknown()))
            .optional()
            .describe(
              "Advanced: raw node-data overrides keyed by node id → field → value, merged over `inputs`. " +
                "Reaches fields not exposed as app inputs, e.g. { \"n1\": { \"promptPrefix\": \"…\" } } to wrap the prompt with hidden text.",
            ),
        },
        outputSchema: {
          executionId: z.string(),
          runId: z.string().optional(),
          slug: z.string().optional(),
          name: z.string().optional(),
          status: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
        _meta: {
          "ui/resourceUri": "ui://nodaro/widget/v4/app-run",
          ui: {
            resourceUri: "ui://nodaro/widget/v4/app-run",
            visibility: ["model", "app"],
          },
        },
      },
      async (args) => {
        // Single DB read for the app row covers BOTH the input-translation
        // schema (when args.inputs is provided) AND the widget header's
        // app name. Cheaper than two reads, and the widget's name is
        // important enough to justify always fetching it.
        const { data: appRow } = await supabase
          .from("published_apps")
          .select("name, snapshot_settings, snapshot_nodes")
          .eq("slug", args.slug)
          .eq("publish_type", "app")
          .eq("is_active", true)
          .is("deleted_at", null)
          .limit(1)
          .single()

        let inputOverrides: Record<string, Record<string, unknown>> | undefined
        if (appRow && args.inputs && Object.keys(args.inputs).length) {
          const schema = extractAppInputSchema({
            snapshotSettings: appRow.snapshot_settings as Record<string, unknown> | null,
            snapshotNodes: appRow.snapshot_nodes as
              | Array<{ id: string; type?: string; data?: Record<string, unknown> }>
              | null,
          })
          inputOverrides = flatInputsToOverrides(args.inputs, schema.keyMap)
        }
        // Raw node-data overrides merge OVER the translated flat inputs — per node,
        // per field. Same shared helper `/v1/app/:slug/run` uses, so both surfaces
        // resolve an `inputs` + `inputOverrides` pair identically.
        inputOverrides = mergeInputOverrides(inputOverrides, args.inputOverrides)

        const payload = {
          inputOverrides,
          mcp_client: session.clientName,
          userId: session.userId,
        }
        const res = await mcpInject(fastify, session, {
          method: "POST",
          url: `/v1/app/${encodeURIComponent(args.slug)}/run`,
          payload,
          headers: idempotencyHeaders(args.client_request_id),
        })
        if (res.statusCode >= 400) {
          return {
            content: [
              { type: "text", text: `Error from Nodaro: ${res.statusCode} ${res.body}` },
            ],
            isError: true,
          }
        }
        let executionId: string | undefined
        let runId: string | undefined
        try {
          const body = JSON.parse(res.body) as { executionId?: string; runId?: string }
          executionId = body.executionId
          runId = typeof body.runId === "string" ? body.runId : undefined
        } catch {
          /* fall through */
        }
        if (!executionId) {
          return {
            content: [
              {
                type: "text",
                text: `Submitted but couldn't parse execution_id: ${res.body}`,
              },
            ],
            isError: true,
          }
        }
        const appName = (appRow?.name as string | undefined) ?? args.slug
        return {
          content: [
            {
              type: "text" as const,
              text: cardResultText({
                started: `Started app '${args.slug}' (id ${executionId}${runId ? `, run ${runId}` : ""}).`,
                noun: "outputs",
                pollHint:
                  "poll get_app_run with this execution id (NOT get_job — this id is an execution id)" +
                  (runId
                    ? `; if it fails, retry_app_run({ slug: ${JSON.stringify(args.slug)}, run_id: ${JSON.stringify(runId)} }) quotes continuing it from where it stopped`
                    : ""),
              }),
            },
          ],
          structuredContent: {
            executionId,
            ...(runId ? { runId } : {}),
            slug: args.slug,
            name: appName,
            status: "queued",
          },
        }
      },
    )

    // ── retry_app_run ──
    // The app's Retry of a FAILED run (POST /v1/app/:slug/runs/:runId/resume):
    // continued from where it stopped, on the version it ran, with the inputs
    // it applied. Price confirmation follows render_final / start_recast:
    // without `confirm` the tool returns the quote (the route's dryRun —
    // nothing is created or charged); `confirm: true`, only after the user
    // accepted it, runs. The quote says whether the payer can cover it; the
    // route refuses one it cannot with a 402 before any execution exists, and
    // every refusal comes back as a tool error with the way on.
    server.registerTool(
      "retry_app_run",
      {
        title: "Retry App Run",
        description:
          "Retry a FAILED published-app run from where it stopped: only the steps it did not complete run and are charged; every step it completed hands on its result. " +
          "It runs the version the run ran, with the inputs it applied (it takes none). " +
          "Without `confirm` it returns the PRICE QUOTE only (the steps it runs again; nothing is charged); with `confirm: true` — only after the user accepted the quoted credits — it runs. " +
          "Returns an execution id: poll get_app_run. To run with other inputs, or a run that was stopped rather than failing, start over with run_app.",
        inputSchema: {
          slug: z.string().min(1).describe("The app's slug."),
          run_id: z.string().min(1).describe("The run's id (run_app's runId)."),
          version: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("The app version to expect (default: the latest). The run's own version continues it after the app changed."),
          confirm: z
            .boolean()
            .optional()
            .describe("true ONLY after the user accepted the quoted credits in this conversation."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        if (!isUuid(args.run_id)) {
          return { content: [{ type: "text" as const, text: `Run ${args.run_id} not found (expected a run UUID).` }], isError: true as const }
        }
        const url = `/v1/app/${encodeURIComponent(args.slug)}/runs/${encodeURIComponent(args.run_id)}/resume`
        const versionField = args.version !== undefined ? { version: args.version } : {}
        // Quote first, always: it also checks the run, its version and what is left to run.
        // The route's body is strict: the user travels in mcpInject's header.
        const est = await mcpInject(fastify, session, { method: "POST", url, payload: { dryRun: true, ...versionField } })
        if (est.statusCode >= 400) return retryRefused(args.slug, args.run_id, est.statusCode, est.body)
        const quote = (parseBody(est.body).data ?? {}) as RetryQuote

        if (args.confirm !== true) {
          const steps = quote.steps ?? []
          const named = steps.map((st) => st.label ?? st.nodeId).join(", ")
          const billed = typeof quote.estimatedCredits === "number" && hasCredits()
          const price = billed ? `costs about ${quote.estimatedCredits} credits` : "is not billed in credits on this edition"
          const reused = (quote.reusedClips ?? 0) > 0 ? ` (${quote.reusedClips} finished clip(s) handed back at no cost)` : ""
          // The app credits, when they are what stops it (the route reports them); else the balance.
          const next =
            billed && quote.sufficient === false
              ? typeof quote.appCreditsAllowance === "number"
                ? "The user has no app credits left to run apps: tell them, and run it only after they have earned app credits or upgraded — " +
                  "until then the Retry is refused with insufficient app credits."
                : `The user's credits cannot cover it${typeof quote.available === "number" ? ` (${quote.available} available)` : ""}: ` +
                  "tell them, and run it only after they have added credits — until then the Retry is refused with insufficient credits."
              : "Present this to the user; call retry_app_run again with confirm: true once they accept."
          return {
            content: [
              { type: "text" as const, text: `The Retry runs ${steps.length} step(s) again (${named}) and ${price}${reused}. ${next}` },
            ],
            structuredContent: { ...quote, confirmed: false },
          }
        }

        const res = await mcpInject(fastify, session, { method: "POST", url, payload: versionField })
        if (res.statusCode >= 400) return retryRefused(args.slug, args.run_id, res.statusCode, res.body)
        const body = parseBody(res.body)
        const executionId = typeof body.executionId === "string" ? body.executionId : undefined
        if (!executionId) {
          return { content: [{ type: "text" as const, text: "The Retry was submitted, but its execution id could not be read." }], isError: true as const }
        }
        const deduped = body.deduped === true
        return {
          content: [
            {
              type: "text" as const,
              text:
                `${deduped ? "This Retry was already started" : "Started the Retry"}: execution ${executionId} continues run ${args.run_id}. ` +
                "Poll get_app_run with this execution id (NOT get_job).",
            },
          ],
          structuredContent: {
            executionId,
            runId: args.run_id,
            status: "pending",
            nodeIds: Array.isArray(body.nodeIds) ? body.nodeIds : [],
            estimatedCredits: quote.estimatedCredits ?? null,
            confirmed: true,
            ...(deduped ? { deduped } : {}),
          },
        }
      },
    )

    // ── delete_app_run ──
    // Soft-deletes (archives) a run. Restoration and permanent deletion are
    // intentionally only available from the Nodaro web UI — this protects
    // users from MCP tools accidentally destroying their data.
    server.registerTool(
      "delete_app_run",
      {
        title: "Archive App Run",
        description: `Move a published-app run to the user's archive. The run is removed from the active list but can be restored or permanently deleted from ${appBaseUrl()}/archived-runs. Use when the user asks to delete or remove a run by ID.`,
        inputSchema: {
          slug: z.string().min(1).describe("The published app's slug (last path segment of the app URL)."),
          runId: z.string().uuid().describe("The run's UUID."),
        },
      },
      async (args) => {
        const res = await mcpInject(fastify, session, {
          method: "DELETE",
          url: `/v1/app/${encodeURIComponent(args.slug)}/runs/${encodeURIComponent(args.runId)}`,
          payload: { userId: session.userId },
        })
        if (res.statusCode >= 400) {
          return {
            content: [
              { type: "text", text: `Failed to archive run: ${res.statusCode} ${res.body}` },
            ],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Archived run ${args.runId}. Restore or permanently delete from ${appBaseUrl()}/archived-runs.`,
            },
          ],
          structuredContent: {
            slug: args.slug,
            runId: args.runId,
            archived: true,
          },
        }
      },
    )
  }
}

/** What the Retry's quote answers (the route's `dryRun`). */
interface RetryQuote {
  steps?: Array<{ nodeId: string; type: string; label: string | null }>
  estimatedCredits?: number | null
  reusedClips?: number
  sufficient?: boolean | null
  available?: number | null
  /** Present only when the runner's app credits are what stops it. */
  appCreditsAllowance?: number
  appVersion?: number | null
}

function parseBody(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * A refused Retry as a tool error: the route's code and message (a 402 keeps
 * the route's own message — which allowance, which balance — rather than the
 * generic credits line), then the way on.
 */
function retryRefused(slug: string, runId: string, statusCode: number, raw: string) {
  const body = parseBody(raw)
  const error = body.error as { code?: unknown; message?: unknown } | undefined
  const refused =
    statusCode === 402 && typeof error?.message === "string" && error.message
      ? `Nodaro rejected the request (402${typeof error.code === "string" ? ` ${error.code}` : ""}): ${error.message}`
      : errorResult(statusCode, raw).content[0].text
  const next = retryRefusalNext(slug, runId, body)
  return { content: [{ type: "text" as const, text: next ? `${refused} ${next}` : refused }], isError: true as const }
}

/**
 * What an agent does after a refused Retry, by the route's code (the answer's
 * own message already says why), or `null` when there is nothing to add.
 */
export function retryRefusalNext(slug: string, runId: string, body: Record<string, unknown>): string | null {
  const error = body.error as { code?: unknown } | undefined
  const code = typeof error?.code === "string" ? error.code : null
  const runVersion = typeof body.runVersion === "number" ? body.runVersion : null
  const startOver = "Start it over with run_app (every step runs, and is charged, again)"
  if (code === "app_run_version_changed") {
    return (
      startOver +
      (runVersion !== null
        ? `, or continue it on its own version: retry_app_run({ slug: ${JSON.stringify(slug)}, run_id: ${JSON.stringify(runId)}, version: ${runVersion} }).`
        : ".")
    )
  }
  if (code === "app_run_version_unavailable" || code === "continuation_not_failed") return `${startOver}.`
  if (code === "already_running" && typeof body.executionId === "string") {
    return `Poll get_app_run({ execution_id: ${JSON.stringify(body.executionId)} }) instead.`
  }
  // Any of the preview refusal codes (a render held, a review-on use-case node, or both).
  if (code !== null && isPreviewRefusalCode(code)) {
    return "Retry it from the app page instead, where a person can review the Preview it stops at."
  }
  if (code === "insufficient_app_credits") {
    return "Tell the user: their app credits cannot cover this Retry; retry it once they have more."
  }
  if (code === "insufficient_credits") {
    return "Tell the user: their balance cannot cover this Retry; retry it once they have added credits."
  }
  return null
}
