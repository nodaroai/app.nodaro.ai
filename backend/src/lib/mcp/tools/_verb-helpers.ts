/**
 * Shared helpers for verb tools — JSON-RPC response builders + job-id parsing.
 *
 * Widget rendering: per the MCP Apps spec (SEP-1865), tools that produce UI
 * declare `_meta.ui.resourceUri` on the tool definition (in `verbs-*.ts`).
 * This module is responsible for the tool RESULT shape: text content + a
 * `structuredContent` payload that the iframe consumes via the host's
 * `ui/notifications/tool-result` event.
 *
 * The `widgetKind` parameter routes the task into the in-process registry
 * (so `tasks/get` can look up the job's media kind) AND chooses the
 * structuredContent shape the iframe expects.
 */
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { registerTask } from "../tasks.js"
import { resolveAssetId } from "../asset-resolver.js"
import { config } from "../../config.js"
import { validateModelInput } from "@nodaro/shared"

/**
 * Path-1 structured-field input shared by the image AND video generation
 * verbs. The keys here MUST stay aligned with what `renderStructuredFields`
 * (@nodaro/shared) actually reads (person/styling/setting/camera/lens + the
 * `mood` shorthand) — a typed `z.object` so the tool advertises exactly the
 * honored keys to the client. (Previously generate_video used an open
 * `z.record(z.string(), z.unknown())`, which accepted plausible keys the
 * renderer silently ignored — e.g. `camera.angle` — dropping the directive.)
 */
export const StructuredFields = z
  .object({
    person: z
      .object({
        age: z.number().int().min(0).max(120).optional(),
        gender: z.enum(["man", "woman", "child", "non-binary"]).optional(),
        hair: z.string().optional(),
        eyes: z.string().optional(),
        expression: z.string().optional(),
        profession: z.string().optional(),
        warriorType: z.string().optional(),
      })
      .optional(),
    styling: z
      .object({
        mood: z.string().optional(),
        lighting: z.string().optional(),
        aesthetic: z.string().optional(),
        colorLook: z.string().optional(),
      })
      .optional(),
    setting: z
      .object({
        era: z.string().optional(),
        atmosphere: z.string().optional(),
        backdrop: z.string().optional(),
      })
      .optional(),
    camera: z
      .object({
        framing: z.string().optional(),
        motion: z.string().optional(),
        format: z.string().optional(),
      })
      .optional(),
    lens: z
      .object({
        focalLength: z.string().optional(),
        aperture: z.string().optional(),
      })
      .optional(),
    mood: z.string().optional(),
  })
  .partial()

/**
 * Shared output schema (raw Zod shape) for verb tools that return a single job
 * via {@link jobResultWithWidget}. It is a SUPERSET of every key `widgetData`
 * can carry (the {@link SingleJobStructuredContent} fields). `zod-to-json-schema`
 * emits `additionalProperties:false` for a plain object, so strict MCP clients
 * (Cursor) that cache the schema from `tools/list` reject any result carrying
 * an undeclared key. Tools that emit `prompt`/`model`/etc. in their
 * structuredContent MUST declare them here — using this shared shape keeps the
 * declared keys and the emitted keys in lockstep.
 */
export const JOB_OUTPUT_SCHEMA = {
  jobId: z.string(),
  outputUrl: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  duration: z.number().optional(),
  userDefaults: z
    .object({
      model: z.string().optional(),
      aspectRatio: z.string().optional(),
      resolution: z.string().optional(),
      quality: z.string().optional(),
    })
    .optional(),
}

interface ParsedJobBody {
  jobId?: string
  job_id?: string
  id?: string
}

export function parseJobId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as ParsedJobBody
    return parsed.jobId ?? parsed.job_id ?? parsed.id ?? null
  } catch {
    return null
  }
}

/**
 * Build a tool-error result from an internal route's response, classified by
 * status. 4xx are caller-actionable, so we surface the route's
 * `error.message` (lets the LLM self-correct on a validation/credit error).
 * 5xx / 503 bodies can carry internal detail (DB/SQL strings, internal
 * hostnames, operator-only remediation text), so we NEVER forward the raw
 * body — only a generic, classified message.
 */
export function errorResult(statusCode: number, body: string) {
  return {
    content: [{ type: "text" as const, text: formatRouteError(statusCode, body) }],
    isError: true as const,
  }
}

function formatRouteError(statusCode: number, body: string): string {
  let code: string | undefined
  let message: string | undefined
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }
    if (parsed?.error && typeof parsed.error === "object") {
      if (typeof parsed.error.code === "string") code = parsed.error.code
      if (typeof parsed.error.message === "string") message = parsed.error.message
    }
  } catch {
    // non-JSON body — fall through to a generic message (never echoed for 5xx)
  }
  if (statusCode === 402) return "Nodaro: insufficient credits for this generation."
  if (statusCode === 429) return "Nodaro: rate limited — wait a moment and try again."
  if (statusCode >= 400 && statusCode < 500) {
    // Surface the structured code (a safe API-contract identifier, e.g.
    // "validation_error") + the human message so the LLM can self-correct —
    // but never the raw body.
    const detail = message ?? "invalid request"
    return `Nodaro rejected the request (${statusCode}${code ? ` ${code}` : ""}): ${detail}`
  }
  if (statusCode === 503) return `Nodaro: this model is not available right now.${code ? ` [${code}]` : ""}`
  return `Nodaro had a server error (${statusCode}) — usually transient, please try again.${code ? ` [${code}]` : ""}`
}

export function parseFailure(body: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Submitted but couldn't parse job_id from response: ${body}`,
      },
    ],
    isError: true,
  }
}

/**
 * Coerce a tolerant ref-array input into a clean string[].
 *
 * MCP clients sometimes serialize array params as a JSON-encoded STRING
 * (`"[\"https://…\"]"`) or pass a single bare URL. Ref-array schemas accept
 * `array | string` so those calls don't hard-reject; this helper normalizes
 * whatever arrived into a trimmed, capped string array (the "tool calls
 * should never reject — normalize" principle).
 */
export function coerceStringArray(value: unknown, max: number): string[] {
  let items: unknown[]
  if (Array.isArray(value)) {
    items = value
  } else if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        items = Array.isArray(parsed) ? parsed : [trimmed]
      } catch {
        items = [trimmed]
      }
    } else {
      items = [trimmed]
    }
  } else {
    return []
  }
  return items
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, max)
}

/**
 * Normalize a mixed ref input (array | JSON-string | lone string) where each
 * item is either a public URL or a Nodaro asset id. Asset ids are resolved
 * via `resolveAssetId` (kind-typed); unresolvable entries are dropped.
 * Shared by generate_image and animate_image so every ref param tolerates
 * the same client quirks.
 */
export async function resolveRefArray(
  value: unknown,
  userId: string,
  expectedKind: "image" | "video" | "audio",
  max: number,
): Promise<string[]> {
  const items = coerceStringArray(value, max)
  // Resolve asset ids concurrently (up to ~15 per call across the verb
  // tools); order is preserved and unresolvable ids drop.
  const resolved = await Promise.all(
    items.map((item) =>
      /^https?:\/\//.test(item)
        ? item
        : resolveAssetId({ assetId: item, userId, expectedKind }),
    ),
  )
  return resolved.filter((r): r is string => typeof r === "string" && r.length > 0)
}

/**
 * Cross-check the user's lever values against the chosen model's catalog
 * entry. Returns an MCP error result if the combo is invalid; null if OK.
 *
 * Surfaces the allowed values in the error so Claude can self-correct on
 * retry instead of guessing. Without this gate, sending an unsupported
 * aspect_ratio (e.g. 21:9 to GPT Image, which only allows 1:1/3:2/2:3) was
 * silently dropped by the provider and the user got a 1:1 back.
 */
export function checkModelLevers(
  modelId: string,
  input: { aspectRatio?: string; resolution?: string; quality?: string; duration?: number },
) {
  const issue = validateModelInput(modelId, input)
  if (!issue) return null
  return {
    content: [{ type: "text" as const, text: `Invalid input: ${issue.message}` }],
    isError: true as const,
  }
}

export type WidgetKind = "image" | "video" | "audio" | "generic"

const TASK_KIND_MAP: Record<WidgetKind, "image" | "video" | "audio"> = {
  image: "image",
  video: "video",
  audio: "audio",
  generic: "image", // map generic → image for task registry (jobs.kind enum has no generic)
}

export interface SingleJobStructuredContent {
  jobId: string
  prompt?: string
  model?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  outputUrl?: string
  /**
   * Snapshot of the user's currently-saved MCP image preferences. The
   * widget reads it to render the favorite-settings star next to the
   * metadata badges — filled when the values used for this generation
   * match the saved defaults, empty when they diverge.
   *
   * NOTE on schema cache: this field is declared in each verb tool's
   * `outputSchema`; strict clients (Cursor) cache schemas via
   * `tools/list` and reject results containing fields the cached
   * version doesn't know about. Refresh / reconnect the client after
   * any change here.
   */
  userDefaults?: {
    model?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
  }
}

interface JobResultOpts {
  jobId: string
  label: string
  session: McpSession
  widgetKind?: WidgetKind
  /**
   * Per-call data delivered to the iframe via tool-result. The iframe's
   * widget script reads this from `e.detail.structuredContent` on the
   * `mcp-tool-result` event.
   */
  widgetData?: Omit<SingleJobStructuredContent, "jobId">
}

/**
 * Build the standard verb-tool result: text + structuredContent.
 *
 * Async-friendly: we DO NOT include `_meta.task_id` and we DO NOT mention
 * `tasks/get` in the text. Some clients (Cursor in particular) interpret
 * either signal as "this tool is still pending, poll until it finishes" and
 * cancel the request when the async generation doesn't complete within a
 * few seconds. The widget (in MCP Apps hosts like Claude.ai) reads the
 * jobId from `structuredContent` and polls `get_asset` itself; clients
 * without widget support get a clean sync result with the jobId in text.
 */
export function jobResultWithWidget(opts: JobResultOpts) {
  const { jobId, label, session, widgetKind, widgetData } = opts
  if (widgetKind) {
    registerTask({
      taskId: jobId,
      userId: session.userId,
      kind: TASK_KIND_MAP[widgetKind],
    })
  }

  const text = {
    type: "text" as const,
    text: `${label} started (id ${jobId}). It will appear at the top of your Nodaro library when ready: https://app.nodaro.ai/gallery`,
  }

  if (!widgetKind) {
    return { content: [text] }
  }

  const structuredContent: SingleJobStructuredContent = {
    jobId,
    ...widgetData,
  }

  return {
    content: [text],
    structuredContent: structuredContent as unknown as Record<string, unknown>,
  }
}

/**
 * Dispatch a generation job to an internal route and build the standard
 * verb-tool result. Collapses the repeated `fastify.inject` → statusCode →
 * parseJobId → parseFailure → jobResultWithWidget tail that every generation
 * verb handler shares (identical constant headers; only url/payload/label/
 * widgetKind/widgetData differ). Behavior is identical to the inline form.
 */
export async function dispatchJob(
  fastify: FastifyInstance,
  session: McpSession,
  opts: {
    url: string
    payload: unknown
    label: string
    widgetKind?: WidgetKind
    widgetData?: Omit<SingleJobStructuredContent, "jobId">
  },
) {
  const res = await fastify.inject({
    method: "POST",
    url: opts.url,
    headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
    payload: opts.payload as string | object | Buffer | undefined,
  })
  if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
  const jobId = parseJobId(res.body)
  if (!jobId) return parseFailure(res.body)
  return jobResultWithWidget({ jobId, label: opts.label, session, widgetKind: opts.widgetKind, widgetData: opts.widgetData })
}

/**
 * Legacy alias — v1.1 callers used `jobResult(jobId, label)` without widgets.
 * Prefer `jobResultWithWidget` going forward.
 */
export function jobResult(jobId: string, label: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${label} started (id ${jobId}). It will appear at the top of your Nodaro library when ready: https://app.nodaro.ai/gallery`,
      },
    ],
  }
}
