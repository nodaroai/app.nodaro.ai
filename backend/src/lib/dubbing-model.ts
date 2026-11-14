import { DUBBING_MAX_SPAN_MINUTES } from "@nodaro/render-rules"

/** Every per-minute row a dub is charged on: the dubbing API's, and the separately priced project API's. */
export const DUBBING_MODEL_IDENTIFIERS = ["elevenlabs-dubbing", "elevenlabs-dubbing-v2"] as const

/** The row of a dub made on the project API, whatever language it speaks. */
export const PROJECT_DUBBING_MODEL_ID: string = DUBBING_MODEL_IDENTIFIERS[1]

/** The target languages only the project API dubs into (lowercase). */
export const PROJECT_DUBBING_LANGUAGES: readonly string[] = ["he", "heb"]

/** The longest span a dub may cover, in whole minutes (the route refuses longer). */
export const DUBBING_MAX_MINUTES = DUBBING_MAX_SPAN_MINUTES

/** Hebrew requires the separately priced project API. Keep dispatch and billing aligned. */
export function dubbingModelIdentifier(targetLanguage: unknown): string {
  return typeof targetLanguage === "string" && PROJECT_DUBBING_LANGUAGES.includes(targetLanguage.toLowerCase())
    ? PROJECT_DUBBING_MODEL_ID : DUBBING_MODEL_IDENTIFIERS[0]
}

/** True when a dub into this language runs on the project API (Hebrew). */
export function dubsAsProject(targetLanguage: unknown): boolean {
  return dubbingModelIdentifier(targetLanguage) === PROJECT_DUBBING_MODEL_ID
}

/**
 * The row a STORED dub is charged on. A language added to a project dub runs
 * on the project API whatever it speaks, so the server stamps the row on the
 * job it creates for it (`dubbingModelId`); a job with no stamp is charged by
 * its target language, as every dub was before.
 *
 * Ask it only of what the server itself wrote: a job's `input_data`, a queue
 * payload. A create request's own body is never asked. There the language
 * alone decides, so a caller cannot name the cheaper row for the dearer dub.
 */
export function dubbingModelIdOfRequest(request: unknown): string {
  const record = request !== null && typeof request === "object" ? (request as Record<string, unknown>) : {}
  const stamped = record.dubbingModelId
  return typeof stamped === "string" && (DUBBING_MODEL_IDENTIFIERS as readonly string[]).includes(stamped)
    ? stamped
    : dubbingModelIdentifier(record.targetLanguage)
}

/** The project API takes an uploaded audio or video file only, never a link the service fetches. */
export const PROJECT_DUBBING_NEEDS_UPLOAD = "Hebrew dubbing requires an uploaded audio or video file. Import the video first."

/**
 * What a dub answers under a voice lock (B4c): a dub speaks in clones of its
 * source's speakers, or in voices the service picks, so none is a voice the
 * deployment can vouch for, and the lock refuses it (`judgeUnnamedVoices`, with
 * the lock's code). One sentence for the route, the workflow and the worker.
 */
export const DUBBING_VOICE_LOCK_MESSAGE = "Dubbing is not available on this deployment."
