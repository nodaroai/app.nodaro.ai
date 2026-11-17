// The video-queue handler: one Suno Speech run (providers/kie/suno-market.ts)
// delivered like every Suno music run — both takes stored, the first as the
// node's audio, each with its duration (workers/handlers/suno.ts
// `finalizeSunoJob`), marked as spoken takes so no Suno tool takes one by its
// ids as if it were a song. Never relayed to a connected cloud: an install
// with no KIE key of its own hears the plain missing-key message. Its task is
// saved under the market lane's own kind, so a job whose worker died after
// the task was created is finished from that task by the reconcile
// (lib/reconcile/kie.ts) — polled, never created again.
import { sunoSpeechProblem, sunoSpeechRun } from "@nodaro/render-rules"
import { applyPromptPolicies } from "../../lib/prompt-policy.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { providerKindForSunoMarket } from "../../lib/reconcile/provider-kind.js"
import { SUNO_TRACK_KIND_FIELD, SUNO_TRACK_KIND_SPEECH } from "../../lib/suno-id-source.js"
import { SUNO_SPEECH_PROVIDER_COST_USD, sunoSpeech } from "../../providers/kie/suno-market.js"
import { runSunoTracksJob } from "../../workers/handlers/suno.js"
import type { UnitWorker } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

export const worker: UnitWorker = async (job, ctx) => {
  const asked = sunoSpeechRun(job.data as Record<string, unknown>)
  const problem = sunoSpeechProblem(asked)
  if (problem) throw new DeterministicJobError(problem)
  console.log(`[worker] ${descriptor.type} ${ctx.jobId} (mode: ${asked.mode})`)

  await runSunoTracksJob(job, ctx, "Suno Speech returned no takes", () => {
    // The audio prompt policy, at the worker as for every Suno run. A Brief's
    // scene description is policed like a music prompt; a Script's spoken
    // words are never rewritten (a clause would be read aloud, as for any
    // text-to-speech) — its tone is the description policed, and a forced
    // voice gender applies. Brief mode has no gender field to carry one.
    const policed = asked.mode === "brief"
      ? applyPromptPolicies({ prompt: asked.prompt ?? "", negativePrompt: "", kind: "audio" })
      : applyPromptPolicies({ prompt: asked.tone ?? "", negativePrompt: "", kind: "audio", vocalGender: asked.vocalGender })
    const run = asked.mode === "brief"
      ? sunoSpeechRun({ mode: "brief", prompt: policed.prompt })
      : sunoSpeechRun({ ...asked, tone: policed.prompt, vocalGender: policed.vocalGender ?? asked.vocalGender })
    // A policy may have lengthened the brief or the tone: the run is held to
    // the provider's limits again as it will be sent, and refused (and
    // refunded) rather than cut — a cut would drop the policy's own words.
    const policedProblem = sunoSpeechProblem(run)
    if (policedProblem) throw new DeterministicJobError(policedProblem)
    return sunoSpeech(run, { onTaskCreated: makeOnTaskCreated(ctx.jobId, providerKindForSunoMarket()), modelKey: descriptor.type })
  }, SUNO_SPEECH_PROVIDER_COST_USD, { [SUNO_TRACK_KIND_FIELD]: SUNO_TRACK_KIND_SPEECH })
}
