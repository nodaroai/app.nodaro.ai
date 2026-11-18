/**
 * `make_podcast_pack` → POST /v1/podcast-pack (decided 2026-11-18): several
 * podcast tools on ONE recording for one price — every started 15 seconds of
 * the recording, every chosen tool included (lib/use-case/pack-price.ts).
 * `estimate_only` posts the same request to POST /v1/podcast-pack/estimate
 * instead: one tool for both, to spare the wire budget.
 *
 * `tools` is keyed by node type; each value is the arguments of that node's
 * run verb (its `UseCaseVerbInput`, handed in from verbs-use-case.ts), without
 * the recording. Each is checked against that verb's own argument shape and
 * made into that verb's own body when the call is made, so a tool in the pack
 * takes, and refuses, what its own verb does. On the wire each value is an
 * open record: the five shapes nested would be past the per-tool budget, and
 * each run verb lists its arguments already. `review_before_render` is not
 * taken: the pack starts its tools with nobody to review a preview, which
 * their routes refuse once the pack is charged.
 *
 * The answer names the pack's job and each tool's own job: the agent follows
 * each with wait_for_job and continues a failed one, free, with
 * continue_use_case (from-failed). Each tool's job is registered as an MCP task,
 * as a run verb's job is. Refusals are the use-case verbs' own wording
 * (`refusalText`, handed in), and the quote states its figure through the
 * amounts funnel.
 */
import { z } from "zod"
import { usecaseDescriptor, usecaseResultIsText, usecaseRowOf, type UseCaseBuilderKey, type UseCaseNodeType } from "@nodaro/render-rules"
import { hasCredits } from "../../config.js"
import { PODCAST_PACK_RATE_ID, PODCAST_PACK_TOOLS, type PodcastPackTool } from "../../use-case/pack-price.js"
import { amountsNote, amountWord, statedAmount, statedAmountFields, unitFields } from "../amounts.js"
import { mcpInject } from "../internal-request.js"
import { registerTask } from "../tasks.js"
import { creditHint } from "./_credit-hint.js"
import { clientRequestIdSchema, errorResult, idempotencyHeaders } from "./_verb-helpers.js"
import type { RegisterOpts } from "./verbs-image.js"
import type { UseCaseToolError, UseCaseVerbBody, UseCaseVerbInput } from "./verbs-use-case-input.js"
import { recordingsInputShape, recordingsPayload, type RecordingsArgs } from "./verbs-use-case-recordings.js"

const TOOL = "make_podcast_pack"

/** A run verb's arguments the pack does not take per tool: the recording and the retry token are the pack's own, and a pack has no review. */
const PACK_OWN_ARGUMENTS: ReadonlySet<string> = new Set(["media_url", "media_urls", "master_audio_url", "cameras", "client_request_id"])
const NO_REVIEW = "review_before_render"

/** The body fields a run verb makes from the recording: the pack sends its recording once, beside the tools. */
const RECORDING_BODY_KEYS: ReadonlySet<string> = new Set(["mediaUrls", "masterAudioUrl", "cameras"])

const toolError = (text: string): UseCaseToolError => ({ content: [{ type: "text" as const, text }], isError: true as const })

/** A tool's arguments on the wire: checked against its run verb's own shape when the call is made. */
const toolArguments = () => z.record(z.string(), z.unknown()).optional()

/** The quote the estimate route answers (`data`). `credits` is 0 on an edition without credits, null when it could not be priced. */
interface PackQuote {
  readonly tools: readonly string[]
  readonly durationSec: number
  readonly units: number
  readonly credits: number | null
}

/** What the run route answers (202): the pack's job and each tool's — or, for a retried key, the pack's job alone. */
interface PackStart {
  readonly jobId: string
  readonly tools?: ReadonlyArray<{ readonly tool: string; readonly jobId: string; readonly executionId: string | null }>
  readonly notStarted?: ReadonlyArray<{ readonly tool: string; readonly error: { readonly code: string; readonly message: string } }>
  readonly durationSec?: number
  readonly units?: number
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

function quoteOf(body: string): PackQuote | null {
  try {
    const data = (JSON.parse(body) as { data?: Record<string, unknown> }).data
    if (!data || !Array.isArray(data.tools) || !finite(data.durationSec) || !finite(data.units)) return null
    const price = data.credits
    if (price !== null && !finite(price)) return null
    return { tools: data.tools.filter((t): t is string => typeof t === "string"), durationSec: data.durationSec, units: data.units, credits: price }
  } catch {
    return null
  }
}

function startOf(body: string): PackStart | null {
  try {
    const parsed = JSON.parse(body) as Partial<PackStart>
    return typeof parsed.jobId === "string" ? (parsed as PackStart) : null
  } catch {
    return null
  }
}

/** A tool's label (Tighten Episode), or the id as the route wrote it. */
function labelOf(tool: string): string {
  return (PODCAST_PACK_TOOLS as readonly string[]).includes(tool) ? usecaseDescriptor(tool as PodcastPackTool).label : tool
}

const lengthOf = (durationSec: number | undefined): string => (finite(durationSec) ? ` on a ${Math.ceil(durationSec / 60)} min recording` : "")

function quoteSentence(q: PackQuote): string {
  const what = `Podcast pack (${q.tools.map(labelOf).join(", ")})`
  const length = `a ${Math.ceil(q.durationSec / 60)} min recording, ${q.units} started 15 s`
  if (q.credits === 0) return `${what}: not billed in credits on this edition (${length}). Nothing was created or charged.`
  const price = statedAmount(q.credits)
  if (price === null) return `${what}: the price could not be read (${length}). Nothing was created or charged.`
  return `${what} is ${price} ${amountWord()} for ${length}, every tool included. Nothing was created or charged; call ${TOOL} without estimate_only to start it.`
}

function startedText(p: PackStart): string {
  if (!p.tools) {
    return `This pack was already started (job ${p.jobId}): get_job on it lists each tool's job in output_data.tools. Follow each with wait_for_job.`
  }
  const lines = [
    `Podcast pack started (job ${p.jobId}): one price for ${p.tools.length} tool(s)${lengthOf(p.durationSec)}. Each tool runs as its own job; follow each with wait_for_job (or get_job):`,
    ...p.tools.map((t) => `- ${labelOf(t.tool)}: job ${t.jobId}`),
    ...(p.notStarted ?? []).map((n) => `- not started (${n.error.code}): ${n.error.message}`),
    'A tool that fails is continued free: continue_use_case with its job_id and mode "from-failed", until it succeeds.',
  ]
  return lines.join("\n")
}

/** One tool's settings, checked against its run verb's own arguments and made into that verb's body without the recording. */
function toolBody(type: PodcastPackTool, raw: Record<string, unknown>, verb: UseCaseVerbInput, recording: RecordingsArgs): UseCaseVerbBody {
  const shape = Object.fromEntries(Object.entries(verb.shape).filter(([key]) => !PACK_OWN_ARGUMENTS.has(key) && key !== NO_REVIEW))
  const parsed = z.strictObject(shape).safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "arguments"}: ${i.message}`).join("; ")
    const keys = Object.keys(raw)
    const why = [
      ...(keys.some((k) => PACK_OWN_ARGUMENTS.has(k)) ? [" Send the recording and client_request_id once, at the top level."] : []),
      ...(keys.includes(NO_REVIEW) ? [` A pack has no review: run ${verb.tool} on its own to review a preview.`] : []),
    ].join("")
    return { error: toolError(`${TOOL}: \`tools["${type}"]\` does not match ${verb.tool}'s arguments — ${issues}.${why}`) }
  }
  const body = verb.body({ ...parsed.data, ...recording } as never)
  if ("error" in body) return body
  return { payload: Object.fromEntries(Object.entries(body.payload).filter(([key]) => !RECORDING_BODY_KEYS.has(key))) }
}

export function registerPodcastPack(
  { server, session, fastify }: RegisterOpts,
  offered: readonly UseCaseNodeType[],
  inputs: Readonly<Record<UseCaseBuilderKey, UseCaseVerbInput>>,
  refusalText: (statusCode: number, body: string) => string | null,
): void {
  // The tools it names are the pack's tools this session is offered (every one where none is: it is then withheld itself).
  const named = PODCAST_PACK_TOOLS.filter((t) => offered.includes(t))
  const types: readonly PodcastPackTool[] = named.length > 0 ? named : PODCAST_PACK_TOOLS
  const inputOf = (type: PodcastPackTool): UseCaseVerbInput => inputs[usecaseRowOf(type).builder as UseCaseBuilderKey]
  const price = hasCredits() ? ` (${creditHint(PODCAST_PACK_RATE_ID)} per started 15 s of the recording, every tool included)` : ""
  const refused = (statusCode: number, body: string) => {
    const text = refusalText(statusCode, body)
    return text ? toolError(text) : errorResult(statusCode, body)
  }

  /** The late start's answer (`{ jobId, executionId, tool }`), or null. */
  const lateStartOf = (body: string): { jobId: string; executionId: string | null; tool: UseCaseNodeType } | null => {
    try {
      const v = JSON.parse(body) as { jobId?: unknown; executionId?: unknown; tool?: unknown }
      if (typeof v.jobId !== "string" || typeof v.tool !== "string" || !types.includes(v.tool as UseCaseNodeType)) return null
      return { jobId: v.jobId, executionId: typeof v.executionId === "string" ? v.executionId : null, tool: v.tool as UseCaseNodeType }
    } catch {
      return null
    }
  }

  server.registerTool(
    "make_podcast_pack",
    {
      title: "Podcast Pack",
      description:
        `Run several podcast tools on one recording for one price${price}. \`tools\`: each tool to run, its value that tool's own ` +
        "arguments without the recording ({} for its defaults). Returns each tool's job. `estimate_only: true` quotes it; nothing is created or charged." +
        amountsNote(),
      inputSchema: {
        ...recordingsInputShape,
        speaker_names: z.record(z.string(), z.string()).optional().describe("Speaker label → display name."),
        tools: z
          .object(Object.fromEntries(types.map((t) => [t, toolArguments().describe(`${inputOf(t).tool}'s arguments`)])))
          .strict()
          .describe("The tools to run, at least one."),
        estimate_only: z.boolean().optional().describe("Quote only: nothing is created or charged."),
        pack_job_id: z.string().uuid().optional().describe("A pack's job: starts its one tool in `tools` that did not start, free, once."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      // A tool its pack paid for that did not start: started free, once, on what the pack kept.
      if (args.pack_job_id !== undefined) {
        const asked = types.filter((t) => args.tools[t] !== undefined)
        if (asked.length !== 1) return toolError(`${TOOL}: with pack_job_id, name exactly one tool in \`tools\`: the one that did not start.`)
        const res = await mcpInject(fastify, session, { method: "POST", url: `/v1/podcast-pack/${args.pack_job_id}/start`, payload: { tool: asked[0] } })
        if (res.statusCode >= 400) return refused(res.statusCode, res.body)
        const run = lateStartOf(res.body)
        if (!run) return toolError(`${TOOL}: the answer could not be read.`)
        registerTask({ taskId: run.jobId, userId: session.userId, kind: usecaseResultIsText(run.tool) ? "image" : "video" })
        return {
          content: [{ type: "text" as const, text: `${run.tool} started under its pack: job ${run.jobId}. Follow it with wait_for_job; if it fails, continue it free with continue_use_case, mode "from-failed".` }],
          structuredContent: { ...run },
        }
      }
      const recordings = recordingsPayload(args)
      if ("error" in recordings) return recordings.error
      const chosen = types.filter((t) => args.tools[t] !== undefined)
      if (chosen.length === 0) return toolError(`${TOOL}: name at least one tool in \`tools\` (${types.join(", ")}).`)
      const recording: RecordingsArgs = {
        ...(args.media_url !== undefined ? { media_url: args.media_url } : {}),
        ...(args.media_urls !== undefined ? { media_urls: args.media_urls } : {}),
        ...(args.master_audio_url !== undefined ? { master_audio_url: args.master_audio_url } : {}),
        ...(args.cameras !== undefined ? { cameras: args.cameras } : {}),
      }
      const bodies = chosen.map((type) => ({ type, body: toolBody(type, args.tools[type]!, inputOf(type), recording) }))
      const wrong = bodies.find((b) => "error" in b.body)
      if (wrong && "error" in wrong.body) return wrong.body.error
      const payload = {
        ...recordings.payload,
        ...(args.speaker_names ? { speakerNames: { ...args.speaker_names } } : {}),
        tools: Object.fromEntries(bodies.map((b) => [b.type, "payload" in b.body ? b.body.payload : {}])),
        mcp_client: session.clientName,
        userId: session.userId,
      }

      if (args.estimate_only === true) {
        const res = await mcpInject(fastify, session, { method: "POST", url: "/v1/podcast-pack/estimate", payload })
        if (res.statusCode >= 400) return refused(res.statusCode, res.body)
        const quote = quoteOf(res.body)
        if (!quote) return toolError(`${TOOL}: the quote could not be read.`)
        return {
          content: [{ type: "text" as const, text: quoteSentence(quote) }],
          // The figure in the deployment's unit when it has one (lib/mcp/amounts.ts).
          structuredContent: { ...statedAmountFields(quote, ["credits"]), ...unitFields() },
        }
      }

      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: "/v1/podcast-pack",
        payload,
        headers: idempotencyHeaders(args.client_request_id),
      })
      if (res.statusCode >= 400) return refused(res.statusCode, res.body)
      const started = startOf(res.body)
      if (!started) return toolError(`${TOOL}: the pack's answer could not be read.`)
      // Each tool's job, as a run verb's job is: a task cancel reaches it.
      for (const t of started.tools ?? []) {
        registerTask({ taskId: t.jobId, userId: session.userId, kind: usecaseResultIsText(t.tool) ? "image" : "video" })
      }
      return {
        content: [{ type: "text" as const, text: startedText(started) }],
        structuredContent: { ...started },
      }
    },
  )
}
