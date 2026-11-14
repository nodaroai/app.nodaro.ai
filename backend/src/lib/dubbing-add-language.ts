import { addLanguageTerms, dubBillableSeconds, type AddLanguageBlock } from "./dubbing-add-terms.js"
import type { ResolvedDubFamily } from "./dubbing-family.js"
import { sameLanguage } from "./dubbing-language.js"
import { DUBBING_PROBLEMS, dubbingAnswer, dubbingRefusal, type DubbingOutcome, type DubbingProblem } from "./dubbing-problems.js"

/**
 * What adding a language to a dub that is already made comes to, decided from
 * the dub as the dubbing service holds it now (lib/dubbing-family.ts). Pure:
 * nothing is fetched, written or charged here.
 *
 * A project dub takes the language into the same project: nothing is uploaded
 * again, and the language is charged on the project's row for the dub's own
 * length, the price its structure shows (lib/dubbing-add-terms.ts). A language
 * the project already holds with no job of ours delivering it is delivered
 * instead of made again. A regular dub holds one language, so the language is
 * a dub of its own: the same source, the same settings, the new language,
 * filed and measured as the create call files and measures a dub.
 */

/** The upload a project dub was made from. Its new language is delivered as the same kind of media. */
export interface DubUpload {
  readonly videoUrl?: string
  readonly audioUrl?: string
}

export type AddLanguagePlan =
  | {
      readonly engine: "project"
      readonly familyId: string
      readonly targetLanguage: string
      /** The seconds the language is charged for: the dub's own. */
      readonly seconds: number
      /** The stored id of the project the language joins. */
      readonly projectTaskId: string
      /** A language the project holds and no job delivers: delivered instead of a new one. */
      readonly adoptLanguageId: string | null
      readonly upload: DubUpload
    }
  | {
      readonly engine: "regular"
      readonly familyId: string
      /** The create call's body for a dub of the same source, with the same settings, into the new language. */
      readonly createBody: Readonly<Record<string, unknown>>
    }

export interface AddLanguageRequest {
  readonly targetLanguage: string
  /** The rights confirmation a dub made from a link takes again. */
  readonly confirmationId?: string
}

/** The settings a regular dub's job keeps that a dub of its source into another language is made with again. */
const CREATE_SETTINGS = [
  "sourceLanguage",
  "numSpeakers",
  "disableVoiceCloning",
  "dropBackgroundAudio",
  "startTime",
  "endTime",
  "highestResolution",
  "useProfanityFilter",
  "targetAccent",
  "watermark",
] as const

const BLOCKED: Readonly<Record<AddLanguageBlock, DubbingProblem>> = {
  no_source: DUBBING_PROBLEMS.unreadableSource,
  unknown_length: DUBBING_PROBLEMS.unreadableSource,
  too_long: DUBBING_PROBLEMS.tooLong,
}

const stored = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""

/** The upload a dub was made from: the video, else the audio, as the run that made it chose. */
function uploadOf(input: Readonly<Record<string, unknown>>): DubUpload {
  if (stored(input.videoUrl)) return { videoUrl: input.videoUrl }
  return stored(input.audioUrl) ? { audioUrl: input.audioUrl } : {}
}

/**
 * The one source a dub was made from, in the order the run that made it chose
 * (payload-builder's `dubbing` case): a link the service fetched, else the
 * upload. A workflow's job can keep a wired upload beside a link it did not
 * use, and a dub is made from exactly one source.
 */
function sourceOf(input: Readonly<Record<string, unknown>>): DubUpload & { readonly sourceUrl?: string } {
  return stored(input.sourceUrl) ? { sourceUrl: input.sourceUrl } : uploadOf(input)
}

function createBodyOf(input: Readonly<Record<string, unknown>>, request: AddLanguageRequest): Record<string, unknown> {
  const settings = CREATE_SETTINGS.flatMap((key) => (input[key] === undefined || input[key] === null ? [] : [[key, input[key]] as const]))
  return {
    ...sourceOf(input),
    ...Object.fromEntries(settings),
    targetLanguage: request.targetLanguage,
    ...(request.confirmationId ? { confirmationId: request.confirmationId } : {}),
  }
}

export function planAddLanguage(family: ResolvedDubFamily, request: AddLanguageRequest): DubbingOutcome<AddLanguagePlan> {
  const { anchor, engine, familyId } = family
  const terms = addLanguageTerms(anchor.input, engine, family.durationSec)
  if (terms.blocked !== null) return dubbingRefusal(BLOCKED[terms.blocked])

  // A language a job delivers, or is making, is the dub's already, and so is
  // one the project holds whose lines changed after its media was made: there
  // is no media of it to deliver. One that failed is free to be made again.
  const held = family.languages.find((language) => sameLanguage(language.code, request.targetLanguage))
  const live = held !== undefined && held.status !== "failed" ? held : undefined
  if (live !== undefined && (live.jobId !== null || live.status === "stale")) return dubbingRefusal(DUBBING_PROBLEMS.languageExists)

  if (engine === "regular") return dubbingAnswer({ engine, familyId, createBody: createBodyOf(anchor.input, request) })

  const seconds = dubBillableSeconds(anchor.input, family.durationSec)
  const projectTaskId = anchor.providerTaskId
  // Both are known for a dub the terms let through; told apart here for the types.
  if (seconds === undefined || projectTaskId === null) return dubbingRefusal(DUBBING_PROBLEMS.unreadableSource)
  return dubbingAnswer({
    engine,
    familyId,
    targetLanguage: request.targetLanguage,
    seconds,
    projectTaskId,
    adoptLanguageId: live?.ref?.kind === "project" ? live.ref.languageId : null,
    upload: uploadOf(anchor.input),
  })
}
