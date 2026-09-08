import type { Job } from "bullmq"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { openBrowser, selectComposition, renderMedia, renderStill, makeCancelSignal } from "@remotion/renderer"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { createWorkDir, cleanupWorkDir } from "../providers/video/ffmpeg-utils.js"
import { uploadFileToR2 } from "../lib/storage.js"
import { applyVideoWatermark } from "../utils/watermark.js"
import { markJobCompletedDetailed, isFinalJobAttempt } from "./shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import { JobCancelledError } from "../lib/job-cancellation.js"
import { DrainAbortError, isWorkerDraining } from "../lib/worker-drain.js"
import { createSceneRenderPorts } from "../lib/private-plugins/scene3d-render-store.js"
import { requireSceneRenderParent, isRunnableSceneRenderStatus, SceneRenderParentInactiveError } from "../lib/private-plugins/scene3d-render-toolkit.js"
import { Scene3DArtifactError } from "../services/scene3d-artifacts/types.js"
import { sceneRenderCancellationCheck } from "./scene3d-cancellation-check.js"
import { sceneRenderChildId } from "../lib/private-plugins/scene3d-render-identity.js"
import { createScene3DArtifactToolkit } from "../lib/private-plugins/scene3d-artifact-toolkit.js"
import { writeScene3DPng, receiveScene3DPngIfPresent } from "../lib/private-plugins/scene3d-write-json.js"
import type { PluginSceneRenderResult } from "../lib/private-plugins/scene3d-render-contract.js"
import { prepareSceneChildAssets } from "./scene3d-child-assets.js"
import { withRenderCancellation } from "./render-cancellation.js"

export async function processSceneRenderChild(job: Job, bundle: () => Promise<string>,
  chromiumOptions: NonNullable<Parameters<typeof openBrowser>[1]>["chromiumOptions"]): Promise<void> {
  const ports = createSceneRenderPorts()
  const child = await ports.read(job.data.jobId)
  if (!child || !isRunnableSceneRenderStatus(child.status)) return
  const input = child.input
  const workDir = await createWorkDir("render")
  const controller = new AbortController()
  const cancellation = makeCancelSignal()
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined
  let assets: Awaited<ReturnType<typeof prepareSceneChildAssets>> | undefined
  const started = Date.now()
  try {
    await requireSceneRenderParent(ports, input, true)
    const { data, error } = await supabase.from("jobs").update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", child.id).eq("user_id", child.userId).in("status", ["pending", "processing"]).select("id")
    if (error) throw new Error("Could not claim scene render child")
    if (!data?.length) return
    const result = await withRenderCancellation({ jobId: child.id, timeoutMs: 25 * 60 * 1000,
      isDraining: isWorkerDraining,
      isCancelled: sceneRenderCancellationCheck(ports, child),
      cancel: async () => { controller.abort(); cancellation.cancel(); await browser?.close({ silent: true }) },
    }, async (): Promise<PluginSceneRenderResult> => {
      assets = await prepareSceneChildAssets(child, workDir, controller.signal)
      const serveUrl = await bundle()
      controller.signal.throwIfAborted()
      const browserExecutable = process.env.CHROME_PATH || undefined
      browser = await openBrowser("chrome", { browserExecutable, chromiumOptions })
      controller.signal.throwIfAborted()
      const inputProps = { plan: input.plan, assetUrls: assets.assetUrls }
      const composition = await selectComposition({ serveUrl, id: "3d-scene", inputProps,
        puppeteerInstance: browser, chromiumOptions, browserExecutable, timeoutInMilliseconds: 120000 })
      if (input.output.kind === "stills") {
        const artifacts = createScene3DArtifactToolkit()
        if (!artifacts) throw new Error("Scene private storage is unavailable")
        const frames: Extract<PluginSceneRenderResult, { kind: "stills" }>["frames"] = []
        for (const frame of input.output.frames) {
          controller.signal.throwIfAborted()
          const artifactId = sceneRenderChildId({ ...input, key: `${child.id}-${frame}` })
          const scope = { jobId: input.parentJobId, userId: input.userId, revisionId: input.plan.revisionId, artifactId }
          const existing = await receiveScene3DPngIfPresent(artifacts, scope)
          if (existing) {
            frames.push({ frame, artifactId, sha256: existing.sha256, byteLength: existing.byteLength })
            await job.updateProgress(Math.round(90 * frames.length / input.output.frames.length))
            continue
          }
          const output = join(workDir, `frame-${frame}.png`)
          await renderStill({ serveUrl, composition, inputProps, frame, imageFormat: "png", output,
            puppeteerInstance: browser, chromiumOptions, browserExecutable, timeoutInMilliseconds: 120000, logLevel: "warn" })
          controller.signal.throwIfAborted()
          const receipt = await writeScene3DPng(artifacts, { ...scope, kind: "poster", bytes: await readFile(output) }, { signal: controller.signal })
          frames.push({ frame, artifactId, sha256: receipt.sha256, byteLength: receipt.byteLength })
          await job.updateProgress(Math.round(90 * frames.length / input.output.frames.length))
        }
        return { kind: "stills", sceneRevisionId: input.plan.revisionId, frames, elapsedMs: Date.now() - started }
      }
      let output = join(workDir, "output.mp4")
      await renderMedia({ serveUrl, composition, inputProps, codec: "h264", muted: true, outputLocation: output,
        puppeteerInstance: browser, chromiumOptions, browserExecutable, cancelSignal: cancellation.cancelSignal,
        concurrency: config.REMOTION_CONCURRENCY ?? undefined, timeoutInMilliseconds: 120000, logLevel: "warn",
        onProgress: ({ progress }) => { void job.updateProgress(Math.round(progress * 90)).catch(() => {}) } })
      controller.signal.throwIfAborted()
      if (child.shouldWatermark) {
        const stamped = join(workDir, "watermarked.mp4")
        await applyVideoWatermark(output, stamped, { signal: controller.signal })
        output = stamped
      }
      controller.signal.throwIfAborted()
      await requireSceneRenderParent(ports, input, true)
      // The opaque delivery key must not be derivable from public parent/owner identities.
      const videoUrl = await uploadFileToR2(output, randomUUID(), "video", input.userId, { signal: controller.signal })
      return { kind: "video", videoUrl, sceneRevisionId: input.plan.revisionId, elapsedMs: Date.now() - started }
    })
    await requireSceneRenderParent(ports, input, true)
    const outcome = await markJobCompletedDetailed(child.id, { output_data: { sceneRenderResult: result }, is_public: false })
    if (outcome === "completed") await job.updateProgress(100)
    else if (outcome === "lost_race") {
      const current = await ports.read(child.id)
      if (current && isRunnableSceneRenderStatus(current.status)) throw new Error("Scene render completion was not retained")
    }
  } catch (error) {
    if (error instanceof JobCancelledError || error instanceof SceneRenderParentInactiveError ||
        (error instanceof Scene3DArtifactError && error.code === "SCENE_JOB_INVALID")) {
      await ports.cancel(child)
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    const terminal = !(error instanceof DrainAbortError) &&
      (error instanceof Scene3DArtifactError && error.code !== "SCENE_STORAGE_FAILED" || /composition.*not found|plan validation|zod|invalid plan|timed out|webgl/i.test(message))
    if (!terminal && !isFinalJobAttempt(job)) throw error
    await markJobFailed(child.id, { error_message: "Scene render failed" })
    throw error
  } finally {
    controller.abort()
    try { await browser?.close({ silent: true }) }
    finally { assets?.close(); await cleanupWorkDir(workDir) }
  }
}
