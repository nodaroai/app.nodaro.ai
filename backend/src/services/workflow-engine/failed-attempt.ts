/**
 * The last FAILED attempt at a node a state of an earlier execution records —
 * what a use-case node in a continue-from-failed run resumes instead of
 * starting (and charging) again (use-case-request.ts `failedAttemptOf`).
 *
 * The state's own job when it failed there; else, for a seed of a node that
 * execution did not complete, the attempt an earlier generation's failure left
 * on it (`failedAttemptJobId`, carried seed to seed by `continuationSeeds`), so
 * a run built on a later generation that left the node out still finds it.
 * Never for a completed state: it hands on its output, nothing is resumed.
 *
 * And the one rule for whether such an attempt may be resumed at all
 * (decided 2026-10-18): only when the node's CURRENT inputs and settings are
 * the ones the attempt ran with (`attemptRanWithInputs`), in every mode — a
 * continue-from-failed (its overrides may change the settings) and a run of
 * named nodes alike (an upstream node it re-runs may hand on another
 * recording, and so may the generation a later continuation is built on).
 * Otherwise the node runs fresh, and that run's fee is the one charged.
 * Pure (the descriptors are pure data), so the engine's request half can ask it.
 */
import { usecaseDescriptor, type StoredInlineGraph, type UseCaseMediaKind, type UseCaseNodeType } from "@nodaro/render-rules"
import type { NodeExecutionState } from "./types.js"

export function failedAttemptJobIdOf(state: Readonly<NodeExecutionState> | undefined): string | null {
  if (!state || state.status === "completed") return null
  if (state.status === "failed" && typeof state.jobId === "string" && state.jobId) return state.jobId
  return typeof state.failedAttemptJobId === "string" && state.failedAttemptJobId ? state.failedAttemptJobId : null
}

/**
 * The failed attempt a continued run's OWN state of a node keeps while it has
 * no job of its own — pending (an earlier level failed first), running before
 * its request, or failed without one: the attempt the run it continues
 * records (`failedAttemptJobIdOf` of that state). A state that names a job of
 * this run (`jobId`) needs none: that job continued the attempt. Spread into
 * the state; `{}` when there is nothing to keep. Pure.
 */
export function keptFailedAttempt(
  continuedFrom: Readonly<Record<string, NodeExecutionState>> | undefined,
  nodeId: string,
  ownJobId?: string | null,
): { failedAttemptJobId?: string } {
  if (ownJobId) return {}
  const attempt = failedAttemptJobIdOf(continuedFrom?.[nodeId])
  return attempt ? { failedAttemptJobId: attempt } : {}
}

/** A value as one string with every object's keys in order and `undefined` left out (jsonb reorders keys). */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonical(v))).join(",")}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`
}

const urlOf = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null)

/**
 * Did the failed attempt run with exactly what the node would run with now?
 *  - `ranWith`: the attempt's wrapper `input_data` — the recording, music and
 *    intro card it ran on, and the settings it resolved (a continuation's
 *    wrapper copies its source's);
 *  - `mediaKind`: what its recording was (its stored graph's source), which
 *    the settings were resolved for;
 *  - `now`: what a fresh run of the node would send (`freshRunInputs`).
 * The current settings are resolved for the same recording kind and compared
 * whole, with the inputs the type takes, key order ignored. Everything else on
 * the wrapper (its mode, its lineage and claim keys, its fee, the recording's
 * probed length) says nothing about the inputs and is not compared. Pure.
 */
export function attemptRanWithInputs(
  type: UseCaseNodeType,
  ranWith: Readonly<Record<string, unknown>>,
  mediaKind: UseCaseMediaKind,
  now: Readonly<Record<string, unknown>>,
): boolean {
  const d = usecaseDescriptor(type)
  const takes = (input: "music" | "introCard", value: unknown) => (d.inputs.includes(input) ? urlOf(value) : null)
  const mediaNow = Array.isArray(now.mediaUrls) ? urlOf(now.mediaUrls[0]) : null
  const ran = {
    media: urlOf(ranWith.mediaUrl),
    music: takes("music", ranWith.musicUrl),
    introCard: takes("introCard", ranWith.introCardUrl),
    settings: ranWith.settings ?? null,
  }
  if (ran.media === null || mediaNow === null) return false
  const current = {
    media: mediaNow,
    music: takes("music", now.musicUrl),
    introCard: takes("introCard", now.introCardUrl),
    settings: d.resolveSettings(now, mediaKind),
  }
  return canonical(ran) === canonical(current)
}

/**
 * What the recording of an attempt's run was, read off the graph it stored:
 * its source node is an audio or a video upload (`usecaseSourceNode`). `null`
 * when the graph is another type's or has no such source — the attempt's
 * inputs cannot be told, so it is not resumed. Pure.
 */
export function attemptMediaKind(type: UseCaseNodeType, graph: Pick<StoredInlineGraph, "nodeType" | "nodes">): UseCaseMediaKind | null {
  if (graph.nodeType !== type) return null
  const sourceId = usecaseDescriptor(type).inputNodeIds.media
  const source = graph.nodes.find((n) => n.id === sourceId)
  return source?.type === "upload-audio" ? "audio" : source?.type === "upload-video" ? "video" : null
}
