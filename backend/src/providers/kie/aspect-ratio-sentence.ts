/**
 * The sentences a person reads when a model does not take an aspect ratio, or a
 * picture's shape. Pure: the provider's own words and the request's facts in,
 * the sentence out.
 *
 *  - A ratio the model refused: the ratio that was chosen, and the ratios the
 *    model takes when its words list them ("aspect_ratio must be one of 16:9,
 *    9:16"). A chosen ratio is named only as a person picks one ("3:2"); a
 *    request's own spelling of it ("landscape_16_9", "1536x1024") never is.
 *  - A range in the provider's words ("between 1:4 and 4:1") is the shape of
 *    a picture the model takes, never a list: when the chosen ratio falls
 *    inside it, or none is known, the sentence is about the picture.
 *  - A picture too wide or too tall for the model (our own check, before
 *    anything is sent): its size and the range of shapes the model takes. No
 *    ratio setting would make that picture fit, so the advice is to crop it.
 */

/** A ratio as a person picks one: digits, a colon, digits, neither side zero. */
const PLAIN_RATIO_RE = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/
/** A whole-number ratio inside a sentence: never part of a decimal ("1:2.5", "2.5:1") or a clock time ("12:30:45"). */
const RATIO_IN_TEXT = String.raw`(?<![\d:]|\d\.)[1-9]\d{0,2}:[1-9]\d{0,2}(?![\d:]|\.\d)`
const RATIO_TOKEN_RE = new RegExp(RATIO_IN_TEXT, "g")
/** "between 1:4 and 4:1", "from 1:3 to 3:1": a range of shapes. */
const RANGE_RE = new RegExp(String.raw`\b(?:between|from)\s+(${RATIO_IN_TEXT})\s+(?:and|to)\s+(${RATIO_IN_TEXT})`, "i")
/** Where a provider's sentence starts to list the ratios the model takes. */
const ACCEPTED_LIST_CUE_RE =
  /\bone of\b|\bonly supports?\b|\bsupports only\b|\b(?:must|should) be\b|\b(?:supported|allowed|valid|accepted) (?:values|ratios|options|aspect ratios)\b|\boptions are\b|\bexpected\b/i
/** What may stand between two ratios of one list: spaces, punctuation, brackets, "or", "and". */
const LIST_SEPARATOR_RE = /^(?:[\s,/|'"()[\]]|\bor\b|\band\b)*$/i
/** The ratio the request was sent, after its own cue: "value: 3:2", "got 3:2", "aspect_ratio=3:2". */
const SENT_CUE_RE = new RegExp(
  String.raw`(?:\b(?:value|got|received|provided|given)\b\s*:?|=)\s*["'[(]?\s*(${RATIO_IN_TEXT})`,
  "i",
)

/** The ratio when `value` is one as a person picks it ("3:2"), else null. */
export function plainRatio(value: unknown): string | null {
  if (typeof value !== "string") return null
  const ratio = value.trim()
  return PLAIN_RATIO_RE.test(ratio) ? ratio : null
}

/**
 * The ratio a request to the model asked for: its `aspect_ratio` (or
 * `aspectRatio`) when plain. `null` for a request in hand that names none a
 * person picks ("auto", "landscape_16_9"); `undefined` when no request is in
 * hand.
 */
export function requestedAspectRatioOf(input: Record<string, unknown> | null | undefined): string | null | undefined {
  if (!input) return undefined
  return plainRatio(input.aspect_ratio) ?? plainRatio(input.aspectRatio)
}

export interface AspectRatioWords {
  /** The ratios the model takes, when the words list them. */
  readonly accepted: string[] | null
  /** The ratio the words say the request was sent. */
  readonly sent: string | null
  /** The range of shapes the words name, when they name one instead of a list. */
  readonly range: { readonly low: string; readonly high: string } | null
}

/** The run of ratios that starts at the first one after `from`, joined by separators only. */
function listAfter(text: string, from: number): string[] | null {
  const tokens = [...text.matchAll(RATIO_TOKEN_RE)].filter((m) => (m.index ?? 0) >= from)
  if (tokens.length === 0) return null
  const ratios = [tokens[0]![0]]
  let end = (tokens[0]!.index ?? 0) + tokens[0]![0].length
  for (const token of tokens.slice(1)) {
    if (!LIST_SEPARATOR_RE.test(text.slice(end, token.index))) break
    ratios.push(token[0])
    end = (token.index ?? 0) + token[0].length
  }
  return [...new Set(ratios)]
}

/** What the provider's words say about the ratio: a list the model takes, the ratio it was sent, or a range. */
export function aspectRatioWordsOf(providerWords: string): AspectRatioWords {
  const range = RANGE_RE.exec(providerWords)
  if (range) return { accepted: null, sent: null, range: { low: range[1]!, high: range[2]! } }
  const cue = ACCEPTED_LIST_CUE_RE.exec(providerWords)
  const accepted = cue ? listAfter(providerWords, cue.index + cue[0].length) : null
  const explicit = SENT_CUE_RE.exec(providerWords)?.[1] ?? null
  const outside = [...(cue ? providerWords.slice(0, cue.index) : providerWords).matchAll(RATIO_TOKEN_RE)].map((m) => m[0])
  const sent = explicit ?? (outside.length === 1 ? outside[0]! : null)
  return { accepted, sent, range: null }
}

/** Ratios as a sentence reads them: "16:9", "16:9 and 9:16", "1:1, 16:9 and 9:16". */
export function ratioList(ratios: readonly string[]): string {
  if (ratios.length <= 1) return ratios.join("")
  return `${ratios.slice(0, -1).join(", ")} and ${ratios.at(-1)}`
}

const REFUSED_FALLBACK = "This model doesn't take the chosen aspect ratio. Pick another aspect ratio and run again."

/**
 * The sentence for an aspect ratio the model refused. `chosen` is the ratio the
 * request asked for, when known; `accepted` the ratios the model takes, when its
 * words name them. A chosen ratio the model's own list names says neither: the
 * words contradict themselves, so neither part is trusted.
 */
export function refusedAspectRatioSentence(chosen: string | null, accepted: readonly string[] | null): string {
  const list = accepted && accepted.length > 0 ? accepted : null
  if (chosen && list?.includes(chosen)) return REFUSED_FALLBACK
  const opening = `This model doesn't take ${chosen ?? "the chosen aspect ratio"}.`
  if (!list) return `${opening} Pick another aspect ratio and run again.`
  const pick = list.length === 1 ? "Pick it and run again." : "Pick one of them and run again."
  return `${opening} It takes ${ratioList(list)}. ${pick}`
}

/** A ratio's width over its height. */
function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number)
  return w! / h!
}

/** The sentence for a picture whose shape falls outside the range the provider named. */
function pictureRangeSentence(range: { readonly low: string; readonly high: string }): string {
  return `This picture's shape doesn't fit this model. It takes pictures between ${range.low} and ${range.high}. Crop it and run again.`
}

/**
 * The sentence for the provider's refusal of an aspect ratio: its own words, and
 * the ratio the request chose (`requestedAspectRatioOf`: `undefined` when no
 * request is in hand, and then the ratio the words say was sent is named).
 */
export function aspectRatioRefusalSentence(providerWords: string, requested: string | null | undefined): string {
  const words = aspectRatioWordsOf(providerWords)
  const chosen = requested === undefined ? words.sent : plainRatio(requested)
  if (words.range) {
    const [low, high] = [ratioValue(words.range.low), ratioValue(words.range.high)].sort((a, b) => a - b)
    const inside = chosen === null || (ratioValue(chosen) >= low! && ratioValue(chosen) <= high!)
    return inside ? pictureRangeSentence(words.range) : refusedAspectRatioSentence(chosen, null)
  }
  return refusedAspectRatioSentence(chosen, words.accepted)
}

/** The largest denominator a picture-shape limit is read with ("2:5" is 0.4). */
const LIMIT_DENOMINATOR_MAX = 40

/** A picture-shape limit (width over height) as a ratio: 0.4 is "2:5", 8 is "8:1"; null when none fits. */
export function limitRatio(x: number): string | null {
  if (!Number.isFinite(x) || x <= 0) return null
  for (let q = 1; q <= LIMIT_DENOMINATOR_MAX; q++) {
    const p = Math.round(x * q)
    if (p > 0 && Math.abs(x * q - p) < 1e-9) return `${p}:${q}`
  }
  return null
}

/**
 * The sentence for a picture too wide or too tall for the model: its size, and
 * the range of shapes the model takes when both limits are set and read as
 * ratios.
 */
export function pictureShapeSentence(width: number, height: number, min: number, max: number): string {
  const shape = width / height > max ? "wide" : "tall"
  const opening = `This picture is too ${shape} for this model (${width}×${height}).`
  const low = min > 0 ? limitRatio(min) : null
  const high = Number.isFinite(max) ? limitRatio(max) : null
  const range = low && high ? ` It takes pictures between ${low} and ${high}.` : ""
  return `${opening}${range} Crop it and run again.`
}
