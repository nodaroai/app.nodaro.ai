import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { applyEdlCreditId } from "@nodaro/shared"
import { buildEffectiveEdl, validateEffectiveEdl, applyEdlReserveMinutes } from "../lib/apply-edl-plan.js"
import { isPreviewRender } from "../lib/preview-render.js"
import { APPLY_EDL_CLIP_KEY_PATTERN } from "../lib/apply-edl-output.js"

/** An SDK/MCP caller may send the EDL as a JSON string on the `edl` field;
 *  parse it before `buildEffectiveEdl` so this ingress behaves identically to
 *  the DAG payload-builder (which parses the stringified `edl` handle value).
 *  A non-string passes through; unparseable → undefined → an empty EDL → 400. */
function parseEdlMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

/** The 400 every refused EDL gets. The issues ride BOTH the `issues` array and
 *  the message: the SDK and the CLI surface only `code` + `message` (a
 *  `NodaroError`), so an issue left out of the message — the 3-hour cap, a
 *  missing source — would reach them as a bare "EDL failed validation". */
function invalidEdlBody(issues: readonly string[]) {
  const shown = issues.slice(0, 3)
  const more = issues.length - shown.length
  return {
    error: {
      code: "invalid_edl",
      message: `EDL failed validation: ${shown.join("; ")}${more > 0 ? ` (+${more} more)` : ""}`,
      issues,
    },
  }
}

/** The render quality the request names, read off the RAW body as the credit
 *  guard reads it (before Zod). The guard prices `applyEdlCreditId` of this and
 *  the handler reserves `applyEdlCreditId` of the parsed `quality`: the same id
 *  for every body the schema accepts (absent → "final" both ways). */
function rawQualityOf(body: unknown): unknown {
  return ((body ?? {}) as Record<string, unknown>).quality
}

/** The EDL the request describes, read off the RAW body exactly as the credit
 *  guard's `computeCredits` reads it (before Zod). */
function effectiveEdlOfRawBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  return buildEffectiveEdl(parseEdlMaybe(b.edl), {
    crossfadeMs: typeof b.crossfadeMs === "number" ? b.crossfadeMs : 0,
    sourceOverrides: Array.isArray(b.sources) ? (b.sources as string[]) : undefined,
  })
}

const applyEdlBody = z.object({
  /** The edit decision list. Wired (json handle) or hand-written; coerced by
   *  `normalizeEdl` then structurally validated. Media resolves from each
   *  `EdlSource.url`. */
  edl: z.unknown(),
  /** Optional media-URL overrides for `EdlSource[i].url`, POSITIONAL in this
   *  array's order (the node's `sources` input). SSRF-guarded like every media
   *  URL the platform fetches. */
  sources: z.array(safeUrlSchema).optional(),
  /** Optional upstream Transcript (from `transcribe`'s json handle) to remap
   *  through the cut for the `json` output handle. Object or JSON string. */
  transcript: z.unknown().optional(),
  output: z.enum(["video", "audio"]).optional().default("video"),
  quality: z.enum(["proxy", "final"]).optional().default("final"),
  /** Default crossfade (ms) on boundaries with no explicit transition;
   *  per-boundary clamped to the ffmpeg-xfade limit. 0 = hard cuts. */
  crossfadeMs: z.number().min(0).max(5000).optional().default(0),
  /** The plan clip this render cuts (`edlSpanKey` of the Edit Plan's clip,
   *  `${min inMs}-${max outMs}`), stamped on the result as `clipKey` so a
   *  render's results can be matched to the clips they came from. The editor
   *  sends it for a clip-pack render; omit it for anything else. */
  clipKey: z.string().regex(APPLY_EDL_CLIP_KEY_PATTERN).optional(),
  userId: z.string().uuid().optional(),
})

export async function applyEdlRoutes(app: FastifyInstance) {
  app.post("/v1/apply-edl", {
    // A word-level transcript for a multi-hour episode is several MB — well over
    // the app's 1 MB default JSON bodyLimit — and this route accepts one on the
    // `transcript` field (remapped through the cut for the json handle). Raise the
    // limit to match the edit-plan shim so an SDK/MCP caller passing a full
    // episode transcript isn't 413'd. The DAG path carries the transcript in the
    // job payload, not the HTTP body, so this only guards the direct REST POST.
    bodyLimit: 24 * 1024 * 1024,
    preHandler: [
      // Ingress validation FIRST, ahead of the credit guard: an EDL the
      // executor would refuse (over the 3-hour output cap, an unresolvable
      // source, …) is a 400 naming the problem — never a 402 "insufficient
      // credits" for a render that could not run at any balance. Nothing is
      // reserved either way (the reservation is in the handler, after its own
      // validation of the Zod-parsed body, kept as defense in depth).
      async (req, reply) => {
        const b = (req.body ?? {}) as Record<string, unknown>
        const validation = validateEffectiveEdl(effectiveEdlOfRawBody(b), b.output === "audio" ? "audio" : "video")
        if (!validation.ok) return reply.status(400).send(invalidEdlBody(validation.issues))
      },
      // Priced on the row of the render's quality: a preview (`proxy`) on
      // `apply-edl:proxy`, a final on `apply-edl` — the id `applyEdlCreditId`
      // names here, in `computeCredits` and at the reservation below.
      creditGuard((req) => applyEdlCreditId(rawQualityOf(req.body)), {
        // Probe-at-reserve on the RENDERED duration: build the same effective EDL
        // the handler renders, reserve `perMinute × ceil(edlDurationMs/60000)`.
        // Base (pre-markup) — creditGuard applies the markup so check and reserve
        // agree. Read the per-minute RATE from model_pricing via
        // getModelCreditBaseCost (mirroring dubbing) so an admin retune tunes
        // BOTH the single-node route AND the DAG (which reserves the same via
        // applyEdlCreditOverride). Without this the route stayed pinned to the
        // code constant while DAG runs moved to the DB rate. ee import is
        // dynamic (shim pattern; computeCredits only runs under hasCredits()).
        computeCredits: async (body) => {
          const eff = effectiveEdlOfRawBody(body)
          const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
          const { creditCost } = await getModelCreditBaseCost(applyEdlCreditId(rawQualityOf(body)))
          return creditCost * applyEdlReserveMinutes(eff)
        },
      }),
    ],
  }, async (req, reply) => {
    const parsed = applyEdlBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { edl, sources, transcript, output, quality, crossfadeMs, clipKey } = parsed.data
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    // Build the ONE effective EDL every stage agrees on (route reserve, worker
    // render, transcript remap) and validate it at INGRESS — a bad/unresolvable
    // source id or a video edit with a picture-less segment is a 400 naming it,
    // never a mid-render failure after credits are reserved.
    const effectiveEdl = buildEffectiveEdl(parseEdlMaybe(edl), { crossfadeMs, sourceOverrides: sources })
    const validation = validateEffectiveEdl(effectiveEdl, output)
    if (!validation.ok) {
      return reply.status(400).send(invalidEdlBody(validation.issues))
    }

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      // A preview (proxy) is private on every lane (F1).
      force_private: extractForcePrivate(req.body) || isPreviewRender("apply-edl", quality) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(
        { edl: effectiveEdl, transcript, output, quality, crossfadeMs, ...(clipKey ? { clipKey } : {}) },
        "apply-edl",
      ),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // The job is always `apply-edl`; its credit row follows the quality.
    const reservation = await reserveCreditsForJob(req, reply, job.id, applyEdlCreditId(quality))
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("apply-edl", {
      jobId: job.id,
      edl: effectiveEdl,
      transcript,
      output,
      quality,
      ...(clipKey ? { clipKey } : {}),
      usageLogId,
    })

    return { jobId: job.id }
  })
}
