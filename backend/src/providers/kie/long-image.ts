/**
 * Kling 4.0's long image on KIE's market lane (the Long Image node): one very
 * tall picture from a prompt, a webpage design or a product detail page.
 *
 *   webpage:   input = { skill: "webpage", prompt, resolution, style_image?, subject_image? }
 *   ecommerce: input = { skill: "ecommerce", prompt, resolution, image_urls, length }
 *   poll  → JSON.parse(resultJson) = { resultUrls: [<the picture>] }
 *
 * The schema is `additionalProperties: false`, and a field of the other skill
 * is refused (422), so each body is built WHOLE here: an allow-list per skill,
 * whatever else the run carries. `resolution` is lowercase on the wire (`1k`,
 * `2k`). Each task makes exactly one picture.
 *
 * NAMES. The provider reads every `@` directly before a letter, digit,
 * underscore or Chinese character as a reference to something it was sent,
 * and refuses a request that names one it was not (an e-mail address or a
 * handle fails). The product pictures are `@image_N` in the order of
 * `image_urls`; the webpage pictures are `@style` and `@subject`. This module
 * is the ONE place the prompt's names become the provider's, in one pass over
 * every `@` followed by name characters (`readNames`):
 *   - a product picture's `@image_N` (N its place on the node, or in the
 *     request's list) is renumbered to its place among the pictures sent (an
 *     empty place, or a picture given twice, closes the gap);
 *   - `@style` / `@subject` name the webpage pictures, when they are sent;
 *   - every other `@` before a name character, an e-mail address's included,
 *     becomes the full-width `＠` (U+FF20), the provider's own documented way
 *     to write an `@` it does not read as a reference: the text keeps its
 *     sign (`hello＠shop.com`) and the request names nothing it was not sent.
 * Renaming and keeping are one decision per name, so a name the pass keeps is
 * always one the request declares. (Kling Image 4.0 drops such an `@` through
 * the shared mention pass, `neutralizeUndeclaredMentions`; this model keeps
 * its sign, decided 2026-11-27.)
 * The prompt is cut to the provider's length BEFORE the names are read, so a
 * cut never leaves a name half-written. The content guard is asked again on the
 * text actually sent (`guardProviderWireText`), after the rewrite and before
 * the task is created.
 *
 * The picture's size and file type are not stated: its delivery stores it as
 * what its bytes are (backend/src/nodes/long-image/recover.ts).
 */
import { LONG_IMAGE_DEFAULT_LENGTH, LONG_IMAGE_PROMPT_MAX, LONG_IMAGE_STYLE_NAME, LONG_IMAGE_TEXT_AT, LONG_IMAGE_SUBJECT_NAME, longImageProductName, longImageSentProducts, type LongImageRun } from "@nodaro/render-rules"
import { guardProviderWireText } from "../../lib/content-guard.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { createSanitizedError, runKieTask } from "./client.js"
import { kieTaskCreditsConsumed } from "./image-cost.js"
import { cutPromptKeepingMentions } from "./kling-image-4.js"
import { LONG_IMAGE_MODEL_KEY, LONG_IMAGE_WIRE_MODEL } from "./models.js"

/** The request a run sends, built whole. */
export interface LongImageWireRequest {
  readonly model: string
  readonly input: Record<string, unknown>
  /** The pictures sent: what the run is priced on. */
  readonly inputImages: number
  /** What the builder had to change, for the run log. */
  readonly notes: readonly string[]
}

/** An `@` and the name characters after it: what the provider reads as a reference. */
const AT_NAME = /@([\p{L}\p{M}\p{N}_]+)/gu

/** A product picture's name, `image_N` (any case). */
const PRODUCT_NAME = /^image_(\d+)$/i

/**
 * One pass over the prompt's names: each `@name` is written as the name the
 * provider knows it by (`nameOf(name)`: a declared name, renumbered for a
 * product picture), or, when it names nothing the request sends, with the
 * full-width sign instead of its `@`. An e-mail-shaped token (a word
 * character before the `@`, a dotted domain after the name) is never a name.
 */
function readNames(prompt: string, nameOf: (name: string) => string | undefined): string {
  return prompt.replace(AT_NAME, (whole, name: string, offset: number) => {
    const before = offset > 0 ? prompt[offset - 1]! : ""
    const after = prompt.slice(offset + whole.length)
    const email = /[A-Za-z0-9_]/.test(before) && /^\.[A-Za-z0-9]/.test(after)
    const known = email ? undefined : nameOf(name)
    return known === undefined ? `${LONG_IMAGE_TEXT_AT}${name}` : `@${known}`
  })
}

/**
 * The body of one run (pure). `sentUrlOf` maps a picture's URL to the one it
 * is sent under (after the format conversion); the pictures are counted and
 * named before it, by the run's own URLs.
 */
export function buildLongImageRequest(run: LongImageRun, sentUrlOf: (url: string) => string = (u) => u): LongImageWireRequest {
  const notes: string[] = []
  let prompt = run.prompt
  if (prompt.length > LONG_IMAGE_PROMPT_MAX) {
    notes.push(`cut the prompt from ${prompt.length} to ${LONG_IMAGE_PROMPT_MAX} characters`)
    prompt = cutPromptKeepingMentions(prompt, LONG_IMAGE_PROMPT_MAX)
  }
  const resolution = run.resolution.toLowerCase()

  if (run.mode === "ecommerce") {
    const places = run.productImageUrls ?? []
    const sent = longImageSentProducts(run)
    const sentPlaceOf = (place: number): number | undefined => {
      const url = places[place - 1]
      return typeof url === "string" ? sent.indexOf(url) + 1 : undefined
    }
    // LAST: nothing after this may change the prompt or the pictures.
    prompt = readNames(prompt, (name) => {
      const place = PRODUCT_NAME.exec(name)?.[1]
      const at = place === undefined ? undefined : sentPlaceOf(Number(place))
      return at === undefined ? undefined : longImageProductName(at)
    })
    return {
      model: LONG_IMAGE_WIRE_MODEL,
      input: { skill: "ecommerce", prompt, resolution, image_urls: sent.map(sentUrlOf), length: run.length ?? LONG_IMAGE_DEFAULT_LENGTH },
      inputImages: sent.length,
      notes,
    }
  }

  const declared = [...(run.styleImageUrl ? [LONG_IMAGE_STYLE_NAME] : []), ...(run.subjectImageUrl ? [LONG_IMAGE_SUBJECT_NAME] : [])]
  // LAST: nothing after this may change the prompt or the pictures.
  prompt = readNames(prompt, (name) => declared.find((d) => d === name.toLowerCase()))
  return {
    model: LONG_IMAGE_WIRE_MODEL,
    input: {
      skill: "webpage",
      prompt,
      resolution,
      ...(run.styleImageUrl ? { style_image: sentUrlOf(run.styleImageUrl) } : {}),
      ...(run.subjectImageUrl ? { subject_image: sentUrlOf(run.subjectImageUrl) } : {}),
    },
    inputImages: declared.length,
    notes,
  }
}

/** A finished run: the provider's picture, and what the task cost and took. */
export interface LongImageResult {
  readonly taskId: string
  /** The provider's file: its type and size are not stated. */
  readonly url: string
  /** What the task really cost, in KIE credits, from its own record; undefined when the record says nothing. */
  readonly kieCredits?: number
  readonly providerMs?: number
}

/** A finished task as its poll read it: its parsed `resultJson`, and what it cost and took. */
export interface LongImageTask {
  readonly taskId: string
  readonly resultJson: unknown
  readonly kieCredits?: number
  readonly providerMs?: number
}

/**
 * The run's result from its finished task (pure): the first picture of its
 * `resultJson`. The ONE reading for the worker's run and for a recovery that
 * reads the same task again (backend/src/nodes/long-image/recover.ts). A task
 * with no picture fails, never an empty success.
 */
export function longImageResultOf(task: LongImageTask): LongImageResult {
  const root = typeof task.resultJson === "object" && task.resultJson !== null ? (task.resultJson as Record<string, unknown>) : undefined
  const urls = Array.isArray(root?.resultUrls) ? (root!.resultUrls as unknown[]) : []
  const url = urls.map((u) => (typeof u === "string" ? u.trim() : "")).find((u) => /^https?:\/\//i.test(u))
  if (!url) throw createSanitizedError("long image task succeeded but no URL in resultUrls", "Long image")
  return {
    taskId: task.taskId,
    url,
    ...(task.kieCredits !== undefined ? { kieCredits: task.kieCredits } : {}),
    ...(task.providerMs !== undefined ? { providerMs: task.providerMs } : {}),
  }
}

/**
 * One run: the body built whole (`buildLongImageRequest`), the content guard
 * asked again on the text sent (the builder rewrote the prompt after the prompt
 * funnel's check), then the task, polled to its end. Every failure is the
 * client's sanitized error, which the worker's failure path refunds.
 */
export async function runLongImage(run: LongImageRun, sentUrlOf: (url: string) => string, reconcileOpts?: ReconcileOpts): Promise<LongImageResult> {
  const request = buildLongImageRequest(run, sentUrlOf)
  for (const note of request.notes) console.warn(`[KIE.ai] ${LONG_IMAGE_MODEL_KEY}: ${note}`)
  await guardProviderWireText([request.input.prompt as string], "image", LONG_IMAGE_MODEL_KEY)
  const result = await runKieTask(request.model, request.input, undefined, undefined, {
    ...reconcileOpts,
    modelKey: LONG_IMAGE_MODEL_KEY,
    dimensions: { ...reconcileOpts?.dimensions, resolution: request.input.resolution as string, images: request.inputImages, skill: request.input.skill as string },
  })
  const rawInfo = "rawRecordInfo" in result ? result.rawRecordInfo : undefined
  return longImageResultOf({
    taskId: result.taskId ?? "",
    resultJson: result.resultJson,
    kieCredits: kieTaskCreditsConsumed(rawInfo as Record<string, unknown> | undefined),
    ...(typeof result.providerMs === "number" ? { providerMs: result.providerMs } : {}),
  })
}
