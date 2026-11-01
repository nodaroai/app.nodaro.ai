// backend/src/lib/concurrency-lanes/lane-parent.ts — the lane-only marker a
// coordinator's child job carries, so the child enters its lane AHEAD of jobs
// that have not started (worker-admit.ts, mode `front`): a long-running
// coordinator must not starve behind a fresh fan-out of someone else's work.
//
// The video director makes its speech, alignment and render jobs through the
// ordinary routes, in-process (fastify.inject on the internal lane). It names
// itself in LANE_PARENT_HEADER; the route copies the marker onto the job's
// BullMQ payload as `laneParent`, and nowhere else. Deliberately NOT
// `parent_job_id`: a row carrying one is a hidden child — left out of the
// jobs list and by-id reads, sending no webhooks, exempt from job-policy holds
// — so marking the director's children that way would change what users see.
// The marker changes nothing but the child's place in its line.
//
// Only the internal lane is believed: from a user, an API token or an app it
// would buy a place at the front of the line.
import type { FastifyRequest } from "fastify"

/** The header a coordinator names itself in, on an internal call that creates a child job. */
export const LANE_PARENT_HEADER = "x-nodaro-lane-parent"

/** The coordinator a child job belongs to. Only the video director marks its children today. */
export interface LaneParent {
  kind: "director"
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS: ReadonlySet<string> = new Set<LaneParent["kind"]>(["director"])

/** The header value naming `parent` (`<kind>:<id>`). */
export function laneParentHeaderValue(parent: LaneParent): string {
  return `${parent.kind}:${parent.id}`
}

/** The marker an internal request names; undefined for any other caller or a malformed value. */
export function laneParentOf(req: Pick<FastifyRequest, "headers" | "authKind">): LaneParent | undefined {
  if (req.authKind !== "internal") return undefined
  const raw = req.headers[LANE_PARENT_HEADER]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  if (typeof value !== "string") return undefined
  const sep = value.indexOf(":")
  if (sep < 0) return undefined
  const kind = value.slice(0, sep)
  const id = value.slice(sep + 1)
  if (!KINDS.has(kind) || !UUID.test(id)) return undefined
  return { kind: kind as LaneParent["kind"], id }
}

/**
 * The marker's field for a BullMQ payload: `{ laneParent }` for an internal
 * request that names one, else nothing at all (the payload stays exactly what
 * it was).
 */
export function laneParentPayload(req: Pick<FastifyRequest, "headers" | "authKind">): { laneParent?: LaneParent } {
  const laneParent = laneParentOf(req)
  return laneParent ? { laneParent } : {}
}

// ------------------------------------------------- at admission (worker-admit.ts)
//
// A payload is not proof of where its fields came from: a route that spreads a
// client's body into a BullMQ payload carries whatever the body named. So a
// marker on a payload is believed only once the director it names is seen
// running, for the same user, in the database — one read, made only when a
// payload carries a marker. Any doubt (no such row, another user's, not a
// director, not running, a read that failed) reads as no marker at all: the
// job is admitted as any other.

/**
 * The fields of a BullMQ payload only the server sets, from its internal
 * headers (this file and parent-execution.ts). A route that passes a client's
 * body into a payload drops them first (`withoutLaneOnlyFields`).
 */
export const LANE_ONLY_PAYLOAD_FIELDS = ["laneParent", "parentExecutionId"] as const

/** `body` without the lane-only fields (a copy; `body` is left as it was). */
export function withoutLaneOnlyFields<T extends Record<string, unknown>>(body: T): Omit<T, (typeof LANE_ONLY_PAYLOAD_FIELDS)[number]> {
  const { laneParent: _laneParent, parentExecutionId: _parentExecutionId, ...rest } = body
  return rest
}

/** The marker a payload carries, when well formed (a known kind, a uuid); else undefined. */
export function laneParentInPayload(data: Record<string, unknown>): LaneParent | undefined {
  const marker = data.laneParent
  if (marker === null || typeof marker !== "object") return undefined
  const { kind, id } = marker as { kind?: unknown; id?: unknown }
  if (typeof kind !== "string" || !KINDS.has(kind) || typeof id !== "string" || !UUID.test(id)) return undefined
  return { kind: kind as LaneParent["kind"], id }
}

/** The job type of the coordinator each kind names (its row's `input_data.type`, or `job_type`). */
const JOB_TYPE_OF_KIND: Readonly<Record<LaneParent["kind"], string>> = { director: "video-director" }

/**
 * True only when the coordinator `parent` names is a job of `userId`, of its
 * kind, and running (`processing`) now. Never throws: a failed read is false.
 */
export async function laneParentIsLive(parent: LaneParent, userId: string): Promise<boolean> {
  if (!userId) return false
  try {
    const { supabase } = await import("../supabase.js")
    // trash-read: admission's check that a coordinator is running now — a director the user put in the Trash while it runs still runs its children.
    const { data, error } = (await supabase
      .from("jobs")
      .select("user_id, status, job_type, input_type:input_data->>type")
      .eq("id", parent.id)
      .maybeSingle()) ?? {}
    if (error || !data) return false
    const row = data as { user_id?: unknown; status?: unknown; job_type?: unknown; input_type?: unknown }
    const type = JOB_TYPE_OF_KIND[parent.kind]
    return row.user_id === userId && row.status === "processing" && (row.job_type === type || row.input_type === type)
  } catch {
    return false
  }
}
