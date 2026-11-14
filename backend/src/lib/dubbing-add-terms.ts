import { unitQuoteCreditId } from "@nodaro/shared/credits"
import type { DubbingAddLanguagePrice } from "@nodaro/shared/media"
import { dubbingMinutes, effectiveDubbedSeconds } from "@nodaro/render-rules"
import { DUBBING_MAX_MINUTES, DUBBING_MODEL_IDENTIFIERS, PROJECT_DUBBING_LANGUAGES, PROJECT_DUBBING_MODEL_ID } from "./dubbing-model.js"
import type { DubEngine } from "./dubbing-family.js"

/**
 * The terms a language is added to a dub on: whether one can be added at all,
 * and what it is charged. Pure: nothing is fetched or measured here.
 *
 * One rule, read twice. The structure of a dub shows it (`capabilities.addLanguage`
 * and the price to look up), and the add-language call refuses by it, so what a
 * caller is shown is what the call then does.
 *
 * The price is told as an id, never as a number: the caller asks
 * `POST /v1/credits/model-costs` for it, which answers the price this account
 * is charged.
 */

/** Why no language can be added to a dub, whatever the language. */
export type AddLanguageBlock = "no_source" | "unknown_length" | "too_long"

export interface AddLanguageTerms {
  /** null when a language can be added. */
  readonly blocked: AddLanguageBlock | null
  readonly price: DubbingAddLanguagePrice
}

const REGULAR_DUBBING_MODEL_ID: string = DUBBING_MODEL_IDENTIFIERS[0]

const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const positive = (value: unknown): number | undefined => {
  const number = finite(value)
  return number !== undefined && number > 0 ? number : undefined
}

const stored = (value: unknown): boolean => typeof value === "string" && value.trim() !== ""

/**
 * The seconds an added language is charged for: the longer of the span the
 * dub itself was charged for when it was measured and the length the dubbing
 * service holds, cut to the dub's start/end window. The service dubs what it
 * holds, so a language is never charged for less. `undefined` when neither is
 * known.
 */
export function dubBillableSeconds(anchorInput: Readonly<Record<string, unknown>>, providerDurationSec: number | null): number | undefined {
  const measured = positive(anchorInput.probedDurationSec)
  const held = positive(effectiveDubbedSeconds(positive(providerDurationSec), finite(anchorInput.startTime), finite(anchorInput.endTime)))
  if (measured === undefined) return held
  return held === undefined ? measured : Math.max(measured, held)
}

const NO_PRICE: DubbingAddLanguagePrice = { billableMinutes: null, creditId: null, creditIdByLanguage: {} }

function priceOf(engine: DubEngine, minutes: number | undefined): DubbingAddLanguagePrice {
  if (minutes === undefined) return NO_PRICE
  if (minutes > DUBBING_MAX_MINUTES) return { billableMinutes: minutes, creditId: null, creditIdByLanguage: {} }
  if (engine === "project") {
    // A language added to a project dub is charged on the project's row, whatever language it speaks.
    return { billableMinutes: minutes, creditId: unitQuoteCreditId(PROJECT_DUBBING_MODEL_ID, minutes), creditIdByLanguage: {} }
  }
  return {
    billableMinutes: minutes,
    creditId: unitQuoteCreditId(REGULAR_DUBBING_MODEL_ID, minutes),
    creditIdByLanguage: Object.fromEntries(
      PROJECT_DUBBING_LANGUAGES.map((code) => [code, unitQuoteCreditId(PROJECT_DUBBING_MODEL_ID, minutes)]),
    ),
  }
}

/**
 * A dub made by the project engine takes a language into the same project, so
 * its media is not sent again, but the new job is told which kind of media it
 * delivers by the upload the dub was made from. A dub made by the regular
 * engine is dubbed afresh from its source, which is measured again there, so
 * its length need not be known here.
 */
function blockOf(engine: DubEngine, input: Readonly<Record<string, unknown>>, minutes: number | undefined): AddLanguageBlock | null {
  const upload = stored(input.audioUrl) || stored(input.videoUrl)
  if (engine === "project" ? !upload : !upload && !stored(input.sourceUrl)) return "no_source"
  if (minutes !== undefined && minutes > DUBBING_MAX_MINUTES) return "too_long"
  if (engine === "project" && minutes === undefined) return "unknown_length"
  return null
}

export function addLanguageTerms(
  anchorInput: Readonly<Record<string, unknown>>,
  engine: DubEngine,
  providerDurationSec: number | null,
): AddLanguageTerms {
  const seconds = dubBillableSeconds(anchorInput, providerDurationSec)
  const minutes = seconds === undefined ? undefined : dubbingMinutes(seconds)
  return { blocked: blockOf(engine, anchorInput, minutes), price: priceOf(engine, minutes) }
}
