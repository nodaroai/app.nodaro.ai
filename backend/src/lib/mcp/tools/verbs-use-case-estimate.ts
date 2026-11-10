/**
 * `estimate_use_case` → POST /v1/<type>/estimate: what a podcast use-case run
 * would be charged, before it starts. One tool for every use-case node,
 * keyed by its type: `node_type` names the node, `input` holds the arguments
 * of that node's run verb, validated against that verb's own argument shape
 * and made into that verb's own body (verbs-use-case-input.ts), so the quote
 * is for exactly the run those arguments start. Nothing is created or charged.
 *
 * Registered by `registerUseCaseVerbs` beside the run verbs, for the use-case
 * nodes the deployment offers (`node_type` lists only those). Refusals are the
 * run verbs' own wording (`refusalText`, handed in).
 */
import { z } from "zod"
import { usecaseDescriptor, usecaseEstimatePath, usecaseRowOf, type UseCaseBuilderKey, type UseCaseNodeType } from "@nodaro/render-rules"
import { mcpInject } from "../internal-request.js"
import type { RegisterOpts } from "./verbs-image.js"
import { errorResult } from "./_verb-helpers.js"
import type { UseCaseToolError, UseCaseVerbInput } from "./verbs-use-case-input.js"

/** What the route quotes (`data`): every figure 0 on an edition without credits. */
interface UseCaseQuote {
  readonly totalCredits: number
  readonly stepsCredits: number
  readonly feeCredits: number
  readonly estimate?: true
  readonly durationSec: number | null
}

const toolError = (text: string): UseCaseToolError => ({ content: [{ type: "text" as const, text }], isError: true as const })

function quoteOf(body: string): UseCaseQuote | null {
  try {
    const data = (JSON.parse(body) as { data?: Partial<UseCaseQuote> }).data
    const n = (v: unknown) => typeof v === "number" && Number.isFinite(v)
    if (!data || !n(data.totalCredits) || !n(data.stepsCredits) || !n(data.feeCredits)) return null
    return {
      totalCredits: data.totalCredits!,
      stepsCredits: data.stepsCredits!,
      feeCredits: data.feeCredits!,
      ...(data.estimate === true ? { estimate: true as const } : {}),
      durationSec: n(data.durationSec) ? data.durationSec! : null,
    }
  } catch {
    return null
  }
}

/** The quote in one sentence: `≈` when a step is a metered estimate; an edition without credits says so. */
function quoteSentence(label: string, tool: string, q: UseCaseQuote): string {
  const length = q.durationSec === null ? "the recording's length could not be read" : `the recording is ${Math.ceil(q.durationSec / 60)} min`
  if (q.totalCredits === 0 && q.stepsCredits === 0 && q.feeCredits === 0) {
    return `${label}: not billed in credits on this edition (${length}). Nothing was created or charged.`
  }
  const approx = q.estimate ? "≈" : ""
  return (
    `${label} is estimated at ${approx}${q.totalCredits} credits: its steps ${approx}${q.stepsCredits} plus the per-run fee ${q.feeCredits} (${length}). ` +
    `Nothing was created or charged; ${tool} starts the run.`
  )
}

export function registerEstimateUseCase(
  { server, session, fastify }: RegisterOpts,
  offered: readonly UseCaseNodeType[],
  inputs: Readonly<Record<UseCaseBuilderKey, UseCaseVerbInput>>,
  refusalText: (statusCode: number, body: string) => string | null,
): void {
  const inputOf = (type: UseCaseNodeType): UseCaseVerbInput => inputs[usecaseRowOf(type).builder as UseCaseBuilderKey]
  server.registerTool(
    "estimate_use_case",
    {
      title: "Estimate a use-case run",
      description:
        "Quote a podcast use-case run before starting it: free, nothing is created or charged. `node_type` names the node and " +
        `\`input\` holds the arguments of its run tool (${offered.map((t) => inputOf(t).tool).join(", ")}), as you would send them. ` +
        "Returns `{ totalCredits, stepsCredits, feeCredits, estimate?, durationSec }`; `estimate: true` means a step is priced at a metered estimate.",
      inputSchema: {
        node_type: z.enum(offered as unknown as [string, ...string[]]).describe("The use-case node to quote."),
        input: z.record(z.string(), z.unknown()).describe("That node's run-tool arguments."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const type = args.node_type as UseCaseNodeType
      const verb = inputOf(type)
      // The run tool's own shape, strict: an argument of another node's tool is named, never dropped from the
      // quote. The two arguments a conversation adds to some tools (`user_request`, `flow_id`) are not the run's
      // and are let go, so arguments copied from any call quote cleanly.
      const { user_request: _request, flow_id: _flow, ...input } = args.input
      const parsed = z.strictObject(verb.shape).safeParse(input)
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "input"}: ${i.message}`).join("; ")
        return toolError(`estimate_use_case: \`input\` does not match ${verb.tool}'s arguments — ${issues}`)
      }
      const body = verb.body(parsed.data as never)
      if ("error" in body) return body.error
      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: usecaseEstimatePath(type),
        payload: { ...body.payload, mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) {
        const text = refusalText(res.statusCode, res.body)
        return text ? toolError(text) : errorResult(res.statusCode, res.body)
      }
      const quote = quoteOf(res.body)
      if (!quote) return toolError("estimate_use_case: the quote could not be read.")
      return {
        content: [{ type: "text" as const, text: quoteSentence(usecaseDescriptor(type).label, verb.tool, quote) }],
        structuredContent: { nodeType: type, ...quote },
      }
    },
  )
}
