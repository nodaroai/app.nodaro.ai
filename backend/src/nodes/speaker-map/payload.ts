// The orchestrator payload: the video-queue job worker.ts runs, reserving the
// "speaker-map" row. The run's rules are the ones the editor's run applies
// (speakerMapRunInputs, @nodaro/render-rules), checked BEFORE the reserve:
// the orchestrated path bypasses the route's Zod, so it refuses what the
// route does — and each source must be a URL the server may fetch.
import { speakerMapRunInputs, speakerMapRunProblemText } from "@nodaro/render-rules"
import { safeUrlSchema } from "../../lib/url-validator.js"
import type { UnitPayload } from "../kit.js"

export const payload: UnitPayload = (kit) => {
  const label = typeof kit.data.label === "string" && kit.data.label.trim() ? kit.data.label : "Speaker Map"
  const run = speakerMapRunInputs(kit.resolvedInputs.unitInputs, kit.data, { fetchable: (url) => safeUrlSchema.safeParse(url).success })
  if ("problem" in run) throw new Error(speakerMapRunProblemText(run.problem, { type: "speaker-map", label }))
  return kit.ffmpegResult("speaker-map", { jobId: kit.jobId, ...run.body, usageLogId: kit.usageLogId })
}
