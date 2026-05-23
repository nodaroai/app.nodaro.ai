import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import { REDUCE_STRATEGY_IDS } from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { errorResult, parseFailure } from "./_verb-helpers.js"
import { config } from "../../config.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterReduceOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Reduce (fan-in) tool.
 *
 * The Reduce node merges N upstream results into one — picking the best of
 * a batch, concatenating, voting, etc. Six strategies ship today:
 *   - `pick-best-llm` — Sonnet picks the best item against your criteria.
 *   - `concat` — Join all survivors with a separator.
 *   - `first-non-empty` — Return the first survivor (empty strings filtered).
 *   - `count` — Return how many survivors came through.
 *   - `vote` — Return the most common survivor (ties → first).
 *   - `merge-json` — Parse each survivor as JSON and merge into one object.
 *
 * This delegates to the existing `POST /v1/reduce` route via
 * `fastify.inject()` so the credit guard, Zod validation, EmptyInputError
 * handling, and job-lifecycle (reserve/commit/refund) all live in one
 * place. Same pattern as `run_app` / `run_workflow`.
 */
export function registerReduce({ server, session, fastify }: RegisterReduceOpts): void {
  if (!passesGate(session, executeGate)) return

  server.registerTool(
    "reduce",
    {
      title: "Reduce (fan-in)",
      description:
        "Merge multiple text/URL inputs into a single result using one of " +
        "6 strategies: `pick-best-llm`, `concat`, `first-non-empty`, " +
        "`count`, `vote`, `merge-json`. Returns `{ jobId, output, meta }` " +
        "with the chosen / merged value as a string and `meta.summary` " +
        "describing what happened. `pick-best-llm` also returns " +
        "`meta.selectedIndex` and `meta.reasoning` (the LLM rationale).",
      inputSchema: {
        strategyId: z
          .enum(REDUCE_STRATEGY_IDS as [string, ...string[]])
          .describe(
            "One of: pick-best-llm, concat, first-non-empty, count, vote, merge-json",
          ),
        strategyConfig: z
          .record(z.unknown())
          .optional()
          .describe(
            "Strategy-specific config. `pick-best-llm`: { criteria: string, inputKind?: 'text'|'image-url' }. " +
            "`concat`: { separator?: string }. `vote`: { caseSensitive?: boolean }. " +
            "`merge-json`: { strategy?: 'deep'|'shallow' }. Others: {}.",
          ),
        inputs: z
          .array(z.string())
          .max(1000)
          .describe("Up to 1000 input strings (e.g. URLs or text fragments)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const payload = {
        userId: session.userId,
        strategyId: args.strategyId,
        strategyConfig: args.strategyConfig ?? {},
        inputs: args.inputs,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/reduce",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) {
        return errorResult(res.statusCode, res.body)
      }
      let parsed:
        | { jobId?: string; output?: string; meta?: Record<string, unknown> }
        | undefined
      try {
        parsed = JSON.parse(res.body) as typeof parsed
      } catch {
        return parseFailure(res.body)
      }
      // `output` is a string. `concat` with an all-empty input legitimately
      // returns `output: ""` — truthiness check would wrongly classify that
      // as an error. Type-check is the right gate here.
      if (typeof parsed?.output !== "string") {
        return errorResult(res.statusCode, res.body)
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { jobId: parsed.jobId, output: parsed.output, meta: parsed.meta },
              null,
              2,
            ),
          },
        ],
        structuredContent: {
          jobId: parsed.jobId,
          output: parsed.output,
          meta: parsed.meta,
        },
      }
    },
  )
}
