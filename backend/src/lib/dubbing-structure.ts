import type {
  DubbingLanguage,
  DubbingLanguageStatus,
  DubbingSegment,
  DubbingSourceSegment,
  DubbingSpeaker,
  DubbingStructure,
} from "@nodaro/shared/media"
import { parseProjectTaskId } from "../providers/elevenlabs/dubbing-project-id.js"
import type { DubbingLine, ProjectLanguageLine, ProjectLine } from "../providers/elevenlabs/dubbing-read.js"
import type { AddLanguageTerms } from "./dubbing-add-terms.js"
import type { FamilyLanguage, ResolvedDubFamily } from "./dubbing-family.js"

/**
 * A dub as a caller reads it, put together from what the dubbing service told.
 * Pure: every read is done before this is called.
 *
 * One shape for both engines. A project dub gives each line an id that is the
 * same in the source and in every language of that project, so its lines pair
 * with the source lines. A regular dub gives its lines no ids: they are
 * numbered in the order told, and are not paired.
 */

/** The original speech as it was read. */
export type SourceLines =
  | { readonly kind: "project"; readonly language: string | null; readonly lines: readonly ProjectLine[] }
  | { readonly kind: "regular"; readonly language: string | null; readonly lines: readonly DubbingLine[] }

/** The lines of one language as they were read. */
export type LanguageLines =
  | { readonly kind: "project"; readonly lines: readonly ProjectLanguageLine[] }
  | { readonly kind: "regular"; readonly lines: readonly DubbingLine[] }

export interface ReadLanguage {
  readonly language: FamilyLanguage
  /** null when its lines were not read: it is not made yet, or the service did not tell them. */
  readonly lines: LanguageLines | null
}

export interface DubbingStructureParts {
  readonly family: ResolvedDubFamily
  /** null when the source lines could not be read. */
  readonly source: SourceLines | null
  /** In the family's order. */
  readonly languages: readonly ReadLanguage[]
  readonly terms: AddLanguageTerms
  /** Whether this deployment lets a dub speak at all. */
  readonly voicesAllowed: boolean
}

/** A line the service gives no id is numbered from 1, in the order it was told. */
const numbered = (index: number): string => String(index + 1)

function sourceSegments(source: SourceLines): DubbingSourceSegment[] {
  if (source.kind === "project") {
    return source.lines.map(({ id, speakerId, start, end, text }) => ({ id, speakerId, start, end, text }))
  }
  return source.lines.map(({ speakerId, start, end, text }, index) => ({ id: numbered(index), speakerId, start, end, text }))
}

/**
 * `sourceIds` are the ids of the source lines this language shares its ids
 * with; null when it shares none (a regular dub, or a language held apart
 * from the source).
 */
function languageSegments(lines: LanguageLines, sourceIds: ReadonlySet<string> | null): DubbingSegment[] {
  if (lines.kind === "regular") {
    return lines.lines.map(({ speakerId, start, end, text }, index) => ({
      id: numbered(index),
      speakerId,
      start,
      end,
      sourceSegmentId: null,
      sourceText: null,
      text,
    }))
  }
  return lines.lines.map(({ id, speakerId, start, end, text, sourceText }) => ({
    id,
    speakerId,
    start,
    end,
    sourceSegmentId: sourceIds?.has(id) ? id : null,
    sourceText,
    text,
  }))
}

/** Whether a language is held in the project the source is read from, so its line ids are the source's. */
function sharesSourceIds(family: ResolvedDubFamily, language: FamilyLanguage): boolean {
  const sourceTask = family.anchor.providerTaskId
  const ref = language.ref
  if (family.engine !== "project" || sourceTask === null || ref === null || ref.kind !== "project") return false
  return parseProjectTaskId(ref.taskId).projectId === parseProjectTaskId(sourceTask).projectId
}

/** A language has lines to read once it is made; one still being made, or one that failed, has none. */
export const languageHasLines = (status: DubbingLanguageStatus): boolean => status === "completed" || status === "stale"

/** The speakers of some lines, in the order they first speak. */
function speakersOf(lines: readonly { readonly speakerId: string | null }[]): DubbingSpeaker[] {
  const counts = new Map<string, number>()
  for (const { speakerId } of lines) {
    if (speakerId !== null) counts.set(speakerId, (counts.get(speakerId) ?? 0) + 1)
  }
  return [...counts].map(([id, segmentCount]) => ({ id, name: null, voice: null, segmentCount }))
}

export function buildDubbingStructure(parts: DubbingStructureParts): DubbingStructure {
  const { family, terms } = parts
  const source =
    parts.source === null
      ? null
      : { language: parts.source.language ?? family.sourceLanguage, segments: sourceSegments(parts.source) }
  const sourceIds = parts.source?.kind === "project" ? new Set(parts.source.lines.map((line) => line.id)) : null

  const languages = parts.languages.map(({ language, lines }): DubbingLanguage => ({
    code: language.code,
    jobId: language.jobId,
    status: language.status,
    segments:
      lines !== null && languageHasLines(language.status)
        ? languageSegments(lines, sharesSourceIds(family, language) ? sourceIds : null)
        : [],
  }))

  // The speakers are told by the source lines; by the first language that has lines when the source has none.
  const spoken =
    source !== null && source.segments.length > 0
      ? source.segments
      : (languages.find((language) => language.segments.length > 0)?.segments ?? [])

  return {
    jobId: family.anchor.id,
    durationSec: family.durationSec,
    source,
    languages,
    speakers: speakersOf(spoken),
    capabilities: {
      editSegments: false,
      regenerate: false,
      setSpeakerVoice: false,
      render: false,
      addLanguage: terms.blocked === null && parts.voicesAllowed,
      captions: true,
    },
    addLanguage: { ...terms.price, creditIdByLanguage: { ...terms.price.creditIdByLanguage } },
  }
}
