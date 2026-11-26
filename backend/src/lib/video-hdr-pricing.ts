import type { FastifyReply, FastifyRequest } from "fastify"
import { applyDefaultVideoSelection, videoHdrResolutionProblem } from "@nodaro/shared/models"
import { noteAddon } from "./video-price-notes.js"
import { noteExpectedBase } from "./price-notes.js"
import { videoHdrAddonBaseCredits } from "./video-hdr-addon.js"
import { videoRequestAsRun } from "./video-request-norm.js"
import { trustedPluginParentJobId } from "./job-submission-context.js"

/**
 * A plugin's own child (Generate Video Pro's segments, and every other engine a
 * plugin runs) never renders HDR (decided 2026-11-22: no HDR in Generate Video
 * Pro): the field is removed from the body before anything reads it, so the
 * child is sent, held and charged SDR whatever it carried. Runs first among
 * the video routes' pre-checks.
 */
export async function dropHdrFromPluginChildPreHandler(req: FastifyRequest): Promise<void> {
  const body = req.body
  if (!body || typeof body !== "object" || !("dynamicRange" in body)) return
  if (trustedPluginParentJobId(req) === undefined) return
  const { dynamicRange: _dropped, ...rest } = body as Record<string, unknown>
  req.body = rest
}

/**
 * HDR at a size the model does not render it at (Kling 4.0 at 720p, or with
 * no size named, which renders 720p) is refused before anything is held
 * (decided 2026-11-22): a 400 with the shared sentence
 * (`videoHdrResolutionProblem`). A pre-check of `/v1/generate-video` and
 * `/v1/text-to-video`, so a quote of such a body refuses too. Judged on the
 * model the run uses (the platform default when none is named) and the size
 * it renders, never on the raw spelling.
 */
export async function refuseHdrAtUnsupportedResolutionPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { provider } = applyDefaultVideoSelection({ provider: typeof body.provider === "string" ? body.provider : undefined })
  const problem = videoHdrResolutionProblem(provider, {
    resolution: typeof body.resolution === "string" ? body.resolution : undefined,
    dynamicRange: body.dynamicRange,
    nothingCharged: true,
  })
  if (problem) {
    return reply.status(400).send({ error: { code: problem.code, message: problem.message } })
  }
}

type ComputeCredits = (rawBody: unknown, req: FastifyRequest) => Promise<number>

/**
 * A video route's `computeCredits` with the HDR add-on on top: whatever base
 * the route priced (its ladder row, or a reference-video run's measured
 * worst case) plus the add-on's own row on the output seconds, at the
 * normalized size the check identifier was built from (`req.videoNorm`). The
 * expected cost a quote shows carries it too. 0 on every SDR run, so every
 * other request prices exactly as before.
 */
export function withVideoHdrAddon(compute: ComputeCredits): ComputeCredits {
  return async (rawBody, req) => {
    const base = await compute(rawBody, req)
    const norm = req.videoNorm
    const b = videoRequestAsRun((rawBody ?? {}) as Record<string, unknown>, norm)
    const sel = applyDefaultVideoSelection({
      provider: typeof b.provider === "string" ? b.provider : undefined,
      duration: b.duration as number | string | undefined,
    })
    const hdr = await videoHdrAddonBaseCredits({
      provider: sel.provider,
      duration: norm?.duration ?? sel.duration,
      resolution: norm?.resolution ?? (typeof b.resolution === "string" ? b.resolution : undefined),
      dynamicRange: b.dynamicRange,
    })
    if (hdr <= 0) return base
    noteAddon(req, "hdr_addon", hdr)
    const expected = req.priceNotes?.expectedBase
    if (expected !== undefined) noteExpectedBase(req, expected + hdr)
    return base + hdr
  }
}
