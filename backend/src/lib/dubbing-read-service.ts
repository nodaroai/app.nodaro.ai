import type { DubbingCaptionFormat, DubbingStructure } from "@nodaro/shared/media"
import {
  REGULAR_SOURCE_TRANSCRIPT,
  readProjectLanguageLines,
  readProjectSource,
  readProjectSubtitles,
  readRegularCaptions,
  readRegularDub,
  readRegularTranscript,
  type DubbingRead,
} from "../providers/elevenlabs/dubbing-read.js"
import { addLanguageTerms } from "./dubbing-add-terms.js"
import { cuesToCaptions, linesToCues, vttToCues } from "./dubbing-captions.js"
import {
  DubbingServiceError,
  askService,
  resolveDubFamily,
  type FamilyLanguage,
  type LanguageRef,
  type ResolvedDubFamily,
} from "./dubbing-family.js"
import { loadDubFamily } from "./dubbing-job-store.js"
import { asksForSource, sameLanguage } from "./dubbing-language.js"
import { DUBBING_PROBLEMS, dubbingAnswer, dubbingRefusal, type DubbingOutcome, type DubbingProblem } from "./dubbing-problems.js"
import {
  buildDubbingStructure,
  languageHasLines,
  type LanguageLines,
  type ReadLanguage,
  type SourceLines,
} from "./dubbing-structure.js"
import { judgeUnnamedVoices } from "./voice-policy.js"

/**
 * What a caller reads of a dub that is already made: its structure, and its
 * captions.
 *
 * Every read starts the same way: the caller's own job is found, the family
 * of that dub is resolved, and only then is the dubbing service asked for
 * lines. A dub the caller may not read, or one that cannot be read now, is
 * answered with a refusal (lib/dubbing-problems.ts). A failure of the dubbing
 * service is answered as one too; a failure of ours is thrown.
 */

/**
 * Finds the caller's dub and hands its family to `read`. Answers the refusal
 * instead when there is no such dub, when it cannot be read now, or when the
 * dubbing service fails at any point of the read.
 */
export async function withDubFamily<T>(
  ownerId: string,
  jobId: string,
  read: (family: ResolvedDubFamily) => Promise<DubbingOutcome<T>>,
): Promise<DubbingOutcome<T>> {
  const load = await loadDubFamily(ownerId, jobId)
  if (load.kind === "not_found") return dubbingRefusal(DUBBING_PROBLEMS.notFound)
  if (load.kind === "not_a_dubbing_job") return dubbingRefusal(DUBBING_PROBLEMS.notADub)
  try {
    const resolved = await resolveDubFamily(load.family)
    return resolved.ok ? await read(resolved.value) : resolved
  } catch (error) {
    if (error instanceof DubbingServiceError) return dubbingRefusal(DUBBING_PROBLEMS.readFailed, error.reason)
    throw error
  }
}

/** The original speech; null when the dubbing service does not tell it. */
async function sourceOf(family: ResolvedDubFamily): Promise<SourceLines | null> {
  const taskId = family.anchor.providerTaskId
  if (taskId === null) return null
  if (family.engine === "project") {
    const read = await askService(() => readProjectSource(taskId))
    return read.kind === "ok" ? { kind: "project", language: read.value.language, lines: read.value.lines } : null
  }
  const read = await askService(() => readRegularTranscript(taskId, REGULAR_SOURCE_TRANSCRIPT))
  return read.kind === "ok" ? { kind: "regular", language: read.value.language, lines: read.value.lines } : null
}

type ProjectRef = Extract<LanguageRef, { readonly kind: "project" }>
type RegularRef = Extract<LanguageRef, { readonly kind: "regular" }>

/**
 * Reads one language of a regular dub. It is asked for by the code its job
 * was given; the dubbing service may hold the language under its own spelling
 * of that code, so a read it does not know is tried once more under the code
 * the dub itself tells.
 */
async function withRegularCode<T>(ref: RegularRef, read: (code: string) => Promise<DubbingRead<T>>): Promise<DubbingRead<T>> {
  const first = await askService(() => read(ref.code))
  if (first.kind === "ok" || first.kind === "processing") return first
  const dub = await askService(() => readRegularDub(ref.dubbingId))
  const held = dub.kind === "ok" ? dub.value.targetLanguages[0] : undefined
  if (held === undefined || held === ref.code) return first
  return askService(() => read(held))
}

/** The lines of one language; null when it has none to read, or the dubbing service does not tell them. */
async function linesOf(language: FamilyLanguage): Promise<LanguageLines | null> {
  const ref = language.ref
  if (ref === null || !languageHasLines(language.status)) return null
  if (ref.kind === "project") {
    const read = await askService(() => readProjectLanguageLines(ref.taskId, ref.languageId))
    return read.kind === "ok" ? { kind: "project", lines: read.value } : null
  }
  const read = await withRegularCode(ref, (code) => readRegularTranscript(ref.dubbingId, code))
  return read.kind === "ok" ? { kind: "regular", lines: read.value.lines } : null
}

/** Runs `run` over the items a few at a time, and answers in the items' order. */
async function inTurns<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const head = await Promise.all(items.slice(0, size).map(run))
  return [...head, ...(await inTurns(items.slice(size), size, run))]
}

/** How many languages are read from the dubbing service at once. */
const READS_AT_ONCE = 4

function languagesOf(family: ResolvedDubFamily): Promise<ReadLanguage[]> {
  return inTurns(family.languages, READS_AT_ONCE, async (language) => ({ language, lines: await linesOf(language) }))
}

/** A dub as its owner reads it: the original speech, every language, the speakers, and what can be done to it. */
export function readDubbingStructure(ownerId: string, jobId: string): Promise<DubbingOutcome<DubbingStructure>> {
  return withDubFamily(ownerId, jobId, async (family) => {
    const [source, languages] = await Promise.all([sourceOf(family), languagesOf(family)])
    return dubbingAnswer(
      buildDubbingStructure({
        family,
        source,
        languages,
        terms: addLanguageTerms(family.anchor.input, family.engine, family.durationSec),
        voicesAllowed: judgeUnnamedVoices().allowed,
      }),
    )
  })
}

type Refused = Exclude<DubbingRead<unknown>, { readonly kind: "ok" }>

/** A read that is still being made is told as such; any other refusal means there are no captions to read. */
const refuseCaptions = (read: Refused, whileProcessing: DubbingProblem): DubbingOutcome<never> =>
  dubbingRefusal(read.kind === "processing" ? whileProcessing : DUBBING_PROBLEMS.captionsUnavailable)

async function sourceCaptions(family: ResolvedDubFamily, format: DubbingCaptionFormat): Promise<DubbingOutcome<string>> {
  const taskId = family.anchor.providerTaskId
  if (taskId === null) return dubbingRefusal(DUBBING_PROBLEMS.captionsUnavailable)
  if (family.engine === "regular") {
    const read = await askService(() => readRegularCaptions(taskId, REGULAR_SOURCE_TRANSCRIPT, format))
    return read.kind === "ok" ? dubbingAnswer(read.value) : refuseCaptions(read, DUBBING_PROBLEMS.notReady)
  }
  const read = await askService(() => readProjectSource(taskId))
  return read.kind === "ok"
    ? dubbingAnswer(cuesToCaptions(linesToCues(read.value.lines), format))
    : refuseCaptions(read, DUBBING_PROBLEMS.notReady)
}

/**
 * The captions file a project language keeps; null when it cannot be had,
 * whatever the reason. The file is the better telling of the captions, never
 * the only one: the language's lines make them as well.
 */
async function keptCaptions(ref: ProjectRef): Promise<DubbingRead<string> | null> {
  try {
    return await readProjectSubtitles(ref.taskId, ref.languageId)
  } catch {
    return null
  }
}

/**
 * A project language keeps its captions as a WebVTT file. Its cues are read
 * and written again in the format asked for, so both formats say the same
 * cues, in the shape captions made from lines have. When the language keeps
 * no file, or the file says nothing, the captions are made from its lines.
 */
async function projectCaptions(ref: ProjectRef, format: DubbingCaptionFormat): Promise<DubbingOutcome<string>> {
  const file = await keptCaptions(ref)
  if (file?.kind === "processing") return dubbingRefusal(DUBBING_PROBLEMS.languageProcessing)
  if (file?.kind === "ok") {
    const cues = vttToCues(file.value)
    if (cues.length > 0) return dubbingAnswer(cuesToCaptions(cues, format))
  }
  const lines = await askService(() => readProjectLanguageLines(ref.taskId, ref.languageId))
  return lines.kind === "ok"
    ? dubbingAnswer(cuesToCaptions(linesToCues(lines.value), format))
    : refuseCaptions(lines, DUBBING_PROBLEMS.languageProcessing)
}

async function languageCaptions(
  family: ResolvedDubFamily,
  asked: string,
  format: DubbingCaptionFormat,
): Promise<DubbingOutcome<string>> {
  const language = family.languages.find((entry) => sameLanguage(entry.code, asked))
  if (!language) return dubbingRefusal(DUBBING_PROBLEMS.languageNotFound)
  if (language.status === "processing") return dubbingRefusal(DUBBING_PROBLEMS.languageProcessing)
  const ref = language.ref
  if (ref === null || !languageHasLines(language.status)) return dubbingRefusal(DUBBING_PROBLEMS.captionsUnavailable)
  if (ref.kind === "project") return projectCaptions(ref, format)
  const read = await withRegularCode(ref, (code) => readRegularCaptions(ref.dubbingId, code, format))
  return read.kind === "ok" ? dubbingAnswer(read.value) : refuseCaptions(read, DUBBING_PROBLEMS.languageProcessing)
}

/**
 * The captions of one language of a dub, as a file's text. `language` is a
 * code the dub's structure lists, or `source` for the original speech.
 */
export function readDubbingCaptions(
  ownerId: string,
  jobId: string,
  asked: { readonly language: string; readonly format: DubbingCaptionFormat },
): Promise<DubbingOutcome<string>> {
  return withDubFamily(ownerId, jobId, (family) =>
    asksForSource(asked.language)
      ? sourceCaptions(family, asked.format)
      : languageCaptions(family, asked.language, asked.format),
  )
}
