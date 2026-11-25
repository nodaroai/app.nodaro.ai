/**
 * Kling Image 4.0 request body — pure, no I/O.
 *
 * One KIE endpoint (`kling-4-0/image`, docs.kie.ai/market/kling-4-0/image) for
 * both Nodaro ids: no `image_urls` is text to image, images make it image to
 * image. The schema is `additionalProperties: false`, so the body is built
 * WHOLE here, an explicit allow-list: `prompt`, `image_urls`, `mode`, `count`,
 * `resolution` (lowercase `2k` | `4k` | `8k`) and `aspect_ratio` — never a
 * seed, an output format, a negative prompt or any lever another model takes,
 * whatever the caller's params carry.
 *
 * NAMES. KIE addresses each image as `@image_N`, in `image_urls` order, and
 * REFUSES a prompt that names an image or subject the request does not carry
 * ("Mentioning an image that was not provided returns a parameter error and
 * the task is not created"). The platform's image prompts name references as
 * `Image N` (legacy assembly) or `reference image <letter>` (hybrid assembly,
 * A = the first image), and a person may type `@image_N` or any `@word` (a
 * handle, an e-mail address). This module is the ONE place that numbering
 * becomes Kling's: each seat the request sends becomes `@image_N`, or the
 * `@Name` of the named subject it belongs to (KIE `elements`: a wired
 * character's 2 to 4 views, grouped and priced at plan time by
 * lib/kling-image-4-subjects.ts, as Kling 4.0 video names its subjects), the
 * other images renumbered; then
 * every `@word` the body does not declare loses its `@`
 * (`neutralizeUndeclaredMentions`, the Kling 4.0 video rule), so no path —
 * editor, workflow, API, MCP — can reach that refusal. The prompt is cut to
 * the provider's length BEFORE that last pass, so a cut can never leave a
 * mention half-written and undeclared.
 */
import {
  KLING_IMAGE_4_ASPECT_RATIOS,
  KLING_IMAGE_4_MAX_INPUT_ITEMS,
  KLING_IMAGE_4_MAX_PROMPT_CHARS,
  KLING_IMAGE_4_SUBJECT_DESCRIPTION_MAX,
  KLING_IMAGE_4_SUBJECT_MAX_VIEWS,
  KLING_IMAGE_4_SUBJECT_MIN_VIEWS,
  klingImage4Resolution,
  klingImage4SetCount,
} from "@nodaro/shared/model-catalog"
import { kling4Name, neutralizeUndeclaredMentions, type MentionRules } from "./kling4.js"

/**
 * How Kling Image 4.0 reads a mention, beyond the platform's own rule (Kling
 * 4.0 video reads none of these). The ONE place to switch a reading: the
 * Japanese/Korean rule (`letterAfterNameDropsMention`) is settled by staging
 * probes, and it also decides whether "Image 1" followed directly by such a
 * letter is renamed (`klingImage4SeatNames`).
 */
export const KLING_IMAGE_MENTION_RULES: MentionRules = {
  emailIsNotMention: true,
  chineseNameBindsChineseText: true,
  letterAfterNameDropsMention: true,
}

/** What may not follow a name for it to be one: with the letter rule, any letter, mark or digit; else a word or Chinese character, as before. */
const NAME_END = KLING_IMAGE_MENTION_RULES.letterAfterNameDropsMention ? String.raw`[\p{L}\p{M}\p{N}_]` : String.raw`[\w一-龥]`
/** The platform's three names for a seat (see `klingImage4SeatNames`). */
const SEAT_NAME = new RegExp(
  String.raw`\breference image ([A-Z])(?!${NAME_END})|(?<![@\w])Image (\d+)(?!${NAME_END}|[:.,]\d)|(?<![\w.+\-])@image_(\d+)(?!${NAME_END}|\.\w)`,
  "giu",
)

export const KLING_IMAGE_4_KIE_MODEL = "kling-4-0/image"

const ASPECTS: ReadonlySet<string> = new Set(KLING_IMAGE_4_ASPECT_RATIOS)

export interface KlingImage4RequestArgs {
  prompt: string
  /** The images to send, in order, already in a format and size the provider takes. */
  referenceImageUrls?: readonly string[]
  resolution?: unknown
  aspectRatio?: unknown
  /** The images a set asks for (2 to 10); anything else is one image. */
  setCount?: unknown
  /** Named subjects (KIE `elements`): each names 2 to 4 of `referenceImageUrls`. */
  subjects?: readonly KlingImage4SubjectArg[]
  /**
   * The images in the order the PROMPT numbers them ("Image 1" is the first),
   * when that is not the order they are sent in: a base or source image is
   * sent first, but the assembled prompt numbers only the references. Absent,
   * the prompt's numbers are the sent order.
   */
  promptOrder?: readonly string[]
}

export interface KlingImage4Request {
  model: string
  input: Record<string, unknown>
  /** The input items sent (images and named subjects): what the run is priced on. */
  inputItems: number
  /** The images the task is asked for: 1, or a set's count. */
  imagesAsked: number
  /** What the builder had to drop or change, for the run log. */
  notes: string[]
}

const cleanList = (xs: readonly string[] | undefined): string[] =>
  (xs ?? []).map((u) => (typeof u === "string" ? u.trim() : "")).filter((u) => u.length > 0)

/** "A" → 1 … "J" → 10 (the hybrid assembly's slot letters); anything else undefined. */
function letterSlot(letter: string): number | undefined {
  const code = letter.toUpperCase().charCodeAt(0)
  return letter.length === 1 && code >= 65 && code <= 90 ? code - 64 : undefined
}

/**
 * The platform's names for the images, rewritten in ONE pass to Kling's name
 * for the seat (`seatName(n)`: `image_K`, or a named subject's name); a name
 * for a seat the request does not send is left as it was written (plain words,
 * no `@`). One pass, so a seat renamed to `@image_1` is never read again as
 * seat 1.
 *   - `reference image A` (hybrid; A is seat 1);
 *   - `Image 3` (legacy; capitalised, a whole word, so "an image 3 times" stays);
 *   - `@image_3` / `@Image_3` (typed, or already Kling's).
 */
export function klingImage4SeatNames(prompt: string, seatName: (n: number) => string | undefined): string {
  // Quoted text is what the picture says: never rewritten.
  return mapOutsideQuotes(prompt, (part) => part.replace(
    SEAT_NAME,
    (whole, letter: string | undefined, legacy: string | undefined, typed: string | undefined) => {
      // The hybrid form is capitalised as the assembly writes it ("reference image A").
      if (letter !== undefined && !/^reference image [A-Z]$/.test(whole)) return whole
      if (legacy !== undefined && !whole.startsWith("Image ")) return whole
      const n = letter !== undefined ? letterSlot(letter) : Number(legacy ?? typed)
      const seat = n === undefined ? undefined : seatName(n)
      return seat === undefined ? whole : `@${seat}`
    },
  ))
}

/**
 * Text in straight, curly, corner or white-corner quotes, as written. A
 * straight quote opens only where a word does not end right before it, so an
 * inch mark (`a 5" frame`) opens nothing; it closes at the next straight quote
 * on the same line. A mention a person writes inside quotes is still read by
 * the provider as a mention: it is not renamed here, and the later pass keeps
 * its `@` only when it is a name the request declares.
 */
const QUOTED = /(?<![\w])"[^"\n]*"|\u201c[^\u201d]*\u201d|\u300c[^\u300d]*\u300d|\u300e[^\u300f]*\u300f/g

/** `fn` applied to every part of `text` outside quotation marks; quoted parts are kept byte for byte. */
function mapOutsideQuotes(text: string, fn: (part: string) => string): string {
  let out = ""
  let at = 0
  for (const m of text.matchAll(QUOTED)) {
    out += fn(text.slice(at, m.index)) + m[0]
    at = m.index! + m[0].length
  }
  return out + fn(text.slice(at))
}

/**
 * The prompt cut to `max` characters on a boundary that keeps every mention
 * whole: a cut inside `@name` drops the whole half-written word, so
 * `@image_10` can never be cut to `@image_1`.
 */
export function cutPromptKeepingMentions(prompt: string, max: number): string {
  if (prompt.length <= max) return prompt
  let cut = max
  const nameChar = /[一-龥A-Za-z0-9_]/
  if (nameChar.test(prompt[cut] ?? "")) {
    const tail = /@[一-龥A-Za-z0-9_]*$/.exec(prompt.slice(0, cut))
    if (tail) cut = tail.index
  }
  return prompt.slice(0, cut)
}

/** One named subject as the job carries it (lib/kling-image-4-subjects.ts), its views as sent. */
export interface KlingImage4SubjectArg {
  readonly name: string
  readonly imageUrls: readonly string[]
  readonly description?: string
}

/**
 * The job's named subjects, typed (they ride `extraParams` as plain data), each
 * view mapped to the URL it is sent under (`sentUrlOf`: after the format
 * conversion). A malformed entry is left out.
 */
export function klingImageSubjectsOf(value: unknown, sentUrlOf: (url: string) => string = (u) => u): KlingImage4SubjectArg[] {
  if (!Array.isArray(value)) return []
  const out: KlingImage4SubjectArg[] = []
  for (const v of value) {
    if (!v || typeof v !== "object") continue
    const r = v as Record<string, unknown>
    if (typeof r.name !== "string" || !Array.isArray(r.imageUrls)) continue
    const imageUrls = r.imageUrls.filter((u): u is string => typeof u === "string" && u.length > 0).map(sentUrlOf)
    out.push({ name: r.name, imageUrls, ...(typeof r.description === "string" && r.description ? { description: r.description } : {}) })
  }
  return out
}

interface Subject {
  name: string
  imageUrls: string[]
  description?: string
}

export function buildKlingImage4Request(args: KlingImage4RequestArgs): KlingImage4Request {
  const notes: string[] = []
  const seated = [...new Set(cleanList(args.referenceImageUrls))]

  // Named subjects: each names 2 to 4 of the images the request sends (its
  // views, the primary first). A subject left with fewer than 2 of them is
  // none: its images stay plain references.
  const taken = new Set<string>()
  const claimed = new Set<string>()
  const subjects: Subject[] = []
  for (const s of args.subjects ?? []) {
    const views = [...new Set(s.imageUrls)].filter((u) => seated.includes(u) && !claimed.has(u)).slice(0, KLING_IMAGE_4_SUBJECT_MAX_VIEWS)
    if (views.length < KLING_IMAGE_4_SUBJECT_MIN_VIEWS) continue
    let name = kling4Name(s.name, `Character${subjects.length + 1}`)
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${name.slice(0, 20 - String(n).length)}${n}`
    taken.add(name.toLowerCase())
    for (const u of views) claimed.add(u)
    const description = s.description?.trim().slice(0, KLING_IMAGE_4_SUBJECT_DESCRIPTION_MAX)
    subjects.push({ name, imageUrls: views, ...(description ? { description } : {}) })
  }
  const subjectByUrl = new Map<string, Subject>()
  for (const s of subjects) for (const u of s.imageUrls) subjectByUrl.set(u, s)

  // Every other image, renumbered, within the 10 input items the provider
  // takes in all (the routes refuse more before anything is reserved).
  const room = Math.max(0, KLING_IMAGE_4_MAX_INPUT_ITEMS - subjects.length)
  const plain = seated.filter((u) => !subjectByUrl.has(u))
  const images = plain.slice(0, room)
  if (images.length < plain.length) {
    notes.push(`sent ${images.length} of ${plain.length} images beside ${subjects.length} named subject(s): Kling Image 4.0 takes ${KLING_IMAGE_4_MAX_INPUT_ITEMS} input items in all`)
  }
  // Each image's name on the wire, then each number the prompt uses mapped to
  // its image: by the prompt's own order when given (a base sent first is not
  // "Image 1"), else by the sent order.
  const nameByUrl = new Map<string, string>()
  for (const url of seated) {
    const subject = subjectByUrl.get(url)
    if (subject) nameByUrl.set(url, subject.name)
    else if (images.includes(url)) nameByUrl.set(url, `image_${images.indexOf(url) + 1}`)
  }
  // NOT deduplicated: the prompt counted a repeated reference as its own
  // number, and that number names the image it repeats.
  const numbered = cleanList(args.promptOrder ?? args.referenceImageUrls)
  const seatName = (n: number): string | undefined => {
    const url = numbered[n - 1]
    return url === undefined ? undefined : nameByUrl.get(url)
  }

  let prompt = klingImage4SeatNames(args.prompt ?? "", seatName)
  if (prompt.length > KLING_IMAGE_4_MAX_PROMPT_CHARS) {
    notes.push(`cut the prompt from ${prompt.length} to ${KLING_IMAGE_4_MAX_PROMPT_CHARS} characters`)
    prompt = cutPromptKeepingMentions(prompt, KLING_IMAGE_4_MAX_PROMPT_CHARS)
  }
  // LAST: nothing after this may change the prompt, the images or the subjects.
  const declared = [...images.map((_, i) => `image_${i + 1}`), ...subjects.map((s) => s.name)]
  prompt = neutralizeUndeclaredMentions(prompt, declared, KLING_IMAGE_MENTION_RULES)

  const set = klingImage4SetCount(args.setCount)
  const input: Record<string, unknown> = {
    prompt,
    resolution: klingImage4Resolution(args.resolution).toLowerCase(),
  }
  const aspect = typeof args.aspectRatio === "string" ? args.aspectRatio.trim() : ""
  if (aspect && ASPECTS.has(aspect)) input.aspect_ratio = aspect
  else if (aspect) notes.push(`sent no aspect ratio: Kling Image 4.0 takes no "${aspect}" (its own auto applies)`)
  if (images.length > 0) input.image_urls = images
  if (subjects.length > 0) {
    input.elements = subjects.map((s) => ({
      name: s.name,
      image_urls: s.imageUrls,
      tag: "character",
      ...(s.description ? { description: s.description } : {}),
    }))
  }
  if (set !== undefined) {
    input.mode = "series"
    input.count = set
  }
  return {
    model: KLING_IMAGE_4_KIE_MODEL,
    input,
    inputItems: images.length + subjects.length,
    imagesAsked: set ?? 1,
    notes,
  }
}
