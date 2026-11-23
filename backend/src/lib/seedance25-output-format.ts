import type { FastifyRequest } from "fastify"
import { z } from "zod"
import { createsChildJob } from "./job-submission-context.js"

/**
 * The container a video request's result is asked for in: `"mov"` (H.264
 * yuv444p + PCM) only when the caller asked for it, the model is Seedance
 * 2.5, and the request creates a CHILD job (`createsChildJob`: internal auth
 * plus a server-only parent job id). A MOV does not play in browsers; only a
 * child job's video is never shown to its owner and is re-encoded by its
 * parent before delivery. Everything else → undefined (mp4, sent as no field).
 *
 * Shared by /v1/text-to-video and /v1/generate-video (here rather than in
 * either route: text-to-video already imports from generate-video).
 */
export function seedance25OutputFormatFor(
  req: FastifyRequest,
  provider: string | undefined,
  requested: "mp4" | "mov" | undefined,
): "mov" | undefined {
  return requested === "mov" && provider === "seedance-2-5" && createsChildJob(req) ? "mov" : undefined
}

/**
 * The fields a server-side CHILD job sends /v1/generate-video (Video Remake's
 * engine children) beyond its public body. Neither is a public field: no SDK,
 * MCP, docs or OpenAPI entry (the route registers its body without them).
 *
 * - `outputFormat`: the container, honoured only through
 *   `seedance25OutputFormatFor`; any other request is treated as mp4, the
 *   field dropped. Never moves the price.
 * - `contentPolicyRewrite`: accepted so a child's body is not refused, and a
 *   no-op — this route never rewords a refused prompt (the reword-once retry
 *   is /v1/text-to-video's alone). Dropped before the job is recorded.
 * - `deferSettlement`: the child's usage log stays `reserved` after it
 *   completes, until its plugin settles or releases it
 *   (lib/deferred-child-settlement.ts). Honoured only through
 *   `deferSettlementHonoured` (a trusted plugin child of the caller's own
 *   plugin job); any other request has it ignored. Dropped from the body; the
 *   job records it as the server-only `input_data.__deferSettlement`.
 */
export const generateVideoChildFields = {
  outputFormat: z.enum(["mp4", "mov"]).optional(),
  contentPolicyRewrite: z.boolean().optional(),
  deferSettlement: z.boolean().optional(),
}
