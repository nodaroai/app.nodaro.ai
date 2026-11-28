import { isDeepStrictEqual } from "node:util"
import { supabase } from "./supabase.js"
import { getRuntimeEnv } from "./runtime-env.js"
import { getPluginServices } from "./private-plugins/services-registry.js"
import type { PluginVideoAssemblyInput } from "./private-plugins/types.js"
import { assemblyRecoveryColumns, ownedAssemblyKey } from "./video-assembly-manifest.js"
import { discardJobScratch } from "./job-scratch.js"
import { runWithJobCancellation } from "./job-cancellation.js"
import { deleteOwnedObjects } from "./job-policy-outputs.js"
import { applyResultGate } from "./job-policy-gate.js"
import { isUserBlocked, isUserQuietStopped } from "./access-blocks.js"
import { isRestrictedAddress } from "./content-restrictions.js"
import { getR2ObjectSize, storageChargeOf } from "./storage.js"
import { companionsForRow } from "./asset-companions.js"

interface AssemblyManifest {
  jobType: PluginVideoAssemblyInput["jobType"]
  inputs: Pick<PluginVideoAssemblyInput, "clips" | "canvas" | "retainedCuts">
  owner: string
  watermark: boolean
  attemptId: string
  abandoned?: string[]
}

interface AssemblyClaim {
  id: string
  manifest: AssemblyManifest
  cleanupOnly?: boolean
  output: Record<string, unknown>
}

async function finish(claim: AssemblyClaim, state: "publish" | "retry" | "discard", fields: Record<string, unknown> = {}): Promise<boolean> {
  const result = await supabase.rpc("finish_video_assembly", {
    p_job_id: claim.id, p_attempt_id: claim.manifest.attemptId, p_state: state, ...fields,
  })
  if (result.error) throw new Error(`Assembly publication status unavailable: ${result.error.code}`)
  return result.data === true
}

async function discardAttempt(jobId: string, attemptId: string, includeCandidate: boolean): Promise<void> {
  const stem = `videos/${jobId}-assembly-${attemptId}`
  const tracked = [`${stem}-source-head.mp4`, `${stem}-source-tail.mp4`]
  if (includeCandidate) tracked.push(`${stem}.mp4`)
  const objects = (keys: string[]) => keys.map((key, index) => ({ key, index, kind: "video" as const }))
  await deleteOwnedObjects(jobId, objects(tracked), { refundOwner: true, set: null })
  await deleteOwnedObjects(jobId, objects([`${stem}-combine.mp4`]), { set: null })
}

/** One local-only assembly per worker at a time. The database owns the schedule,
 * lease, backoff and attempt limit, including recovery when the process exits. */
export async function recoverNextVideoAssembly(): Promise<void> {
  const service = getPluginServices().videoAssemblyRecovery
  if (!service) return
  const { data, error } = await supabase.rpc("claim_video_assembly", { p_env: getRuntimeEnv() })
  if (error) throw new Error(`Assembly queue unavailable: ${error.code}`)
  if (!data) return
  const claim = data as AssemblyClaim
  const { id, manifest } = claim
  for (const abandoned of manifest.abandoned ?? []) await discardAttempt(id, abandoned, true)
  if (claim.cleanupOnly) return
  const { attemptId, owner, watermark, jobType, inputs } = manifest
  let mayHavePublished = false
  let cleanCandidate = true
  try {
    const current = assemblyRecoveryColumns(id, jobType, claim.output, owner, watermark).video_assembly_recovery as AssemblyManifest | undefined
    if (!current || !isDeepStrictEqual(inputs, current.inputs)) {
      await finish(claim, "discard")
      return
    }
    const urls = [...inputs.clips.map(clip => clip.url), ...Object.values(inputs.retainedCuts ?? {})]
    const keys = urls.map(url => ownedAssemblyKey(id, url))
    if (keys.some(key => !key) || await isUserBlocked(owner) || await isUserQuietStopped(owner) ||
        (await Promise.all(urls.map(isRestrictedAddress))).some(Boolean)) {
      await finish(claim, "discard")
      return
    }

    const { videoUrl } = await runWithJobCancellation(id, owner, () =>
      service.assemble({ jobId: id, jobType, userId: owner, shouldWatermark: watermark, attemptId, ...inputs }), { assemblyAttemptId: attemptId })
    const key = ownedAssemblyKey(id, videoUrl)
    if (!key || key !== `videos/${id}-assembly-${attemptId}.mp4`) throw new Error("Assembly returned an unexpected file")
    const size = await getR2ObjectSize(key)
    if (!(size > 0)) throw new Error("Assembled file could not be verified")
    const { assemblyInputsPending: _pending, ...existing } = claim.output
    const output = { ...existing, videoUrl, deliveryMode: "simple_cuts" }
    if ((await applyResultGate(id, { output_data: output }, "direct", undefined, { replacement: true })) !== "allow") {
      await finish(claim, "discard")
      return
    }
    const companions = await companionsForRow(id, output, "video", key, storageChargeOf)
    mayHavePublished = true
    cleanCandidate = !(await finish(claim, "publish", {
      p_expected_output: claim.output, p_video_url: videoUrl, p_key: key, p_size: size,
      p_source_keys: keys, p_companions: companions,
    }))
  } catch (err) {
    // A response may be lost after PostgreSQL committed. Only a confirmed
    // transition from OUR lease back to retry permits removing that file.
    if (mayHavePublished) cleanCandidate = false
    const fenced = await finish(claim, "retry")
    if (fenced) cleanCandidate = true
    console.warn(`[video-assembly] attempt ${attemptId} for ${id} did not finish`, err instanceof Error ? err.name : "error")
  } finally {
    await discardAttempt(id, attemptId, cleanCandidate)
    await discardJobScratch(id)
  }
}

export function startVideoAssemblyRecovery(): () => void {
  if (!getPluginServices().videoAssemblyRecovery) return () => {}
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await recoverNextVideoAssembly() }
    catch (err) { console.error("[video-assembly] queue check failed", err instanceof Error ? err.message : "error") }
    finally { running = false }
  }
  const interval = setInterval(() => { void tick() }, 60_000)
  interval.unref()
  void tick()
  return () => clearInterval(interval)
}
