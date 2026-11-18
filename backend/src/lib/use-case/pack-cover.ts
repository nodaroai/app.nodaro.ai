/**
 * Which podcast pack pays for a tool run (decided 2026-11-18): one price per
 * length of the recording, every tool chosen in it included, and a failed
 * tool re-run free until it succeeds. The pack is a job of its own
 * (`job_type` and `provider` "podcast-pack", `input_data.tools` naming the
 * tools it paid for); each tool runs as its ordinary use-case run, its
 * wrapper naming the pack (`input_data._coveredBy`, lib/covered-step.ts), so
 * its fee is 0 and every step holds 0 credits.
 *
 * A pack covers a tool only when it is the same user's, names that tool, and
 * stands: charged and going ahead. A pack none of whose tools started failed
 * and was refunded, and a cancelled one, cover nothing; a pack held for review
 * (suspected abuse) stops everything under it — a run refused, never charged
 * in its place. A tool runs fresh under its pack once: the pack starting it,
 * or, when it did not start, starting it later (routes/podcast-pack.ts).
 */
import type { FastifyRequest } from "fastify"
import type { UseCaseNodeType } from "@nodaro/render-rules"
import { supabase } from "../supabase.js"
import { WRAPPER_COVERED_BY_KEY, coveredByOf } from "../covered-step.js"
import { idempotencyKeyOf, isInternalLane } from "./lanes.js"
import { HELD_PACK_STATUSES, PODCAST_PACK_JOB_TYPE, VOID_PACK_STATUSES } from "./pack-job-type.js"

/** The pack job's `job_type` and `provider` (pack-price.ts, a leaf). */
export { PODCAST_PACK_JOB_TYPE }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A tool run's cover, as the run and continue routes resolve it. */
export type UseCaseCover =
  | { readonly kind: "none" }
  /** `units`: the pack's paid units, the most a fresh run under it may run on (absent for a continuation, which runs on its run's own recording). */
  | { readonly kind: "covered"; readonly packId: string; readonly units?: number }
  /** A cover was named but does not hold: the run is refused (never charged again in its place). */
  | { readonly kind: "refused"; readonly message: string }

const NONE: UseCaseCover = { kind: "none" }

/** The tools a pack job's input names. */
export function packToolsOf(inputData: unknown): readonly string[] {
  const tools = inputData && typeof inputData === "object" ? (inputData as Record<string, unknown>).tools : undefined
  return Array.isArray(tools) ? tools.filter((t): t is string => typeof t === "string") : []
}

/**
 * The body key the pack route names its pack under when it starts a tool. A
 * server-only key (`__`, lib/server-only-keys.ts): stripped from every
 * caller's body, an MCP agent's included, so only the server can send it.
 */
export const PACK_COVER_BODY_KEY = "__coveredBy"

/** The idempotency key the pack route starts `type` under: one fresh run per tool per pack. */
export function packToolIdempotencyKey(packId: string, type: UseCaseNodeType): string {
  return `uc-pack-${packId}-${type}`
}

/** Where a pack stands for one of its tools. */
export type PackStanding =
  /** The user's pack, naming the tool, charged and going ahead: `units` it paid for, `status` its job's. */
  | { readonly kind: "stands"; readonly units: number; readonly status: string }
  /** Held for review (suspected abuse): everything under it stops. */
  | { readonly kind: "held" }
  /** Not the user's pack, not naming the tool, or it did not go ahead (failed and refunded, or cancelled). */
  | { readonly kind: "none" }

/** Where pack `packId` stands for `userId`'s `type` (owner-scoped). A failed read throws. */
export async function packStanding(packId: string, userId: string, type: UseCaseNodeType): Promise<PackStanding> {
  if (!UUID.test(packId)) return { kind: "none" }
  const { data, error } = await supabase
    // trash-read: a pack (or the run it paid for) in the Trash still paid for its tools.
    .from("jobs")
    .select("provider, status, input_data")
    .eq("id", packId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`The pack could not be read: ${error.message}`)
  const row = data as { provider?: unknown; status?: unknown; input_data?: unknown } | null
  if (!row || row.provider !== PODCAST_PACK_JOB_TYPE || typeof row.status !== "string") return { kind: "none" }
  if (HELD_PACK_STATUSES.includes(row.status)) return { kind: "held" }
  if (VOID_PACK_STATUSES.includes(row.status) || !packToolsOf(row.input_data).includes(type)) return { kind: "none" }
  const units = (row.input_data as { units?: unknown } | null)?.units
  return { kind: "stands", units: typeof units === "number" && Number.isFinite(units) ? units : 0, status: row.status }
}

/** Whether `type` already has a run in pack `packId` (a fresh one, or any continuation of it). A failed read throws. */
export async function packToolHasRun(packId: string, userId: string, type: UseCaseNodeType): Promise<boolean> {
  const { data, error } = await supabase
    // trash-read: a run in the Trash still ran under its pack.
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq(`input_data->>${WRAPPER_COVERED_BY_KEY}`, packId)
    .eq("job_type", type)
    .limit(1)
  if (error) throw new Error(`The pack's runs could not be read: ${error.message}`)
  return (data ?? []).length > 0
}

const UNDER_REVIEW = "This pack is under review, so nothing can run under it for now."

const runCovers = new WeakMap<FastifyRequest, Promise<UseCaseCover>>()

/**
 * A fresh tool run's cover: the pack its body names ({@link PACK_COVER_BODY_KEY}),
 * honoured on the internal lane only, under the pack's key for the tool, while
 * the pack stands and the tool has no run in it yet (the pack route starts it
 * so, or starts later a tool that did not start). Asked by the route's
 * credit guard and by its handler alike, so it is read once per request.
 */
export function usecaseRunCover(req: FastifyRequest, type: UseCaseNodeType): Promise<UseCaseCover> {
  const known = runCovers.get(req)
  if (known) return known
  const asked = (async (): Promise<UseCaseCover> => {
    const named = (req.body as Record<string, unknown> | null | undefined)?.[PACK_COVER_BODY_KEY]
    if (named === undefined || !isInternalLane(req)) return NONE
    const userId = req.userId
    const refused: UseCaseCover = { kind: "refused", message: "The pack named for this run does not cover it." }
    if (typeof named !== "string" || !userId) return refused
    // One fresh run per tool per pack: under the pack's own key for it, while the pack stands, and only
    // when the tool has no run in it yet (the pack starting it, or starting it later when it did not start).
    if (idempotencyKeyOf(req) !== packToolIdempotencyKey(named, type)) return refused
    const pack = await packStanding(named, userId, type)
    if (pack.kind === "held") return { kind: "refused", message: UNDER_REVIEW }
    if (pack.kind !== "stands") return refused
    if (await packToolHasRun(named, userId, type)) return { kind: "refused", message: "This tool already ran in its pack: continue its run instead." }
    return { kind: "covered", packId: named, units: pack.units }
  })()
  runCovers.set(req, asked)
  return asked
}

const continueCovers = new WeakMap<FastifyRequest, Promise<UseCaseCover>>()

/**
 * A continuation's cover: the pack its SOURCE run's wrapper names (the
 * request's `jobId`, read owner-scoped — never the request's own word), so a
 * failed tool of a pack re-runs free however it is continued, and its Render
 * final too. A source whose pack no longer covers it continues as an
 * ordinary, charged run. Read once per request (guard and handler).
 */
export function usecaseContinueCover(req: FastifyRequest, type: UseCaseNodeType): Promise<UseCaseCover> {
  const known = continueCovers.get(req)
  if (known) return known
  const asked = (async (): Promise<UseCaseCover> => {
    const jobId = (req.body as { jobId?: unknown } | null | undefined)?.jobId
    const userId = req.userId
    if (typeof jobId !== "string" || !UUID.test(jobId) || !userId) return NONE
    // trash-read: a run in the Trash still names the pack that paid for it.
    const { data, error } = await supabase.from("jobs").select("input_data").eq("id", jobId).eq("user_id", userId).maybeSingle()
    if (error) throw new Error(`The run could not be read: ${error.message}`)
    const packId = coveredByOf((data as { input_data?: unknown } | null)?.input_data)
    if (!packId) return NONE
    const pack = await packStanding(packId, userId, type)
    // Held for review: refused, never charged in its place.
    if (pack.kind === "held") return { kind: "refused", message: UNDER_REVIEW }
    return pack.kind === "stands" ? { kind: "covered", packId } : NONE
  })()
  continueCovers.set(req, asked)
  return asked
}
