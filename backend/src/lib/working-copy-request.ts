import type { FastifyRequest } from "fastify"
import { z } from "zod"
import { createsChildJob } from "./job-submission-context.js"

/**
 * The request side of the working copy (providers/video/working-copy-encode.ts):
 * a server-side CHILD job's ask that its step encode the picture it hands on
 * to the next step near-lossless instead of the step's delivery encode.
 *
 * `workingCopy` is not a public field: no SDK, MCP, docs or OpenAPI entry.
 * Like /v1/generate-video's `outputFormat` (lib/seedance25-output-format.ts)
 * it is honoured only when the request creates a child job
 * (`createsChildJob`: internal auth plus a server-only parent job id); any
 * other caller has it ignored (dropped before the job is written or queued)
 * and gets the delivery encode. It never moves the price.
 *
 * Taken by POST /v1/mask-composite and POST /v1/video-face-mesh.
 */
export const workingCopyChildFields = {
  workingCopy: z.boolean().optional(),
}

/** The server-only `input_data` key that records an honoured working copy (a top-level `__` key no job read returns). */
export const WORKING_COPY_INPUT_KEY = "__workingCopy"

/** Whether THIS request's `workingCopy` is honoured: asked for (true) by a request that creates a child job. */
export function workingCopyHonoured(req: FastifyRequest, requested: boolean | undefined): boolean {
  return requested === true && createsChildJob(req)
}

/**
 * The keys an honoured working copy adds: `input_data` records it under the
 * server-only key, the queue payload carries `workingCopy: true` to the worker.
 * Nothing when it is not honoured, so the row and the payload stay as before.
 */
export function workingCopyStamp(honoured: boolean): { inputData: Record<string, true>; payload: { workingCopy?: true } } {
  return honoured
    ? { inputData: { [WORKING_COPY_INPUT_KEY]: true }, payload: { workingCopy: true } }
    : { inputData: {}, payload: {} }
}
