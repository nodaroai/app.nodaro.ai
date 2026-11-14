import type { DubbingAddLanguageInput, DubbingAddLanguageResult, DubbingCaptionFormat, DubbingStructure } from "@nodaro/shared/media"
import type { NodaroClientCore } from "../core.js"
import type { DubbingInput } from "./voices.js"

/**
 * Re-export the shared dubbing types so SDK consumers don't have to add
 * `@nodaro/shared` as a second dependency to type a dub's structure. Single
 * source of truth lives in `@nodaro/shared`.
 */
export type {
  DubbingAddLanguageInput,
  DubbingAddLanguagePrice,
  DubbingAddLanguageResult,
  DubbingCapabilities,
  DubbingCaptionFormat,
  DubbingErrorCode,
  DubbingLanguage,
  DubbingLanguageStatus,
  DubbingSegment,
  DubbingSourceSegment,
  DubbingSpeaker,
  DubbingSpeakerVoice,
  DubbingStructure,
} from "@nodaro/shared/media"

/**
 * Dubbing: make a dub, then read what it holds.
 *
 * Mirrors `POST /v1/dubbing` (`backend/src/routes/dubbing.ts`) and the reads of
 * a dub that is already made (`backend/src/routes/dubbing-read.ts`).
 *
 * `create()` starts a dub and answers its job id: poll `jobs.get(jobId)` until
 * it completes. From then on that id reads the dub: `get()` answers its
 * structure (the original lines, every language with its lines, the speakers,
 * what can be done to it now) and `captions()` the caption file of one
 * language, or of the original speech.
 *
 * Only the account that made the dub reads it: anyone else's job id is a
 * `NotFoundError`. The reads are free; an OAuth app needs `assets:read`.
 * `addLanguage()` adds a language to the dub and answers the job that
 * delivers it; it costs credits, and an OAuth app needs `assets:write`.
 *
 * A refusal is a `NodaroError` whose `code` is one of `DubbingErrorCode`
 * (`dubbing_not_ready` while the dub is still being made, `dubbing_failed`,
 * `not_a_dubbing_job`, `dubbing_unavailable`, …), with the HTTP status in
 * `status`; a `404` is a `NotFoundError` that keeps its own `code`.
 */

/** Input for {@link DubbingResource.create}: every option of a dub. The same type as `DubbingInput`, which `voices.dub()` takes. */
export type DubbingCreateInput = DubbingInput

/** Which caption file {@link DubbingResource.captions} exports. */
export interface DubbingCaptionsOptions {
  /**
   * A language code the dub lists (`"es"`, `"pt-BR"`: a `code` of
   * `DubbingStructure.languages`), or `"source"` for the original speech.
   */
  language: string
  /** `"srt"` (SubRip, the default) or `"vtt"` (WebVTT). */
  format?: DubbingCaptionFormat
}

export class DubbingResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * `POST /v1/dubbing` → start a dub of an audio or video file into
   * `targetLanguage`, keeping each speaker's voice. The same call as
   * `voices.dub()`. Costs credits and runs async: poll `jobs.get(jobId)`,
   * then read the dub with `get(jobId)`.
   */
  create(input: DubbingCreateInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/dubbing", { body: input })
  }

  /**
   * `GET /v1/dubbing/:jobId` → the dub's structure. `jobId` is the job the dub
   * was created by, or the job of a language added to it later: both read the
   * same dub. Offer an action only when its flag in `capabilities` is true.
   * Free. Refuses with `dubbing_not_ready` (409) until the dub completes.
   */
  get(jobId: string): Promise<DubbingStructure> {
    return this.client.request<DubbingStructure>("GET", `/v1/dubbing/${encodeURIComponent(jobId)}`)
  }

  /**
   * `GET /v1/dubbing/:jobId/captions` → the captions of one language of the
   * dub, or of its original speech (`language: "source"`), as the text of a
   * SubRip or WebVTT file. A language is exported once its `status` is
   * `completed` or `stale`, as long as the dubbing service gives its
   * captions. Free. Refuses with `dubbing_language_not_found` (404) for a
   * language the dub does not list, `dubbing_language_processing` (409)
   * while that language is still being made, and
   * `dubbing_captions_unavailable` (422) when it has no captions to export:
   * it failed, or the dubbing service does not give them.
   */
  captions(jobId: string, options: DubbingCaptionsOptions): Promise<string> {
    return this.client.requestText("GET", `/v1/dubbing/${encodeURIComponent(jobId)}/captions`, {
      query: { language: options.language, format: options.format },
    })
  }

  /**
   * `POST /v1/dubbing/:jobId/languages` → add a language to a dub that is
   * already made, and answer the job that delivers it: poll `jobs.get(jobId)`
   * until it completes, then `get()` lists the language. `jobId` names the dub
   * as in `get()`. Offer it only where `get(jobId).capabilities.addLanguage` is
   * true. Charged per started minute of the dub, at the price
   * `get(jobId).addLanguage` names. Refuses with `dubbing_language_exists`
   * (409) for a language the dub already has, and with the refusals of `get()`.
   * A dub made from someone else's link takes `confirmationId` again where the
   * deployment asks for one, as `create()` does.
   */
  addLanguage(jobId: string, input: DubbingAddLanguageInput): Promise<DubbingAddLanguageResult> {
    return this.client.request<DubbingAddLanguageResult>("POST", `/v1/dubbing/${encodeURIComponent(jobId)}/languages`, { body: input })
  }
}
