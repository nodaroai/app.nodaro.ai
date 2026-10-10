/**
 * Run a Nodaro-EXCLUSIVE node on the connected cloud (4b, PR 3).
 *
 * The exclusive nodes (every key of `EXCLUSIVE_ROUTE_BY_JOB_TYPE` below —
 * voice-changer-pro, generate-video-pro, edit-video-pro, video-analysis,
 * video-audit, edit-plan, camera-switch, speaker-view, speaker-frames) are implemented by @nodaroai/cloud-plugins,
 * which never loads on a self-host — so unlike the vendor-direct relay
 * (cloud-video-relay.ts) there is no local implementation to fall back FROM:
 * the connection IS the implementation. A sibling of that relay rather than a
 * CLOUD_ROUTE_BY_JOB_TYPE entry because these jobs need what the one-shot
 * replay cannot give: the cloud job id persisted BEFORE polling (stall-retry
 * must resume, never re-create), stop forwarding, a continue variant, an
 * hour-plus poll budget, and per-type output adaptation (gvp/evp are video,
 * vcp is audio-or-video, video-analysis/audit are JSON, speaker-view is a
 * render copied home as it is).
 *
 * Billing happens on the CLOUD account (the credential's owner); locally
 * `cost` stays null and `providerUsed` is "nodaro" — so the far end's job id
 * and its RESERVED credits are what the near row keeps instead (`relay_job_id`
 * / `relay_credits`, migration 383): the only record a self-host can bill its
 * own user from, and the marker that stops it deleting far-end bytes.
 */

import type { Job } from "bullmq"
import {
  markJobCompleted,
  generateAndUploadThumbnail,
  setJobProgress,
  uploadVideoMaybeWatermark,
  type JobContext,
  type HandlerFn,
} from "../shared.js"
import { uploadToR2 } from "../../lib/storage.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { supabase } from "../../lib/supabase.js"
import {
  claimJobFinalize,
  finalizeJobWithMedia,
  releaseJobFinalizeClaim,
  type FinalizeClaimant,
} from "../../lib/job-finalize.js"
import { FINALIZE_CLAIM_TTL_MS } from "../../lib/reconcile/types.js"
import {
  createCloudJob,
  waitForCloudJob,
  NodaroCloudError,
  type CloudJob,
} from "../../providers/nodaro/client.js"
import { nodaroCloudFetch } from "../../lib/nodaro-connect.js"
import { INSTANCE_ONLY_FIELDS, rehostIfUrlField } from "../../providers/nodaro/run-on-cloud.js"
import { relayFieldsFrom, relayResultFields } from "../../providers/nodaro/relay-cost.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { BUDGETED_JOB_NAMES, declaredJobBudgetMs, nodeCeilings } from "../../lib/job-budget.js"
import { checkRehostSizes, rehostSizeMessage, type RehostSizeHit } from "../../lib/rehost-size-check.js"
import { bringRenderHome } from "./relay-render-home.js"
import { bringTrackSetHome, speakerFramesRelayPayload } from "./speaker-frames-relay.js"
import { isSpeakerFramesUnsampledUrl } from "../../lib/speaker-frames-unsampled-url.js"

/** Wire path per exclusive job type — mirrors the cloud plugin's routes. */
const EXCLUSIVE_ROUTE_BY_JOB_TYPE: Readonly<Record<string, string>> = {
  "voice-changer-pro": "/v1/voice-changer-pro",
  "generate-video-pro": "/v1/generate-video-pro",
  "edit-video-pro": "/v1/edit-video-pro",
  "video-analysis": "/v1/video-analysis",
  "video-audit": "/v1/video-audit",
  "edit-plan": "/v1/edit-plan",
  "camera-switch": "/v1/camera-switch",
  // Speaker View (C2.1, decided 2026-10-06): HOW the speakers are on screen.
  "speaker-view": "/v1/speaker-view",
  // Speaker Frames (P3.6): face tracks per camera, from the self-host's
  // detection proxies (P3-15 (a)); its poll is sized by its registered budget.
  "speaker-frames": "/v1/speaker-frames",
}

/** How the size refusal names each type that re-hosts an edit's sources. */
const EDL_RELAY_LABEL: Readonly<Record<string, string>> = {
  "camera-switch": "Camera Switch",
  "speaker-view": "Speaker View",
  "speaker-frames": "Speaker Frames",
}

/** What every relayed type keeps its poll under the orchestrator's ceiling by. */
const POLL_MARGIN_MS = 5 * 60 * 1000

/** Poll budgets per type. gvp/evp legitimately run an hour+; kept under the
 *  orchestrator's 90-min NODE_TIMEOUT_MS. The others are generous defaults. */
const POLL_BUDGET_BY_JOB_TYPE: Readonly<Record<string, number>> = {
  "generate-video-pro": 85 * 60 * 1000,
  "edit-video-pro": 85 * 60 * 1000,
  "voice-changer-pro": 30 * 60 * 1000,
  "video-analysis": 30 * 60 * 1000,
  "video-audit": 30 * 60 * 1000,
  // A multi-hour episode's plan is several windowed LLM passes — kept under the
  // orchestrator's 90-min NODE_TIMEOUT_MS, matching gvp/evp.
  "edit-plan": 85 * 60 * 1000,
  // Deterministic: a length probe per camera plus the switch — minutes at most.
  "camera-switch": 30 * 60 * 1000,
}

export function isNodaroExclusiveJobType(jobType: string): boolean {
  return jobType in EXCLUSIVE_ROUTE_BY_JOB_TYPE
}

/**
 * The poll budget of one relayed job. A job type with a REGISTERED budget
 * (`BUDGETED_JOB_NAMES`: speaker-view, and speaker-frames once its node
 * relays) is sized by its own declared budget (`declaredJobBudgetMs`, the
 * number the orchestrator sizes the node from and the worker's heartbeat beats
 * for): the orchestrator's ceiling for it, less the margin every type keeps —
 * so a 3-hour source is never given up at a fixed 85 minutes while nodaro.ai is
 * still working on it. Read off the registry, never a list here, so a budget
 * registered for a newly relayed type reaches its poll with no second edit. A
 * payload the budget cannot read keeps the 85-minute default. Every other type
 * keeps its table entry.
 *
 * `elapsedMs` is the time the handler already spent in this node run before
 * polling (speaker-frames builds every detection proxy locally; any type
 * re-hosts its media): the orchestrator's ceiling counts it too, so it is left
 * out of the poll — else the ceiling fires first, which the margin exists to
 * prevent. Never below a minute.
 */
export function relayPollBudgetMs(jobType: string, payload: Record<string, unknown>, elapsedMs = 0): number | undefined {
  const budget = BUDGETED_JOB_NAMES.includes(jobType)
    ? nodeCeilings(declaredJobBudgetMs(jobType, payload)).processingMs - POLL_MARGIN_MS
    : POLL_BUDGET_BY_JOB_TYPE[jobType]
  if (budget === undefined) return undefined
  return Math.max(MIN_POLL_BUDGET_MS, budget - Math.max(0, elapsedMs))
}

/** The least a poll is given once the cloud job exists: one that finished in
 *  the meantime is still collected. */
const MIN_POLL_BUDGET_MS = 60 * 1000

/** Build the cloud request body from the enqueued payload: strip the
 *  instance-only bookkeeping and re-host URL-named media fields. */
async function buildCloudBody(payload: Record<string, unknown>, jobType: string): Promise<Record<string, unknown>> {
  const kept = Object.entries(payload).filter(
    ([key, value]) => !INSTANCE_ONLY_FIELDS.has(key) && !key.startsWith("__") && value !== undefined,
  )
  return Object.fromEntries(
    await Promise.all(kept.map(async ([key, value]) => [key, key === "edl" ? await rehostEdlValue(value, jobType) : await rehostIfUrlField(key, value)])),
  )
}

/** The `edl` value of a relayed body: one edit, a clip pack (`Edl[]`) or a clip
 *  set (`{ clips }`). Every edit of a pack re-hosts its sources — a pack used
 *  to pass through untouched and reach nodaro.ai with this install's private
 *  URLs (decided 2026-10-09). A refusal of an oversize source names every such
 *  source across the pack. */
async function rehostEdlValue(value: unknown, jobType: string): Promise<unknown> {
  if (Array.isArray(value)) return rehostEdlPack(value, jobType)
  if (value && typeof value === "object" && Array.isArray((value as { clips?: unknown }).clips)) {
    return { ...(value as Record<string, unknown>), clips: await rehostEdlPack((value as { clips: unknown[] }).clips, jobType) }
  }
  return rehostEdlSources(value, jobType)
}

async function rehostEdlPack(edits: readonly unknown[], jobType: string): Promise<unknown[]> {
  // One upload per distinct file: the clips of a pack share their cameras and mic.
  const once = new Map<string, Promise<unknown>>()
  const settled = await Promise.allSettled(edits.map((e) => rehostEdlSources(e, jobType, once)))
  const rejected = settled.filter((o): o is PromiseRejectedResult => o.status === "rejected")
  const oversize = rejected.filter((o) => o.reason instanceof DeterministicJobError)
  if (oversize.length > 0) {
    // One message for the pack: the union of what each clip's uploads found
    // (a size only the upload revealed included), once per source.
    const seen = new Set<string>()
    const hits: RehostSizeHit[] = []
    for (const o of oversize) {
      for (const hit of rehostHitsOf(o.reason)) {
        if (seen.has(hit.sourceId)) continue
        seen.add(hit.sourceId)
        hits.push(hit)
      }
    }
    throw hits.length > 0
      ? new DeterministicJobError(rehostSizeMessage(EDL_RELAY_LABEL[jobType] ?? "This node", hits), { cause: oversize[0]!.reason })
      : oversize[0]!.reason
  }
  if (rejected.length > 0) throw rejected[0]!.reason
  return settled.map((o) => (o as PromiseFulfilledResult<unknown>).value)
}

/** The oversize sources an edit's re-host refusal named (`rehostEdlSources`). */
const REHOST_HITS = Symbol("rehostHits")
function rehostHitsOf(err: unknown): readonly RehostSizeHit[] {
  const hits = (err as { [REHOST_HITS]?: unknown } | null)?.[REHOST_HITS]
  return Array.isArray(hits) ? (hits as RehostSizeHit[]) : []
}

/** An EDL carries its media one level down (`sources[].url`), which the
 *  top-level walker never reaches: re-host those so the cloud can read the
 *  cameras (camera-switch probes each one). The sources re-host concurrently
 *  and every one is let finish, so the refusal for files over the re-host cap
 *  (SV12's backstop, for a size nothing could read up front) names EVERY such
 *  source in source order — the same list the up-front check gives, whichever
 *  upload failed first. A refusal no retry can change, so it outranks a
 *  transient failure of another source. */
async function rehostEdlSources(edl: unknown, jobType: string, once?: Map<string, Promise<unknown>>): Promise<unknown> {
  if (!edl || typeof edl !== "object" || Array.isArray(edl)) return edl
  const sources = (edl as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return edl
  const settled = await Promise.allSettled(
    sources.map(async (row: unknown) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return row
      const source = row as Record<string, unknown>
      if (typeof source.url !== "string") return row
      const url = source.url
      // Speaker Frames' unsampled-source placeholder names no file: nothing to re-host.
      if (isSpeakerFramesUnsampledUrl(url)) return row
      let rehosted = once?.get(url)
      if (!rehosted) {
        rehosted = rehostIfUrlField("url", url)
        once?.set(url, rehosted)
      }
      return { ...source, url: await rehosted }
    }),
  )
  const hits: RehostSizeHit[] = []
  let firstOversize: unknown
  let firstOther: { err: unknown } | undefined
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") return
    const err = outcome.reason as { code?: unknown; bytes?: unknown } | null
    const bytes = err?.code === "media_too_large" ? err.bytes : undefined
    if (typeof bytes !== "number") {
      firstOther ??= { err: outcome.reason }
      return
    }
    const source = sources[i] as Record<string, unknown>
    hits.push({ sourceId: typeof source.id === "string" ? source.id : String(source.url), bytes })
    firstOversize ??= outcome.reason
  })
  if (hits.length > 0) {
    throw Object.assign(new DeterministicJobError(rehostSizeMessage(EDL_RELAY_LABEL[jobType] ?? "This node", hits), { cause: firstOversize }), {
      [REHOST_HITS]: hits,
    })
  }
  if (firstOther) throw firstOther.err
  return {
    ...(edl as Record<string, unknown>),
    sources: settled.map((outcome) => (outcome as PromiseFulfilledResult<unknown>).value),
  }
}

/** nodaro.ai's Speaker View route refuses these BEFORE it reserves anything
 *  (cloud-plugins C2.1): each is a function of the request (or of nodaro.ai's
 *  release, e.g. `not_priced` until C4), so a retry seconds later meets the
 *  same refusal — the job fails once, with nodaro.ai's message. */
const SPEAKER_VIEW_CREATE_REFUSALS: ReadonlySet<string> = new Set([
  "not_priced",
  "renderer_unavailable",
  "validation_error",
  "invalid_edl",
  "unsupported_setting",
  "too_long",
])

/** nodaro.ai's Speaker Frames route refuses these before it reserves anything
 *  (cloud-plugins P3.4): a function of the request or of nodaro.ai's release
 *  (`not_priced` until P3.7, `media_proxy_unavailable` on a host without the
 *  proxy or the detector, `invalid_proxy` for a relayed proxy its schema
 *  refuses), so the job fails once, with nodaro.ai's message. */
const SPEAKER_FRAMES_CREATE_REFUSALS: ReadonlySet<string> = new Set([
  "not_priced",
  "media_proxy_unavailable",
  "validation_error",
  "invalid_edl",
  "invalid_input",
  "invalid_proxy",
  "no_video",
  "too_long",
])

const CREATE_REFUSALS_BY_JOB_TYPE: Readonly<Record<string, ReadonlySet<string>>> = {
  "speaker-view": SPEAKER_VIEW_CREATE_REFUSALS,
  "speaker-frames": SPEAKER_FRAMES_CREATE_REFUSALS,
}

async function createRelayedJob(jobType: string, route: string, body: Record<string, unknown>): Promise<string> {
  try {
    return await createCloudJob(route, body)
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    if (typeof code === "string" && CREATE_REFUSALS_BY_JOB_TYPE[jobType]?.has(code)) {
      throw new DeterministicJobError((err as Error).message, { cause: err })
    }
    throw err
  }
}

/** Persist the CLOUD job id + kind before polling — the stall-retry contract:
 *  a re-picked BullMQ job resumes via inline reconcile instead of paying for
 *  a second cloud generation. */
async function persistCloudTask(jobId: string, cloudJobId: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({
      provider_kind: "nodaro-cloud",
      provider_task_id: cloudJobId,
      provider_call_started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
  if (error) {
    // Persisting the task id is what makes death recoverable — better to
    // fail now (refund path) than to run unrecoverable.
    throw new Error(`Failed to persist cloud task id for ${jobId}: ${error.message}`)
  }
}

/** True when the local row carries a stop request (set by the /stop route
 *  before the cloud job existed). */
async function stopRequested(jobId: string): Promise<boolean> {
  const { data } = await supabase.from("jobs").select("stop_requested_at").eq("id", jobId).maybeSingle()
  return Boolean((data as { stop_requested_at?: string | null } | null)?.stop_requested_at)
}

/** Forward a pending stop to the cloud job (gvp only — the one stoppable type). */
export async function forwardStopToCloud(cloudJobId: string): Promise<void> {
  await nodaroCloudFetch(`/v1/generate-video-pro/${cloudJobId}/stop`, { method: "POST" })
}

/** How often a long copy re-stamps its finalize claim: well inside the TTL the
 *  reconcile cron's `hasFreshFinalizeClaim` measures the claim's age against. */
const CLAIM_REFRESH_MS = Math.floor(FINALIZE_CLAIM_TTL_MS / 3)

/** True when the row holds a finalize claim younger than its TTL, read now
 *  (not from the cron's scan). A failed read answers false: the claim RPC
 *  still guards against another claimant. */
async function hasFreshFinalizeClaimNow(jobId: string): Promise<boolean> {
  const { data, error } = await supabase.from("jobs").select("finalize_claimed_at").eq("id", jobId).maybeSingle()
  if (error) return false
  const at = (data as { finalize_claimed_at?: string | null } | null)?.finalize_claimed_at
  if (typeof at !== "string") return false
  return Date.now() - new Date(at).getTime() < FINALIZE_CLAIM_TTL_MS
}

/**
 * Run `work` (a copy that can outlive the finalize claim's TTL several times
 * over) holding the finalize claim `firstTs` won: re-stamped every
 * CLAIM_REFRESH_MS through the same-claimant re-entry of `claim_job_finalize`,
 * so the cron leaves the row alone for as long as the copy runs, and lapses
 * within one TTL of this process dying. A failed copy releases the LATEST
 * stamp, so a retry or the next tick need not wait the TTL out.
 */
async function holdingFinalizeClaim<T>(
  jobId: string,
  claimant: FinalizeClaimant,
  firstTs: string | null,
  work: () => Promise<T>,
): Promise<T> {
  let ts = firstTs
  let refreshing: Promise<void> = Promise.resolve()
  const timer = setInterval(() => {
    refreshing = refreshing
      .then(() => claimJobFinalize(jobId, claimant))
      .then(
        (claim) => {
          if (claim.won && claim.ts) ts = claim.ts
        },
        () => undefined,
      )
  }, CLAIM_REFRESH_MS)
  timer.unref?.()
  const stopRefreshing = async (): Promise<void> => {
    clearInterval(timer)
    await refreshing
  }
  try {
    const out = await work()
    await stopRefreshing()
    return out
  } catch (err) {
    await stopRefreshing()
    if (ts) await releaseJobFinalizeClaim(jobId, ts)
    throw err
  }
}

/**
 * Adapt a FINISHED cloud job's output into this instance's storage + row.
 * Shared verbatim by the live relay and reconcileNodaroCloudJob so recovery
 * cannot drift from the primary path.
 */
export async function finalizeExclusiveCloudOutput(args: {
  jobId: string
  jobType: string
  cloudJob: CloudJob
  jobUserId: string | undefined
  shouldWatermark: boolean
  /** Who is finalizing: the live relay and a stall re-pick are the "worker",
   *  the reconcile cron is the "cron" (the finalize claim's re-entry rule). */
  claimant?: FinalizeClaimant
}): Promise<boolean> {
  const { jobId, jobType, cloudJob, jobUserId, shouldWatermark } = args
  const claimant = args.claimant ?? "worker"
  const output = (cloudJob.output_data ?? {}) as Record<string, unknown>

  // Relay provenance, lane 4 (spec §8.2, migration 383). These types are
  // the most expensive generations a self-host can run and EVERY one of them is
  // billed at the far end, so the pair has to reach the row here: the near end
  // settles its own user on `relay_credits`, and the delete paths read
  // `relay_job_id` to know the object was created THERE and must never be
  // deleted here. Computed once and carried by all four completion sites below
  // — in the shape each site's completion function consumes. `{}` when the far
  // end answered without an id, which keeps a non-relay completion byte-
  // identical (same guard the `provider_task_id` write already uses).
  const relayResult: { relayJobId?: string; relayCredits?: number | null } = cloudJob.id
    ? relayResultFields(cloudJob)
    : {}
  const relayColumns = relayFieldsFrom(relayResult)

  // A render (Speaker View): a plain copy of the user's own footage, under the
  // big-media limits — no watermark, no transcode (SV13). Its `json` (the EDL
  // as rendered), `quality`, `clipKey`, `planBasis` and `renderBasis` ride
  // through verbatim (the stamps decided 2026-10-07): the review
  // reads them, and a Preview is private on this row from its insert (the
  // route / run marks a proxy `force_private`).
  //
  // The copy can take up to an hour (several GB under the big-media limits),
  // so it runs under the finalize claim, kept fresh while it runs: otherwise
  // every reconcile tick that finds this stale row starts its own copy of the
  // same render. A claim held by another finalizer means it is copying now.
  if (jobType === "speaker-view") {
    const renderUrl = typeof output.videoUrl === "string" ? output.videoUrl : null
    if (!renderUrl) {
      throw new NodaroCloudError(`nodaro.ai: ${jobType} finished on the connection but returned no media`)
    }
    // Two reconcile ticks share the claimant "cron", and the claim RPC lets a
    // claimant re-enter its own fresh claim. A tick reaching this row on an old
    // scan (the loop is sequential and a copy holds it up to an hour) must not
    // re-enter the claim a later tick took for its copy: it reads the claim
    // again first. The worker keeps its re-entry (a stall re-pick takes over
    // its crashed predecessor's claim, migration 211).
    if (claimant === "cron" && (await hasFreshFinalizeClaimNow(jobId))) return false
    const claim = await claimJobFinalize(jobId, claimant)
    if (!claim.won) return false
    const home = await holdingFinalizeClaim(jobId, claimant, claim.ts, () => bringRenderHome(renderUrl, jobId, jobUserId))
    const { videoUrl: _v, thumbnailUrl: farThumbnail, ...rest } = output
    const thumbnailUrl = home.thumbnailUrl ?? (typeof farThumbnail === "string" ? farThumbnail : null)
    return markJobCompleted(jobId, {
      output_data: { videoUrl: home.videoUrl, thumbnailUrl, ...rest, viaNodaroCloud: true },
      provider: "nodaro",
      ...(cloudJob.id ? { provider_task_id: cloudJob.id } : {}),
      ...relayColumns,
    })
  }

  // Speaker Frames (P3.6, decided 2026-10-09): the JSON is the track file's
  // descriptor. The file itself is copied HOME under this job's own key and its
  // hash and size re-checked, so it expires and is expunged with this
  // install's job, never depending on nodaro.ai's copy.
  if (jobType === "speaker-frames") {
    const home = await bringTrackSetHome(output, jobId, jobUserId)
    return markJobCompleted(jobId, {
      output_data: { ...home, viaNodaroCloud: true },
      provider: "nodaro",
      ...(cloudJob.id ? { provider_task_id: cloudJob.id } : {}),
      ...relayColumns,
    })
  }

  // JSON producers: the JSON IS the result — no media to re-host. edit-plan
  // sits alongside the analysis pair: its output_data is the EDL plan (an `Edl`
  // for tighten, an `EdlClipSet` for clips, a `{version, chapters}` for
  // chapters) at the top level, carried through verbatim. The app-side unwrap
  // to `data.generatedJson` (`unwrapEditPlanOutput`) happens in the output
  // extractors, NOT here — output_data must stay the object shape the plugin
  // wrote (a bare Edl[] here would be corrupted into numeric keys by any spread).
  if (jobType === "video-analysis" || jobType === "video-audit" || jobType === "edit-plan" || jobType === "camera-switch") {
    return markJobCompleted(jobId, {
      output_data: { ...output, viaNodaroCloud: true },
      provider: "nodaro",
      ...(cloudJob.id ? { provider_task_id: cloudJob.id } : {}),
      ...relayColumns,
    })
  }

  const videoUrl = typeof output.videoUrl === "string" ? output.videoUrl : null
  const audioUrl = typeof output.audioUrl === "string" ? output.audioUrl : null

  if (videoUrl) {
    // gvp / evp / vcp-video-mode: bring the video home under this instance's
    // key, watermarked by THIS install's rules; carry the rest of the cloud
    // output verbatim — gvp's `pro` checkpoint is what stop/continue read.
    const r2Url = await uploadVideoMaybeWatermark(videoUrl, jobId, jobUserId, shouldWatermark)
    const thumbUrl = await generateAndUploadThumbnail(r2Url, jobId, jobUserId)
    const { videoUrl: _v, ...rest } = output
    if (jobType === "generate-video-pro" || jobType === "edit-video-pro") {
      const { ok } = await finalizeJobWithMedia({
        jobId,
        jobType: "text-to-video", // storage classification only: a video deliverable
        claimant,
        // The pair rides the ProviderResult here rather than being written
        // inline: `finalizeJobWithMedia` turns it into the same two columns
        // (`relayFieldsFrom`), and that is the ONE completion a result-gate
        // HOLD can park in `held_completion_fields` and approve can replay.
        result: { url: videoUrl, cost: null, providerUsed: "nodaro", ...relayResult },
        mediaUrl: r2Url,
        extraOutputData: { thumbnailUrl: thumbUrl, ...rest, viaNodaroCloud: true },
      })
      return ok
    }
    return markJobCompleted(jobId, {
      output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl, ...rest, viaNodaroCloud: true },
      provider: "nodaro",
      ...relayColumns,
    })
  }

  if (audioUrl) {
    // vcp audio mode. POST-PROVIDER: the cloud already billed the delivery —
    // an R2 hiccup here must not refund.
    const r2Url = await runPostProcessing(() => uploadToR2(audioUrl, jobId, "audio", jobUserId))
    const { audioUrl: _a, ...rest } = output
    return markJobCompleted(jobId, {
      output_data: { audioUrl: r2Url, ...rest, viaNodaroCloud: true },
      provider: "nodaro",
      ...relayColumns,
    })
  }

  throw new NodaroCloudError(
    `nodaro.ai: ${jobType} finished on the connection but returned no media or analysis`,
  )
}

/** The worker handler shared by every exclusive type. */
export function makeNodaroExclusiveHandler(jobType: string): HandlerFn {
  return async function handleNodaroExclusive(job: Job, ctx: JobContext): Promise<void> {
    const route = EXCLUSIVE_ROUTE_BY_JOB_TYPE[jobType]
    if (!route) throw new Error(`not a nodaro-exclusive job type: ${jobType}`)
    const payload = job.data as Record<string, unknown>
    const startedAt = Date.now()
    console.log(`[worker] ${jobType} ${ctx.jobId}: relaying to the nodaro.ai connection`)

    // Continue (gvp): the payload carries the CLOUD parent id the route
    // resolved from the local fromJobId; the cloud's own /continue creates
    // the new cloud job.
    const cont = payload.__nodaroContinue as { cloudFromJobId: string; fromSegment?: number } | undefined

    // SV12: a private source over the re-host cap is refused before anything
    // is relayed, naming it — the first point an edit made during the run can
    // be read (the route and the orchestrator's scan ask the same helper).
    const label = EDL_RELAY_LABEL[jobType]
    if (jobType === "speaker-view" && label) {
      const hits = await checkRehostSizes(payload.edl)
      if (hits.length > 0) throw new DeterministicJobError(rehostSizeMessage(label, hits))
    }

    // Speaker Frames relays the self-host's detection proxies in place of the
    // originals (P3-15 (a)), and only once nodaro.ai takes a relayed job.
    const body = await buildCloudBody(jobType === "speaker-frames" ? await speakerFramesRelayPayload(payload) : payload, jobType)
    const cloudJobId = cont
      ? await createCloudJob("/v1/generate-video-pro/continue", {
          ...body,
          fromJobId: cont.cloudFromJobId,
          ...(cont.fromSegment !== undefined ? { fromSegment: cont.fromSegment } : {}),
        })
      : await createRelayedJob(jobType, route, body)

    await persistCloudTask(ctx.jobId, cloudJobId)

    // A stop that arrived before the cloud job existed is forwarded now —
    // the /stop route could only stamp the local row at that point.
    if (jobType === "generate-video-pro" && (await stopRequested(ctx.jobId))) {
      await forwardStopToCloud(cloudJobId).catch((err) => {
        console.warn(`[worker] ${ctx.jobId}: could not forward pending stop:`, err instanceof Error ? err.message : err)
      })
    }

    await setJobProgress(job, ctx.jobId, 5)
    const cloudJob = await waitForCloudJob(
      cloudJobId,
      async (p) => {
        await setJobProgress(job, ctx.jobId, Math.min(95, Math.max(5, Math.round(p))))
      },
      { budgetMs: relayPollBudgetMs(jobType, payload, Date.now() - startedAt) },
    )
    await setJobProgress(job, ctx.jobId, 97)
    const ok = await finalizeExclusiveCloudOutput({
      jobId: ctx.jobId,
      jobType,
      cloudJob,
      jobUserId: ctx.jobUserId,
      shouldWatermark: ctx.shouldWatermark,
    })
    if (!ok) return
    console.log(`[worker] Job ${ctx.jobId} completed via the nodaro.ai connection (${jobType})`)
  }
}

export const nodaroExclusiveRelayHandlers: Record<string, HandlerFn> = Object.fromEntries(
  Object.keys(EXCLUSIVE_ROUTE_BY_JOB_TYPE).map((t) => [t, makeNodaroExclusiveHandler(t)]),
)
