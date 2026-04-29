/**
 * Shared helpers for verb tools — JSON-RPC response builders, job-id parsing,
 * and v1.2 widget integration. The widget integration registers an MCP task
 * (so `tasks/get` works) and wraps the appropriate widget HTML alongside the
 * text response so the host can render the inline preview.
 */
import type { McpSession } from "../session.js"
import { registerTask } from "../tasks.js"
import { buildUIResource } from "../widgets/builder.js"
import {
  buildImageWidget,
  buildVideoWidget,
  buildAudioWidget,
  buildGenericJobWidget,
  type SingleJobInitData,
} from "../widgets/single-job.js"

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

export function errorResult(statusCode: number, body: string) {
  return {
    content: [
      { type: "text" as const, text: `Error from Nodaro: ${statusCode} ${body}` },
    ],
    isError: true,
  }
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

type WidgetKind = "image" | "video" | "audio" | "generic"

const TASK_KIND_MAP: Record<WidgetKind, "image" | "video" | "audio"> = {
  image: "image",
  video: "video",
  audio: "audio",
  generic: "image", // map generic → image for task registry (jobs.kind enum has no generic)
}

interface JobResultOpts {
  jobId: string
  label: string
  session: McpSession
  widgetKind?: WidgetKind
  widgetData?: SingleJobInitData
}

/**
 * SDK-compatible content item shape. The MCP SDK exposes a discriminated
 * union for `content[]` items (text/image/audio/resource/resource_link).
 * We're producing text + resource — type both literally so the SDK accepts
 * the return value without a wider unknown cast.
 *
 * Note: the SDK requires `resource.text` (not optional) for `rawHtml`-flavored
 * resources, so we type it as required here.
 */
type ContentItem =
  | { type: "text"; text: string }
  | {
      type: "resource"
      resource: { uri: string; text: string; mimeType?: string }
      _meta?: Record<string, unknown>
    }

/**
 * Build the standard v1.2 verb result: text content + widget UI resource +
 * `_meta.task_id` envelope. Registers the task with the in-process registry
 * so `tasks/get` can look it up later.
 *
 * If `widgetKind`/`widgetData` are omitted we fall back to a text-only result
 * (legacy v1.1 shape) — useful for verbs that don't need a preview yet.
 */
export function jobResultWithWidget(opts: JobResultOpts) {
  const { jobId, label, session, widgetKind, widgetData } = opts
  if (widgetKind && widgetData) {
    registerTask({
      taskId: jobId,
      userId: session.userId,
      kind: TASK_KIND_MAP[widgetKind],
    })
  }
  const text: ContentItem = {
    type: "text",
    text: `Submitted ${label} job ${jobId}. Track via tasks/get with task_id=${jobId}. Once it lands you'll find it at the top of https://app.nodaro.ai/library .`,
  }
  if (!widgetKind || !widgetData) {
    return { content: [text], _meta: { task_id: jobId } }
  }
  const widgetHtml = buildWidgetHtml(widgetKind, widgetData)
  const resource = buildUIResource({
    uri: `ui://nodaro/job-${widgetKind}/${jobId}`,
    content: { type: "rawHtml", htmlString: widgetHtml },
    csp: { resourceSrc: ["https://assets.nodaro.ai", "https://*.r2.cloudflarestorage.com"] },
  }) as ContentItem
  return {
    content: [text, resource],
    _meta: { task_id: jobId },
  }
}

function buildWidgetHtml(kind: WidgetKind, data: SingleJobInitData): string {
  switch (kind) {
    case "image":
      return buildImageWidget(data)
    case "video":
      return buildVideoWidget(data)
    case "audio":
      return buildAudioWidget(data)
    case "generic":
      return buildGenericJobWidget(data)
  }
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
        text: `Submitted ${label} job ${jobId}. Track via tasks/get with task_id=${jobId}. Once it lands you'll find it at the top of https://app.nodaro.ai/library .`,
      },
    ],
    _meta: { task_id: jobId },
  }
}
