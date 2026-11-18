// @registry-lookup asks the body of each use-case type the pack names (USE_CASE_BODIES[type]: does it take a Master audio)
/**
 * What the podcast pack route does around its tools (routes/podcast-pack.ts):
 * read its body once, measure the recording once (guard and handler share
 * both), and ask each tool's own routes on the internal lane — its estimate
 * first (every refusal of the tool, before the pack is charged), then its run
 * (named to the pack under a server-only key, so it holds nothing).
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { usecaseDescriptor } from "@nodaro/render-rules"
import { config } from "../config.js"
import { formatZodError } from "../zod-error.js"
import { IMPORT_VIA_HEADER, importViaOf } from "../import-via.js"
import { prepareUseCase, type PrepareUseCaseOptions } from "./request.js"
import { podcastPackBody, packToolBody, packToolsChosen, type PodcastPackBody } from "./pack-body.js"
import { supabase } from "../supabase.js"
import { PACK_COVER_BODY_KEY, packToolIdempotencyKey } from "./pack-cover.js"
import { isInternalLane } from "./lanes.js"
import { podcastPackUnits, type PodcastPackTool } from "./pack-price.js"
import { peekClip } from "../clip-measure.js"
import { USE_CASE_BODIES, type UseCaseBody } from "./bodies.js"

/** A route's refusal, as it answered it. */
export interface PackRefusal {
  readonly status: number
  readonly error: { readonly code: string; readonly message: string; readonly tool?: PodcastPackTool }
}

export type PackParse = { readonly ok: true; readonly body: PodcastPackBody } | ({ readonly ok: false } & PackRefusal)

const parses = new WeakMap<FastifyRequest, PackParse>()

/** The pack request's body, parsed once per request. */
export function packBodyOf(req: FastifyRequest): PackParse {
  const known = parses.get(req)
  if (known) return known
  const parsed = podcastPackBody.safeParse(req.body)
  const answer: PackParse = parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, status: 400, error: { code: "validation_error", ...formatZodError(parsed.error) } as PackRefusal["error"] }
  parses.set(req, answer)
  return answer
}

export type PackMeasure = { readonly ok: true; readonly durationSec: number; readonly units: number } | ({ readonly ok: false } & PackRefusal)

/** The recording is probed as an estimate probes it: never downloaded here (a tool's run measures what it needs). */
const PACK_MEASURE: PrepareUseCaseOptions = { measureWholeClip: (url) => peekClip(url).catch(() => null) }

const measures = new WeakMap<FastifyRequest, Promise<PackMeasure>>()

/**
 * The recording's length and the units it is charged, read once per request:
 * the longest clock any chosen tool runs on — a run's clock is its Master
 * audio when it takes one and one is given, else its first recording
 * (`usecaseClockSec`) — so no tool runs on more than the pack paid for. It is
 * read through one tool's own preparation: one that takes the Master audio
 * when one is given and a chosen tool takes it, so both lengths are read. A
 * recording whose length cannot be read refuses the pack before anything is
 * charged.
 */
export function packMeasureOf(req: FastifyRequest): Promise<PackMeasure> {
  const known = measures.get(req)
  if (known) return known
  const asked = (async (): Promise<PackMeasure> => {
    const parsed = packBodyOf(req)
    if (!parsed.ok) return parsed
    const tools = packToolsChosen(parsed.body)
    const takesMaster = parsed.body.masterAudioUrl !== undefined ? tools.find((t) => Object.hasOwn(USE_CASE_BODIES[t].shape, "masterAudioUrl")) : undefined
    const measuring = takesMaster ?? tools[0]!
    const prep = await prepareUseCase(measuring, packToolBody(parsed.body, measuring) as UseCaseBody, PACK_MEASURE)
    if (!prep.ok) return { ok: false, status: prep.status, error: { code: prep.code, message: prep.message } }
    const lengths = [prep.sources.media.durationSec, prep.sources.masterAudio?.durationSec]
    const durationSec = Math.max(0, ...lengths.filter((l): l is number => typeof l === "number" && Number.isFinite(l)))
    if (!(durationSec > 0) || typeof prep.sources.media.durationSec !== "number") {
      return { ok: false, status: 422, error: { code: "media_unreadable", message: "The recording's length could not be read." } }
    }
    return { ok: true, durationSec, units: podcastPackUnits(durationSec) }
  })()
  measures.set(req, asked)
  return asked
}

/** What a tool's route answered. */
export type ToolAnswer = { readonly ok: true; readonly status: number; readonly json: Record<string, unknown> } | ({ readonly ok: false } & PackRefusal)

/**
 * One call to a tool's route on the internal lane, as the request's user (and
 * payer, and way in). `extra` is the server's own part of the body.
 */
export async function askTool(
  app: FastifyInstance,
  req: FastifyRequest,
  type: PodcastPackTool,
  path: "estimate" | "run",
  body: PodcastPackBody,
  extra: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): Promise<ToolAnswer> {
  const d = usecaseDescriptor(type)
  const via = importViaOf(req)
  const res = await app.inject({
    method: "POST",
    url: path === "estimate" ? `${d.route}/estimate` : d.route,
    headers: {
      ...headers,
      "content-type": "application/json",
      "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
      "x-internal-user-id": req.userId!,
      ...(via ? { [IMPORT_VIA_HEADER]: via } : {}),
    },
    payload: {
      ...packToolBody(body, type),
      // Who can review a tool's preview: the pack's own caller, as on the tool's own route (a
      // caller outside the server is one); inside a run, only what that run says.
      reviewerPresent: packReviewerPresent(req, body),
      userId: req.userId,
      ...(req.billingContext ? { billingContext: req.billingContext } : {}),
      ...(body.workflowId ? { workflowId: body.workflowId } : {}),
      ...(body.nodeId ? { nodeId: body.nodeId } : {}),
      ...extra,
    },
  })
  const json = (() => {
    try {
      return res.json() as Record<string, unknown>
    } catch {
      return {}
    }
  })()
  if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true, status: res.statusCode, json }
  const error = (json.error ?? {}) as { code?: unknown; message?: unknown }
  return {
    ok: false,
    status: res.statusCode,
    error: {
      code: typeof error.code === "string" ? error.code : "tool_refused",
      message: `${d.label}: ${typeof error.message === "string" ? error.message : `refused (${res.statusCode})`}`,
      tool: type,
    },
  }
}

/** Whether a person can review a tool's preview: any caller from outside the server; inside, as the run says. */
export function packReviewerPresent(req: FastifyRequest, body: PodcastPackBody): boolean {
  return isInternalLane(req) ? body.reviewerPresent === true : true
}

/** Start `type` for the pack: its run, named to the pack, under the pack's own key for it. */
export function startPackTool(app: FastifyInstance, req: FastifyRequest, packId: string, type: PodcastPackTool, body: PodcastPackBody): Promise<ToolAnswer> {
  return askTool(app, req, type, "run", body, { [PACK_COVER_BODY_KEY]: packId }, { "idempotency-key": packToolIdempotencyKey(packId, type) })
}

/**
 * The pack's request again, from its job (owner-scoped): the recording, the
 * speakers' names and each tool's settings, as the pack stored them — what
 * starting a tool later sends that tool. Null when it cannot be read back.
 */
export async function packRequestOf(packId: string, userId: string): Promise<PodcastPackBody | null> {
  const { data, error } = await supabase
    // trash-read: a pack in the Trash still paid for its tools.
    .from("jobs")
    .select("input_data, workflow_id, node_id")
    .eq("id", packId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { input_data?: Record<string, unknown> | null; workflow_id?: string | null; node_id?: string | null }
  const input = row.input_data ?? {}
  const parsed = podcastPackBody.safeParse({
    mediaUrls: input.mediaUrls,
    ...(input.masterAudioUrl !== undefined ? { masterAudioUrl: input.masterAudioUrl } : {}),
    ...(input.cameras !== undefined ? { cameras: input.cameras } : {}),
    ...(input.speakerNames !== undefined ? { speakerNames: input.speakerNames } : {}),
    tools: input.settings,
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    ...(row.node_id ? { nodeId: row.node_id } : {}),
  })
  return parsed.success ? parsed.data : null
}

/** A tool started later joins its pack's list of runs, and leaves its list of tools that did not start. */
export async function notePackRun(packId: string, userId: string, run: { readonly tool: PodcastPackTool; readonly jobId: string; readonly executionId: string | null }): Promise<void> {
  try {
    const { data, error } = await supabase
      // trash-read: a pack in the Trash still paid for its tools.
      .from("jobs")
      .select("output_data")
      .eq("id", packId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error || !data) return
    const output = ((data as { output_data?: Record<string, unknown> | null }).output_data ?? {}) as Record<string, unknown>
    const tools = Array.isArray(output.tools) ? output.tools : []
    const notStarted = (Array.isArray(output.notStarted) ? output.notStarted : []).filter((n) => (n as { tool?: unknown })?.tool !== run.tool)
    const { notStarted: _gone, ...rest } = output
    await supabase
      .from("jobs")
      .update({ output_data: { ...rest, tools: [...tools, run], ...(notStarted.length > 0 ? { notStarted } : {}) } })
      .eq("id", packId)
      .eq("user_id", userId)
  } catch (err) {
    console.warn(`[podcast-pack] pack ${packId}: its list of runs could not be updated:`, (err as Error).message)
  }
}
