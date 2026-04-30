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
import type { McpSession } from "../session.js"
import { registerTask } from "../tasks.js"

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
    text: `${label} started (id ${jobId}). It will appear at the top of your Nodaro library when ready: https://app.nodaro.ai/library`,
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
 * Legacy alias — v1.1 callers used `jobResult(jobId, label)` without widgets.
 * Prefer `jobResultWithWidget` going forward.
 */
export function jobResult(jobId: string, label: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${label} started (id ${jobId}). It will appear at the top of your Nodaro library when ready: https://app.nodaro.ai/library`,
      },
    ],
  }
}
