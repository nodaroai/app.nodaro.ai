/**
 * A recovered image job gets the same paste-back its worker would have run
 * before finalize, so a job finished by the reconcile cron or a stall re-pick
 * (`inline-reconcile.ts`, which runs the same per-provider handlers) delivers
 * what a live run delivers:
 *  - a Generate Image inpaint (a mask and a base): the result's masked area
 *    composited over the base (`compositeInpaint`, as `handleGenerateImage`);
 *  - a masked image-to-image edit on a model that redraws the whole picture
 *    (`maskEditRedrawsOutside`, GPT Image 2.6 Flare and Sunburst): the source
 *    pasted back everywhere outside the mask (`pasteSourceOutsideMask`, as
 *    `handleImageToImage`), recorded as `maskComposited`.
 * Read from the job's own `input_data` (the route's request, or the workflow
 * run's payload). The source pasted back is the job's `imageUrl`, the image
 * the provider was sent before any format conversion of its own.
 *
 * A failure throws a plain Error, so the caller's catch bumps the attempt and
 * an exhausted job is refunded: never a redraw finalized as the result.
 */
import { compositeInpaint, pasteSourceOutsideMask } from "../../services/inpaint/composite.js"
import { generateImageModelOf } from "../../workers/handlers/default-models.js"
import { KIE_IMAGE_MODELS } from "../../providers/kie/models.js"

/** The delivered picture of a recovered image job, when its worker would have composited one. */
export interface RecoveredComposite {
  url: string
  extraOutputData?: Record<string, unknown>
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

export async function recoveredMaskComposite(
  row: { id: string; job_type: string | null | undefined; input_data?: Record<string, unknown> | null },
  resultUrl: string,
): Promise<RecoveredComposite | undefined> {
  const input = row.input_data ?? {}
  const maskUrl = text(input.maskUrl)
  if (!maskUrl) return undefined

  if (row.job_type === "generate-image" || row.job_type === "reference-board") {
    const { isInpaint, inpaintBase } = generateImageModelOf({
      model: text(input.model),
      provider: text(input.provider),
      aspectRatio: text(input.aspectRatio),
      baseImageUrl: text(input.baseImageUrl),
      referenceImageUrls: Array.isArray(input.referenceImageUrls) ? (input.referenceImageUrls as string[]) : undefined,
      maskUrl,
    })
    if (!isInpaint || !inpaintBase) return undefined
    return { url: await compositeInpaint({ baseUrl: inpaintBase, resultUrl, maskUrl, jobId: row.id }) }
  }

  if (row.job_type === "image-to-image") {
    const provider = text(input.provider)
    const sourceUrl = text(input.imageUrl)
    if (!provider || !sourceUrl || KIE_IMAGE_MODELS[provider]?.maskEditRedrawsOutside !== true) return undefined
    const pasted = await pasteSourceOutsideMask({ sourceUrl, resultUrl, maskUrl, jobId: row.id, transparent: text(input.background) === "transparent" })
    return pasted ? { url: pasted, extraOutputData: { maskComposited: true } } : undefined
  }

  return undefined
}
