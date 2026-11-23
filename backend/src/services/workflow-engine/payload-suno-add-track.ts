/**
 * The job of a Suno Add Vocals / Add Instrumental node in a server-run
 * workflow (decided 2026-11-23): the song (a wired audio's file, and a wired
 * Suno track's ids beside it), the version and the person's direction from
 * the node's settings. The worker resolves what is missing by the route's rule
 * (`lib/suno-add-track-source.ts`): the file from the ids, the style from the
 * original song.
 */
import { SUNO_MODELS } from "@nodaro/shared/models"
import { sunoAddTrackTextProblem } from "../../providers/kie/suno-add-track.js"
import type { ResolvedInputs } from "./types.js"

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

export interface SunoAddTrackPayloadArgs {
  readonly jobId: string
  readonly data: Record<string, unknown>
  readonly resolvedInputs: ResolvedInputs
  /** Add Vocals: the lyrics or direction (a wired prompt first); undefined on Add Instrumental. */
  readonly prompt?: string
  readonly usageLogId?: string
}

/**
 * A node's Suno version as it is judged and sent: any Suno version passes on
 * as written, so the deployment's model rules judge it (a version the
 * deployment withholds is refused before anything is held, as on every Suno
 * node); a value that is no Suno version at all (empty, or written by an API
 * client) is left to the default.
 */
const modelOf = (v: unknown): string | undefined =>
  typeof v === "string" && (SUNO_MODELS as readonly string[]).includes(v) ? v : undefined

/**
 * Why the node's words cannot be sent, before anything is held: a text over
 * the provider's limit (the route's schema holds the same limits). Null when
 * they can. Refused, never cut.
 */
export function sunoAddTrackPayloadProblem(args: Pick<SunoAddTrackPayloadArgs, "data" | "prompt">): string | null {
  return sunoAddTrackTextProblem({
    prompt: text(args.prompt),
    style: text(args.data.style),
    negativeTags: text(args.data.negativeTags),
  })
}

/** The payload, or undefined when the node has no song to work on. */
export function sunoAddTrackPayload(args: SunoAddTrackPayloadArgs): Record<string, unknown> | undefined {
  const { data, resolvedInputs } = args
  const uploadUrl = text(resolvedInputs.audioUrl) ?? text(resolvedInputs.uploadUrl) ?? text(data.uploadUrl)
  const taskId = text(resolvedInputs.sunoTaskId) ?? text(data.taskId)
  const audioId = text(resolvedInputs.sunoTrackId) ?? text(data.audioId)
  const ids = taskId && audioId ? { taskId, audioId } : undefined
  if (!uploadUrl && !ids) return undefined
  const vocalGender = data.vocalGender === "male" || data.vocalGender === "female" ? data.vocalGender : undefined
  return {
    jobId: args.jobId,
    ...(ids ?? {}),
    ...(uploadUrl ? { uploadUrl } : {}),
    ...(modelOf(data.model) ? { model: modelOf(data.model) } : {}),
    ...(text(args.prompt) ? { prompt: args.prompt } : {}),
    ...(text(data.style) ? { style: data.style } : {}),
    ...(text(data.title) ? { title: data.title } : {}),
    ...(text(data.negativeTags) ? { negativeTags: data.negativeTags } : {}),
    ...(vocalGender ? { vocalGender } : {}),
    ...(num(data.styleWeight) !== undefined ? { styleWeight: data.styleWeight } : {}),
    ...(num(data.weirdnessConstraint) !== undefined ? { weirdnessConstraint: data.weirdnessConstraint } : {}),
    ...(num(data.audioWeight) !== undefined ? { audioWeight: data.audioWeight } : {}),
    usageLogId: args.usageLogId,
  }
}
