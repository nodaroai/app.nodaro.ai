/**
 * Which audio a Suno Separate run separates — one rule for the editor's run,
 * the node's lane hint, the workflow payload, the route and the worker. They
 * used to decide it each on their own, and a node with a typed task id and a
 * wired upload separated the Suno track in the editor but the upload on the
 * server.
 *
 * A task id makes the run a Suno track, separated by its ids; the audio id
 * defaults to the task id when none is known. Without a task id, any wired
 * audio is separated by its URL. Never both: a run with a task id does not
 * carry the URL, so no later step can pick it up instead.
 */

/** A Suno track by its ids, or any audio by URL. */
export type SunoSeparateSource =
  | { readonly taskId: string; readonly audioId: string; readonly audioUrl?: never }
  | { readonly audioUrl: string; readonly taskId?: never; readonly audioId?: never }

/** What a site knows about a run's source. Every value may be blank or absent. */
export interface SunoSeparateSourceCandidates {
  /** Task ids, the one that wins first: a wired Suno source's, then the node's typed one. */
  readonly taskIds: readonly unknown[]
  /** Audio ids, in the same order. */
  readonly audioIds?: readonly unknown[]
  /** The URL of any audio wired in. */
  readonly audioUrl?: unknown
}

/** The lane a run takes, for a site that knows only whether audio is wired, not its URL. */
export type SunoSeparateSourceLane = "suno" | "url"

/** The first non-blank string, trimmed. */
function firstNonBlank(values: readonly unknown[] | undefined): string | undefined {
  for (const value of values ?? []) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

/** The lane: a task id first, then wired audio. Null when there is neither. */
export function sunoSeparateSourceLane(c: {
  readonly taskIds: readonly unknown[]
  readonly hasAudio: boolean
}): SunoSeparateSourceLane | null {
  if (firstNonBlank(c.taskIds)) return "suno"
  return c.hasAudio ? "url" : null
}

/**
 * The source a run sends. Null when there is no task id and no audio URL —
 * every site refuses the run then.
 */
export function pickSunoSeparateSource(c: SunoSeparateSourceCandidates): SunoSeparateSource | null {
  const taskId = firstNonBlank(c.taskIds)
  const audioUrl = firstNonBlank([c.audioUrl])
  const lane = sunoSeparateSourceLane({ taskIds: [taskId], hasAudio: audioUrl !== undefined })
  if (lane === "suno" && taskId) return { taskId, audioId: firstNonBlank(c.audioIds) ?? taskId }
  if (lane === "url" && audioUrl) return { audioUrl }
  return null
}
