/**
 * Dubbing structure — the wire contract of a dub read back by its job id
 * (`GET /v1/dubbing/:jobId`), and of the captions export beside it
 * (`GET /v1/dubbing/:jobId/captions`).
 *
 * One shape whichever engine made the dub, so a client is written once. A
 * field an engine does not tell is null, never absent:
 *   - `sourceSegmentId` names the source line a language's line translates.
 *     It is null where the dub's lines carry no link to the source lines; the
 *     two lists are then read side by side, by time.
 *   - `sourceText` is the original text a line translates, as the dub keeps
 *     it beside the line; null where the dub keeps none. Each of the two is
 *     told on its own: a line can carry `sourceText` and no `sourceSegmentId`.
 *   - a speaker's `name` and `voice` are null until they can be read.
 *
 * `capabilities` says what can be done to this dub now. A client offers an
 * action only when its capability is true.
 */

/** The caption file formats a dub exports. */
export const DUBBING_CAPTION_FORMATS = ["srt", "vtt"] as const
export type DubbingCaptionFormat = (typeof DUBBING_CAPTION_FORMATS)[number]

/** The `language` value that names the original speech in a captions request. */
export const DUBBING_SOURCE_LANGUAGE = "source"

/**
 * Where a language of a dub stands:
 *   - `processing`: being made; its lines are not readable yet.
 *   - `completed`: it is made; its lines and captions are readable where the dubbing service gives them.
 *   - `stale`: its lines changed after its media was last made.
 *   - `failed`: it was not made.
 */
export const DUBBING_LANGUAGE_STATUSES = ["processing", "completed", "stale", "failed"] as const
export type DubbingLanguageStatus = (typeof DUBBING_LANGUAGE_STATUSES)[number]

/** One line of the original speech. Times are seconds from the start of the media. */
export interface DubbingSourceSegment {
  /** Unique within the source lines. */
  id: string
  speakerId: string | null
  start: number
  end: number
  text: string
}

/** One line of a dubbed language. Times are seconds from the start of the media. */
export interface DubbingSegment {
  /** Unique within this language's lines. */
  id: string
  speakerId: string | null
  start: number
  end: number
  /**
   * The `id` of the source line this one translates; null where the dub's
   * lines carry no link to the source lines.
   */
  sourceSegmentId: string | null
  /**
   * The original text this line translates, as the dub keeps it beside the
   * line; null where it keeps none. It can be told where `sourceSegmentId` is
   * null.
   */
  sourceText: string | null
  text: string
}

/** One language a dub speaks. */
export interface DubbingLanguage {
  /** The language code the dub was asked for (`es`, `pt-BR`); unique within a dub. */
  code: string
  /**
   * The job whose result is this language's dubbed media. null when the
   * language was made but no job of the account holds its media: adding the
   * language again delivers it, unless its status is `stale` (its lines
   * changed after its media was made), when adding it is refused.
   */
  jobId: string | null
  status: DubbingLanguageStatus
  /** Empty unless `status` is `completed` or `stale`, and where the dubbing service does not give the language's lines. */
  segments: DubbingSegment[]
}

/** The voice a speaker is dubbed in. */
export interface DubbingSpeakerVoice {
  id: string
  name: string | null
  previewUrl: string | null
}

/** One speaker the dub tells apart. */
export interface DubbingSpeaker {
  /** The `speakerId` its lines carry. */
  id: string
  name: string | null
  voice: DubbingSpeakerVoice | null
  /** How many source lines the speaker has (lines of the first language when the source is not readable). */
  segmentCount: number
}

/** What can be done to a dub now. */
export interface DubbingCapabilities {
  /** Change a line's text. */
  editSegments: boolean
  /** Make chosen lines again. */
  regenerate: boolean
  /** Replace a speaker's voice. */
  setSpeakerVoice: boolean
  /** Render the media again after edits. */
  render: boolean
  /** Add a target language (`POST /v1/dubbing/:jobId/languages`). */
  addLanguage: boolean
  /** Export captions (`GET /v1/dubbing/:jobId/captions`). */
  captions: boolean
}

/**
 * What adding a language to this dub is charged. The price is the answer of
 * `POST /v1/credits/model-costs` for `creditIdByLanguage[language] ?? creditId`.
 */
export interface DubbingAddLanguagePrice {
  /** Whole minutes an added language is charged for; null when the length is only known once it runs. */
  billableMinutes: number | null
  /** The price id of an added language; null with `billableMinutes`. */
  creditId: string | null
  /** The languages priced by another id than `creditId`, by lowercase language code. */
  creditIdByLanguage: Record<string, string>
}

/** `GET /v1/dubbing/:jobId`. */
export interface DubbingStructure {
  /** The job the dub was created by. Languages added later hang off it. */
  jobId: string
  /** Seconds of media the dub covers; null when not known. */
  durationSec: number | null
  /** The original speech; null when its lines are not readable. */
  source: { language: string | null; segments: DubbingSourceSegment[] } | null
  languages: DubbingLanguage[]
  speakers: DubbingSpeaker[]
  capabilities: DubbingCapabilities
  addLanguage: DubbingAddLanguagePrice
}

/** `POST /v1/dubbing/:jobId/languages` request. */
export interface DubbingAddLanguageInput {
  /** The language to add (`es`, `pt-BR`). */
  targetLanguage: string
  /** The rights confirmation, when the dub was made from a link the deployment asks one for. */
  confirmationId?: string
}

/** `POST /v1/dubbing/:jobId/languages` response: the job that delivers the added language. */
export interface DubbingAddLanguageResult {
  jobId: string
}

/**
 * The error codes the dubbing reads and the add-language call answer beside
 * the platform's own (`not_found`, `unauthorized`, `validation_error`). Each
 * is the `error.code` of the response body.
 */
export const DUBBING_ERROR_CODES = [
  /** 422: the job is not a dub. */
  "not_a_dubbing_job",
  /** 409: the dub is still being made. */
  "dubbing_not_ready",
  /** 422: the dub was not made. */
  "dubbing_failed",
  /** 410: the dub is no longer held where it was made. */
  "dubbing_unavailable",
  /** 404: the dub has no such language. */
  "dubbing_language_not_found",
  /** 409: that language is still being made. */
  "dubbing_language_processing",
  /** 422: that language has no captions to export. */
  "dubbing_captions_unavailable",
  /** 409: the dub already speaks that language. */
  "dubbing_language_exists",
  /** 422: the length of the dub cannot be read, so a language cannot be priced. */
  "unreadable_dubbing_source",
  /** 413: the dub is longer than 30 minutes, so a language cannot be added to it. */
  "media_duration_exceeds_limit",
  /** 502: the dubbing service did not answer. */
  "dubbing_read_failed",
] as const
export type DubbingErrorCode = (typeof DUBBING_ERROR_CODES)[number]
