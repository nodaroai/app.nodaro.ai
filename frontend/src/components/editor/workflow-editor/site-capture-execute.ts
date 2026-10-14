/**
 * The canvas's own run of Site Capture — the twin of the orchestrator's
 * sync-HTTP lane (backend node-executor.ts): the same body (the page from
 * `siteCapturePageUrl`, the stills count from `siteCaptureMaxStills`), the same
 * job polled to its end, and the same outputs (`siteCaptureNodeOutputs`, all in
 * `@nodaro/shared`). A capture takes up to a few minutes, past the edge timeout,
 * so the route always answers with a job id.
 */
import { siteCaptureMaxStills, siteCaptureNodeOutputs, siteCapturePageUrl } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { siteCapture } from "@/lib/api"
import { tx } from "@/lib/i18n"
import { scrapeResultPatch } from "@/components/nodes/scrape-result-recovery"
import { applySiteCaptureFailure, applySiteCaptureResult, siteCaptureRunStartPatch } from "@/components/nodes/site-capture-run-state"
import type { SiteCaptureNodeData, WorkflowNode } from "@/types/nodes"
import type { FrontendResolvedInputs } from "./node-input-resolver"
import { guardedToast, pollScrapeJobOutput } from "./poll-job"
import type { ExecutionContext } from "./types"

/** Run Site Capture: returns its first still (the `image` pip's value), or "" when it has none. */
export async function executeSiteCapture(node: WorkflowNode, inputs: FrontendResolvedInputs, ctx: ExecutionContext): Promise<string> {
  const d = node.data as SiteCaptureNodeData
  const { updateNodeData } = useWorkflowStore.getState()
  const url = siteCapturePageUrl(d.url, inputs.prompt)
  if (url.length === 0) {
    const message = tx("nodeRun.siteCaptureNoUrl")
    updateNodeData(node.id, applySiteCaptureFailure(message))
    guardedToast.error(message)
    throw new Error(message)
  }

  updateNodeData(node.id, siteCaptureRunStartPatch())
  let jobId = ""
  try {
    const started = await siteCapture({ url, maxStills: siteCaptureMaxStills(d.maxStills) })
    jobId = started.jobId
    const output = await pollScrapeJobOutput(jobId, node.id, { signal: ctx.signal })
    updateNodeData(node.id, scrapeResultPatch("site-capture", output, jobId) ?? applySiteCaptureResult(output))
    guardedToast.success(tx("nodeRun.siteCaptureCompleted"))
    return siteCaptureNodeOutputs(output).imageUrl ?? ""
  } catch (err) {
    const error = err as Error
    // Stop: the poll was aborted and the central Stop handler restored the node.
    if (error?.name === "AbortError" || ctx.signal?.aborted) return ""
    updateNodeData(node.id, applySiteCaptureFailure(error.message || tx("node.captureFailed")))
    guardedToast.error(tx("nodeRun.siteCaptureFailed", { message: error.message }))
    throw error
  }
}
