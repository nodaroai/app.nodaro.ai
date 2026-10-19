/**
 * Describe-first, for a Copilot turn on KIE: each image is described by the
 * turn's own model on KIE's Claude wire with NO tools (`callKie` — the only
 * shape in which KIE's model sees an image), the image inlined first. Every
 * URL once, at most `limit`, all in parallel, each call under the turn's
 * cancel AND its own deadline. A failure leaves its image undescribed — it
 * reads as could-not-be-read and is tried again on a later KIE turn — and
 * never fails the turn. So does an image that could not be inlined (KIE's
 * fetcher fails some URLs, and the model then describes a missing image) and
 * a refusal: neither answer is about the image. What the calls cost is returned for the turn's
 * metered cost and budget.
 */
import { getLlmModel, type LlmModelDef } from "@nodaro/shared/llm-models"
import { prefetchAsBase64 } from "../../lib/anthropic-image.js"
import { billedProviderCost } from "../../lib/llm-errors.js"
import { callKie } from "../../lib/llm/kie-lane.js"
import { kieCostUsd, requestChars } from "../../lib/llm/kie-cost.js"
import type { LlmRequest } from "../../lib/llm/types.js"
import { TURN_CAPS } from "./constants.js"

export const DESCRIBE_IMAGE_SYSTEM =
  "You describe an image for an assistant that cannot see it. Describe it factually and in detail: the subjects " +
  "and how they look, the setting, the composition and framing, colours, lighting, any text in it (verbatim), and " +
  "its visual style. Plain prose. No preamble, no opinions, no advice."
const DESCRIBE_IMAGE_PROMPT = "Describe this image."
const DESCRIBE_MAX_TOKENS = 1_024
/** One description call's own deadline. It rides INSIDE the signal: on the Claude wire a passed signal replaces the per-attempt timeout. */
export const DESCRIBE_IMAGE_TIMEOUT_MS = 120_000

export interface DescribedUrls {
  /** URL → its description, for every image that got one. */
  descriptions: Map<string, string>
  costUsd: number
  /** Images asked about (deduplicated, at most `limit`). */
  attempted: number
}

export async function describeImageUrls(
  registryId: string,
  urls: readonly string[],
  opts: { signal?: AbortSignal; limit?: number } = {},
): Promise<DescribedUrls> {
  const model = getLlmModel(registryId)
  if (!model) throw new Error(`describeImageUrls: ${registryId} is not a registry model`)
  const unique = [...new Set(urls)].slice(0, Math.max(0, opts.limit ?? TURN_CAPS.maxVisionImages))
  const results = await Promise.all(unique.map((url) => describeOne(model, url, opts.signal)))
  const descriptions = new Map<string, string>()
  let costUsd = 0
  unique.forEach((url, k) => {
    const result = results[k]!
    costUsd += result.costUsd
    if (result.description) descriptions.set(url, result.description)
  })
  return { descriptions, costUsd, attempted: unique.length }
}

async function describeOne(
  model: LlmModelDef,
  url: string,
  turnSignal: AbortSignal | undefined,
): Promise<{ description?: string; costUsd: number }> {
  try {
    const image = await prefetchAsBase64(url)
    if (image.type !== "image_base64") {
      console.warn(`[copilot] image description skipped on ${model.id}: the image could not be inlined`)
      return { costUsd: 0 }
    }
    const req: LlmRequest = {
      modelId: model.id,
      system: DESCRIBE_IMAGE_SYSTEM,
      messages: [{ role: "user", content: [image, { type: "text", text: DESCRIBE_IMAGE_PROMPT }] }],
      maxTokens: DESCRIBE_MAX_TOKENS,
      timeoutMs: DESCRIBE_IMAGE_TIMEOUT_MS,
      failOnRefusal: true,
    }
    const deadline = AbortSignal.timeout(DESCRIBE_IMAGE_TIMEOUT_MS)
    const signal = turnSignal ? AbortSignal.any([turnSignal, deadline]) : deadline
    const resp = await callKie(model, req, signal)
    const description = resp.text.trim()
    const costUsd = kieCostUsd(model.id, { creditsUsd: resp.creditsUsd, promptChars: requestChars(req), answerChars: resp.text.length })
    return description ? { description, costUsd } : { costUsd }
  } catch (err) {
    console.warn(`[copilot] image description failed on ${model.id}: ${String(err).slice(0, 200)}`)
    return { costUsd: billedProviderCost(err) ?? 0 }
  }
}
