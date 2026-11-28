import { isOwnStoredFileUrl } from "./own-storage-url.js"
import { r2KeyFromPublicUrl } from "./r2-public-key.js"
import { getRuntimeEnv } from "./runtime-env.js"
import type { PluginVideoAssemblyInput } from "./private-plugins/types.js"

type Inputs = Pick<PluginVideoAssemblyInput, "clips" | "canvas" | "retainedCuts">
type Obj = Record<string, unknown>

function record(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {}
}

export function ownedAssemblyKey(jobId: string, url: unknown): string | null {
  if (typeof url !== "string" || !isOwnStoredFileUrl(url)) return null
  const key = r2KeyFromPublicUrl(url, process.env.R2_PUBLIC_URL)
  return key?.startsWith(`videos/${jobId}-`) && !key.slice(7).includes("/") && !new URL(url).search && !new URL(url).hash ? key : null
}

function orderedClips(jobId: string, value: unknown): Inputs["clips"] | null {
  if (!Array.isArray(value) || !value.length) return null
  const clips: Inputs["clips"] = []
  for (const [index, part] of value.entries()) {
    const { url, segment } = record(part)
    if (segment !== index + 1 || typeof url !== "string" || !ownedAssemblyKey(jobId, url)) return null
    clips.push({ url, segment })
  }
  return clips
}

/** The same successful jobs CAS publishes the clips and schedules assembly.
 * This private column freezes the approved inputs independently of later output edits. */
export function assemblyRecoveryColumns(jobId: string, jobType: unknown, output: Obj, owner: unknown, watermark: unknown): Obj {
  if ((jobType !== "generate-video-pro" && jobType !== "edit-video-pro") || output.deliveryMode !== "separate_clips") return {}
  if (typeof owner !== "string" || (watermark != null && typeof watermark !== "boolean")) return {}
  const delivered = orderedClips(jobId, output.unassembledClips)
  if (!delivered || output.videoUrl !== delivered[0].url) return {}
  const inputs: Inputs = { clips: delivered }
  if (jobType === "edit-video-pro") {
    const pro = record(output.pro)
    const { width, height } = record(pro.source)
    if (typeof width !== "number" || typeof height !== "number" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return {}
    inputs.canvas = { width, height }
    const complete = orderedClips(jobId, output.assemblyClips)
    if (complete) inputs.clips = complete
    else if (output.assemblyInputsPending === true) {
      const cuts = record(pro.cuts)
      const retainedCuts: NonNullable<Inputs["retainedCuts"]> = {}
      for (const side of ["head", "tail"] as const) {
        const field = `${side}Url` as const
        const url = cuts[field]
        if (url == null) continue
        if (typeof url !== "string" || ownedAssemblyKey(jobId, url) !== `videos/${jobId}-cut-${side}.mp4`) return {}
        retainedCuts[field] = url
      }
      if (!Object.keys(retainedCuts).length) return {}
      inputs.retainedCuts = retainedCuts
    } else return {}
  }
  return {
    video_assembly_recovery: {
      env: getRuntimeEnv(), state: "pending", attempts: 0, due: Date.now() + 60_000,
      inputs, delivered, primary: output.videoUrl, jobType, owner, watermark: watermark === true,
    },
  }
}
