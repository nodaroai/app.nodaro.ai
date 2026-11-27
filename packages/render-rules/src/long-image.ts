/**
 * Long Image (decided 2026-11-22): one very tall picture made from a prompt, a
 * webpage design or a product detail page. These are the rules every lane
 * reads alike: the editor (the node, its config panel, its Run price) and the
 * server (the route, the workflow payload, the worker, price.ee.ts). Pure, with
 * no node type in it: each caller passes the unit's own type (its generated
 * definition or descriptor), so the type id stays in the unit's folders.
 *
 * Two modes, whose provider fields never mix (the provider refuses a request
 * that carries the other mode's fields, so only the active mode's are kept):
 *   - Webpage design (`webpage`): a prompt, an optional style picture and an
 *     optional subject picture.
 *   - Product page (`ecommerce`): a prompt, one to three product pictures and
 *     a page length (short, medium or long).
 * Both are made at 1K or 2K.
 *
 * A prompt names the pictures it is sent: `@image_1` to `@image_3` are the
 * product pictures, by the input each is wired to (or its place in the
 * request's list); `@style` and `@subject` are the webpage pictures.
 *
 * Prices are not here: the credit ids name rows of the unit's price.ee.ts and
 * its model_pricing seed. A run is charged the row of its mode, its length
 * (product page), its size and the pictures it sends.
 */

export const LONG_IMAGE_MODES = ["webpage", "ecommerce"] as const
export type LongImageMode = (typeof LONG_IMAGE_MODES)[number]
/** A node or request that names no mode is a webpage design: it runs from a prompt alone. */
export const LONG_IMAGE_DEFAULT_MODE: LongImageMode = "webpage"

/** A product page's length: about 2 to 5 sections, 6 to 10, or 11 to 18, all in one picture. */
export const LONG_IMAGE_LENGTHS = ["short", "medium", "long"] as const
export type LongImageLength = (typeof LONG_IMAGE_LENGTHS)[number]
export const LONG_IMAGE_DEFAULT_LENGTH: LongImageLength = "medium"

export const LONG_IMAGE_RESOLUTIONS = ["1K", "2K"] as const
export type LongImageResolution = (typeof LONG_IMAGE_RESOLUTIONS)[number]
export const LONG_IMAGE_DEFAULT_RESOLUTION: LongImageResolution = "2K"

/** The longest prompt, in characters. */
export const LONG_IMAGE_PROMPT_MAX = 20000

/** A product page takes one to three product pictures. */
export const LONG_IMAGE_MAX_PRODUCT_IMAGES = 3

/** The node's product picture inputs, in the order the prompt numbers them (`@image_1` is the first). */
export const LONG_IMAGE_PRODUCT_INPUTS = ["productImage1", "productImage2", "productImage3"] as const
/** The node's webpage picture inputs. */
export const LONG_IMAGE_STYLE_INPUT = "styleImage"
export const LONG_IMAGE_SUBJECT_INPUT = "subjectImage"

/**
 * The sign an `@` the provider would read as a reference is written with when
 * it names nothing the run sends: the full-width `＠` (U+FF20), the provider's
 * own documented way to write an `@` it does not read.
 */
export const LONG_IMAGE_TEXT_AT = "\uFF20"

/** What a prompt calls the webpage pictures. */
export const LONG_IMAGE_STYLE_NAME = "style"
export const LONG_IMAGE_SUBJECT_NAME = "subject"

/** What a prompt calls the product picture at `slot` (1-based): `image_1` … `image_3`. */
export function longImageProductName(slot: number): string {
  return `image_${slot}`
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v)

/** The mode a node's data or a request asks for, else the default. */
export function longImageMode(v: unknown): LongImageMode {
  return isOneOf(LONG_IMAGE_MODES, v) ? v : LONG_IMAGE_DEFAULT_MODE
}

/** A product page's length, else the default. */
export function longImageLength(v: unknown): LongImageLength {
  return isOneOf(LONG_IMAGE_LENGTHS, v) ? v : LONG_IMAGE_DEFAULT_LENGTH
}

/** The size, read in either case ("1k" is 1K), else the default. */
export function longImageResolution(v: unknown): LongImageResolution {
  const s = typeof v === "string" ? v.trim().toUpperCase() : ""
  return isOneOf(LONG_IMAGE_RESOLUTIONS, s) ? s : LONG_IMAGE_DEFAULT_RESOLUTION
}

/** The prompt as a run sends it: trimmed, "" when there is none. */
export function longImagePrompt(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** A picture's URL as a run carries it: a non-empty trimmed string, else undefined. */
function urlOf(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined
}

/**
 * What a run is asked for, as the node, the API and the job's request spell it
 * (unread). `productImageUrls` lists the product pictures by place: the first
 * is `@image_1`, and an empty place (`null`) keeps the numbering of the ones
 * after it.
 */
export interface LongImageRequest {
  readonly mode?: unknown
  readonly length?: unknown
  readonly resolution?: unknown
  readonly prompt?: unknown
  readonly productImageUrls?: unknown
  readonly styleImageUrl?: unknown
  readonly subjectImageUrl?: unknown
}

/** A run's settings, normalized: what every lane sends on. Only the active mode's pictures are kept. */
export interface LongImageRun {
  readonly mode: LongImageMode
  readonly resolution: LongImageResolution
  /** Product page only. */
  readonly length?: LongImageLength
  readonly prompt: string
  /**
   * Product page only: the product pictures by place (index 0 is `@image_1`),
   * an empty place `null`; no empty place at the end.
   */
  readonly productImageUrls?: readonly (string | null)[]
  /** Webpage design only. */
  readonly styleImageUrl?: string
  readonly subjectImageUrl?: string
}

/** The product places of a request: its first three entries, each a URL or `null`, the empty ones at the end dropped. */
function productPlaces(v: unknown): (string | null)[] {
  const list = Array.isArray(v) ? v.slice(0, LONG_IMAGE_MAX_PRODUCT_IMAGES) : []
  const places = list.map((u) => urlOf(u) ?? null)
  while (places.length > 0 && places[places.length - 1] === null) places.pop()
  return places
}

/** A run's settings from a request, a job's payload or its `input_data`. */
export function longImageRun(req: LongImageRequest | null | undefined): LongImageRun {
  const mode = longImageMode(req?.mode)
  const resolution = longImageResolution(req?.resolution)
  const prompt = longImagePrompt(req?.prompt)
  if (mode === "ecommerce") {
    return { mode, resolution, length: longImageLength(req?.length), prompt, productImageUrls: productPlaces(req?.productImageUrls) }
  }
  const style = urlOf(req?.styleImageUrl)
  const subject = urlOf(req?.subjectImageUrl)
  return { mode, resolution, prompt, ...(style ? { styleImageUrl: style } : {}), ...(subject ? { subjectImageUrl: subject } : {}) }
}

/** The pictures wired into a node, for its mode, as a run's request carries them. */
export interface LongImagePictures {
  readonly productImageUrls?: readonly (string | null)[]
  readonly styleImageUrl?: string
  readonly subjectImageUrl?: string
}

/** How a person names a picture input, for a sentence. */
function pictureInputName(id: string): string {
  const slot = (LONG_IMAGE_PRODUCT_INPUTS as readonly string[]).indexOf(id)
  if (slot >= 0) return `Product image ${slot + 1}`
  return id === LONG_IMAGE_STYLE_INPUT ? "Style image" : "Subject image"
}

const isWebAddress = (v: string): boolean => /^https?:\/\/\S+$/i.test(v)

/**
 * The pictures wired into a node's inputs for its mode, from the lane values
 * both engines resolve (`unitInputs`, by input id). Only the active mode's
 * inputs are read. A picture input that is wired but holds nothing (its
 * upstream made no picture), or holds something that is not a web address, is
 * a problem: the run is refused rather than sent, or priced, without it.
 */
export function longImageWiredPictures(
  unitInputs: Readonly<Record<string, unknown>> | null | undefined,
  mode: LongImageMode,
): { readonly pictures: LongImagePictures; readonly problem?: string } {
  const read = (id: string): { url?: string; problem?: string } => {
    const v = unitInputs?.[id]
    if (v === undefined || v === null) return {}
    const s = typeof v === "string" ? v.trim() : ""
    if (s === "") return { problem: `${pictureInputName(id)} is wired, but its input made no picture.` }
    if (!isWebAddress(s)) return { problem: `${pictureInputName(id)} is wired to something that is not a picture.` }
    return { url: s }
  }
  if (mode === "ecommerce") {
    const reads = LONG_IMAGE_PRODUCT_INPUTS.map(read)
    const problem = reads.find((r) => r.problem)?.problem
    return { pictures: { productImageUrls: reads.map((r) => r.url ?? null) }, ...(problem ? { problem } : {}) }
  }
  const style = read(LONG_IMAGE_STYLE_INPUT)
  const subject = read(LONG_IMAGE_SUBJECT_INPUT)
  const problem = style.problem ?? subject.problem
  return {
    pictures: { ...(style.url ? { styleImageUrl: style.url } : {}), ...(subject.url ? { subjectImageUrl: subject.url } : {}) },
    ...(problem ? { problem } : {}),
  }
}

/** The product pictures a run sends, in place order, each once: a picture given twice is sent, and priced, once. */
export function longImageSentProducts(run: LongImageRun): string[] {
  return [...new Set((run.productImageUrls ?? []).filter((u): u is string => typeof u === "string"))]
}

/** How many pictures a run sends: what it is priced on. */
export function longImageInputImages(run: LongImageRun): number {
  if (run.mode === "ecommerce") return longImageSentProducts(run).length
  return (run.styleImageUrl ? 1 : 0) + (run.subjectImageUrl ? 1 : 0)
}

/** The most pictures a run of `mode` can send: what an estimate that cannot see the node's wires prices. */
export function longImageMostInputImages(mode: LongImageMode): number {
  return mode === "ecommerce" ? LONG_IMAGE_MAX_PRODUCT_IMAGES : 2
}

/** Why a run cannot start, as a sentence a person reads; undefined when it can. */
export function longImageProblem(run: LongImageRun): string | undefined {
  if (run.prompt === "") return "Long Image needs a prompt."
  if (run.prompt.length > LONG_IMAGE_PROMPT_MAX) {
    return `Long Image takes a prompt of up to ${LONG_IMAGE_PROMPT_MAX.toLocaleString("en-US")} characters (this one has ${run.prompt.length.toLocaleString("en-US")}).`
  }
  if (run.mode === "ecommerce" && longImageSentProducts(run).length === 0) return "A product page needs one to three product pictures."
  return undefined
}

/**
 * The credit id of a run of the unit of type `type`:
 *   - `<type>:webpage:<size>`, or `<type>:webpage:<size>:<N>ref` with N (1 or 2) pictures;
 *   - `<type>:ecommerce:<length>:<size>:<N>ref` with N (1 to 3) product pictures.
 * A count out of range is held to the mode's range.
 */
export function longImageCreditId(type: string, mode: LongImageMode, resolution: LongImageResolution, length: LongImageLength, inputImages: number): string {
  const asked = Number.isFinite(inputImages) ? Math.floor(inputImages) : 0
  if (mode === "ecommerce") {
    const n = Math.min(LONG_IMAGE_MAX_PRODUCT_IMAGES, Math.max(1, asked))
    return `${type}:ecommerce:${length}:${resolution}:${n}ref`
  }
  const n = Math.min(longImageMostInputImages(mode), Math.max(0, asked))
  return n > 0 ? `${type}:webpage:${resolution}:${n}ref` : `${type}:webpage:${resolution}`
}

/** The credit id a run is charged: its mode, length, size and the pictures it sends. */
export function longImageRunCreditId(type: string, run: LongImageRun): string {
  return longImageCreditId(type, run.mode, run.resolution, run.length ?? LONG_IMAGE_DEFAULT_LENGTH, longImageInputImages(run))
}

/**
 * The credit id of a node's data or a request-shaped record. A record that
 * states how many pictures it sends (`inputImages`, which every job's request
 * carries) is priced on them. A node's data never holds its wired pictures, so
 * it is priced on the most its mode can send: an estimate errs high, never low.
 */
export function longImageDataCreditId(type: string, data: Readonly<Record<string, unknown>> | null | undefined): string {
  const mode = longImageMode(data?.mode)
  const stated = data?.inputImages
  const n = typeof stated === "number" && Number.isFinite(stated) ? stated : longImageMostInputImages(mode)
  return longImageCreditId(type, mode, longImageResolution(data?.resolution), longImageLength(data?.length), n)
}

/** The picture inputs (the node's pips) a run of `mode` reads: the product pictures, or the style and subject pictures. */
export function longImagePictureInputs(mode: LongImageMode): readonly string[] {
  return mode === "ecommerce" ? LONG_IMAGE_PRODUCT_INPUTS : [LONG_IMAGE_STYLE_INPUT, LONG_IMAGE_SUBJECT_INPUT]
}

/**
 * The credit id of a node's data with the inputs that carry a wire (the
 * editor's prices, which see the canvas): each wired picture input of the
 * mode counts as one picture, the other mode's never. A picture wired into two
 * inputs is sent once, so this can only err high.
 */
export function longImageWiredCreditId(type: string, data: Readonly<Record<string, unknown>> | null | undefined, wiredInputs: ReadonlySet<string>): string {
  const mode = longImageMode(data?.mode)
  const wired = longImagePictureInputs(mode).filter((id) => wiredInputs.has(id)).length
  return longImageCreditId(type, mode, longImageResolution(data?.resolution), longImageLength(data?.length), wired)
}

/** Every credit id of the unit, in order: what price.ee.ts and its seed list. */
export function longImageCreditIds(type: string): string[] {
  const out: string[] = []
  for (const resolution of LONG_IMAGE_RESOLUTIONS) {
    for (let n = 0; n <= longImageMostInputImages("webpage"); n++) out.push(longImageCreditId(type, "webpage", resolution, LONG_IMAGE_DEFAULT_LENGTH, n))
  }
  for (const length of LONG_IMAGE_LENGTHS) {
    for (const resolution of LONG_IMAGE_RESOLUTIONS) {
      for (let n = 1; n <= LONG_IMAGE_MAX_PRODUCT_IMAGES; n++) out.push(longImageCreditId(type, "ecommerce", resolution, length, n))
    }
  }
  return out
}
