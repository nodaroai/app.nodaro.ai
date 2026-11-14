import { DUBBING_SOURCE_LANGUAGE } from "@nodaro/shared/media"
import type { DubbingLanguage, DubbingStructure } from "@nodaro/shared/media"
import { sameLanguage } from "../../dubbing-language.js"

/**
 * What the dubbing tools answer of a dub's structure.
 *
 * The REST read carries every line of every language at once, which for a long
 * dub is far more than a model should be handed in one answer. The tools answer
 * the dub without its lines first, then the lines of one language a page at a
 * time.
 */

/** How many lines a page holds when the caller names no size. */
export const DUBBING_PAGE_DEFAULT = 50

/** The most lines one page may hold. */
export const DUBBING_PAGE_MAX = 200

export interface DubbingPageRequest {
  readonly offset?: number
  readonly limit?: number
}

interface Page<T> {
  readonly total: number
  readonly offset: number
  /** Where the next page starts; null when this page is the last. */
  readonly nextOffset: number | null
  readonly segments: readonly T[]
}

function pageOf<T>(all: readonly T[], request: DubbingPageRequest): Page<T> {
  const offset = request.offset ?? 0
  const segments = all.slice(offset, offset + (request.limit ?? DUBBING_PAGE_DEFAULT))
  const end = offset + segments.length
  return { total: all.length, offset, nextOffset: end < all.length ? end : null, segments }
}

/** A dub without its lines: each language and the original speech by their count alone. */
export function dubbingOverview(structure: DubbingStructure) {
  return {
    jobId: structure.jobId,
    durationSec: structure.durationSec,
    source: structure.source ? { language: structure.source.language, segmentCount: structure.source.segments.length } : null,
    languages: structure.languages.map((language) => ({
      code: language.code,
      jobId: language.jobId,
      status: language.status,
      segmentCount: language.segments.length,
    })),
    speakers: structure.speakers,
    capabilities: structure.capabilities,
    addLanguage: structure.addLanguage,
  }
}

/** The language of the dub a caller's code names, matched as the captions read matches it. */
export const dubbingLanguageOf = (structure: DubbingStructure, asked: string): DubbingLanguage | undefined =>
  structure.languages.find((entry) => sameLanguage(entry.code, asked))

/**
 * One page of a language's lines, named by the code the dub lists it under. A
 * language still being made, one that failed, or one whose lines the dubbing
 * service does not give has no lines: its page is empty and tells the status.
 */
export function dubbingLanguagePage(structure: DubbingStructure, language: DubbingLanguage, request: DubbingPageRequest) {
  return {
    jobId: structure.jobId,
    language: language.code,
    languageJobId: language.jobId,
    status: language.status,
    ...pageOf(language.segments, request),
  }
}

/** One page of the original speech; its lines are null when the dub does not tell them, as in the structure. */
export function dubbingSourcePage(structure: DubbingStructure, request: DubbingPageRequest) {
  const head = { jobId: structure.jobId, language: DUBBING_SOURCE_LANGUAGE }
  const source = structure.source
  if (source === null) {
    return { ...head, sourceLanguage: null, total: 0, offset: request.offset ?? 0, nextOffset: null, segments: null }
  }
  return { ...head, sourceLanguage: source.language, ...pageOf(source.segments, request) }
}
