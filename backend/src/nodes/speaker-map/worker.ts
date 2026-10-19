// The video-queue handler: which camera each speaker is on
// (providers/audio/speaker-map.ts), completed with the published result on
// `json` and the whole-recording edit on its own `edl` key, so each lands on
// its own output.
import { SPEAKER_MAP_DEFAULT_MARGIN_DB, SPEAKER_MAP_VERSION, type SpeakerMapResult } from "@nodaro/shared/edl"
import { computeSpeakerMap, type SpeakerMapJobInput } from "../../providers/audio/speaker-map.js"
import { commitJobCredits, markJobCompleted, setJobProgress, shouldSaveJobResult } from "../../workers/shared.js"
import type { UnitWorker } from "../kit.js"

export const worker: UnitWorker = async function handleSpeakerMap(job, ctx) {
  const data = job.data as Omit<SpeakerMapJobInput, "marginDb"> & { jobId: string; marginDb?: number }
  console.log(`[worker] speaker-map ${ctx.jobId}: ${data.sources.length} sources`)
  const computed = await computeSpeakerMap({ ...data, marginDb: data.marginDb ?? SPEAKER_MAP_DEFAULT_MARGIN_DB })
  // The contract's shape, checked by the compiler: the job body returns the
  // decision and the edit, the worker adds the version.
  const result: SpeakerMapResult = { version: SPEAKER_MAP_VERSION, ...computed }
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: { json: result, ...(result.edl ? { edl: result.edl } : {}) } })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${Object.values(result.speakerMap).filter(Boolean).length}/${Object.keys(result.speakerMap).length} speakers mapped`)
}
