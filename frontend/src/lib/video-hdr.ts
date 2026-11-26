/**
 * The editor's side of the HDR size rule (`videoHdrResolutionProblem`, Kling
 * 4.0: HDR at 1080p or 4K only): the refusal sentence in the interface
 * language, with the sizes the shared rule names.
 */
import { getModel } from "@nodaro/shared/model-catalog"
import { applyDefaultVideoSelection, type VideoHdrResolutionProblem } from "@nodaro/shared/models"
import { videoHdrAddonCreditId } from "@nodaro/shared/credits"
import { uiResolutionFill } from "@nodaro/shared/video"
import { tx, type TFunction } from "@/lib/i18n"

export function hdrResolutionText(provider: string, problem: VideoHdrResolutionProblem, t: TFunction = tx): string {
  return t("nodeRun.hdrResolution", {
    model: getModel(provider)?.label ?? provider,
    resolution: problem.resolution,
    sizes: problem.hdrResolutions.join(" / "),
  })
}

/**
 * The credit id of a Generate Video node's HDR add-on (Kling 4.0 with HDR on,
 * `videoHdrAddonCreditId`): its own row on the output seconds, at the size the
 * node runs at (its resolution, else the model's UI fill). Undefined for every
 * other node, an SDR one, or HDR at a size the run refuses. The node's pill and
 * the run estimate add its price to the clip's, as the run holds both.
 */
export function hdrAddonCreditIdOf(node: { type?: string | null; data?: unknown }): string | undefined {
  if (node.type !== "generate-video") return undefined
  const data = (node.data ?? {}) as Record<string, unknown>
  const { provider, duration } = applyDefaultVideoSelection({ provider: data.provider as string | undefined, duration: data.duration as number | string | undefined })
  const resolution = (data.resolution as string | undefined) ?? uiResolutionFill(provider)
  return videoHdrAddonCreditId(provider, duration, resolution, data.dynamicRange)
}
