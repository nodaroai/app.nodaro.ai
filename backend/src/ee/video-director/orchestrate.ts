/**
 * Video-director orchestration chain (Unit D).
 *
 * Pure, injectable sequencing function:
 *   author → speech → forced-alignment → bake(resolve) → render.
 *
 * All side-effecting steps are abstracted behind the DirectorDeps interface so
 * the chain is fully unit-testable without network I/O. The real wiring lives
 * in defaultDirectorDeps(); Task-5 worker drives that factory.
 */

import { authorShotSequence, type AuthoredSequence, type VideoGenre } from "./author.js"
import { bakeShotSequence } from "../../services/shot-sequence/baker.js"
import { ensureLogoLockupScene } from "./logo-lockup-net.js"
import { waitForJob as _waitForJob } from "../../lib/mcp/tools/_wait-for-job.js"
import { config } from "../../lib/config.js"
import { resolveBrandInput, type BrandTokens } from "@nodaro/prompts"
import type { FastifyInstance } from "fastify"
import type { AlignmentWord } from "../../providers/elevenlabs/forced-alignment.js"
import type { ShotSequencePlan } from "../../lib/plan-schemas.js"

export type { VideoGenre }

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * All dependencies are injectable for unit tests. Production code uses
 * defaultDirectorDeps() which wires the real job-creation paths.
 */
export interface DirectorDeps {
  /** Authoring function (Unit C) — LLM call that produces voScript + brief. */
  author: typeof authorShotSequence
  /** Create a TTS job and return its jobId. */
  createSpeechJob(text: string, userId: string): Promise<{ jobId: string }>
  /** Create a forced-alignment job and return its jobId. */
  createAlignmentJob(audioUrl: string, transcript: string, userId: string): Promise<{ jobId: string }>
  /** Create a Remotion shot-sequence render job and return its jobId. */
  createRenderJob(plan: unknown, userId: string): Promise<{ jobId: string }>
  /** Block until a job reaches a terminal state; return its output_data. */
  waitForJob(jobId: string): Promise<{ output: Record<string, unknown> }>
  /** Optional progress hook — called (and AWAITED) before each pipeline step.
   *  Awaited so an async progress write (the worker updates the jobs row) always
   *  completes before the next step — otherwise a stale progress write can land
   *  after the terminal failed/completed write and leave a failed job stuck at
   *  "processing". */
  onProgress?(step: string): void | Promise<void>
}

// ---------------------------------------------------------------------------
// Pure orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full video-director pipeline for one brief.
 *
 * Step order (contract):
 *   author → createSpeechJob(voScript) → waitForJob → audioUrl
 *   → createAlignmentJob(audioUrl, voScript) → waitForJob → alignment
 *   → bakeShotSequence(shotSequenceBrief, alignment, audioUrl) → plan
 *   → createRenderJob(plan) → waitForJob → videoUrl.
 *
 * onProgress is called before each step with:
 *   "authoring" | "speech" | "alignment" | "resolve" | "render".
 *
 * If any step throws or produces no usable output, an error is thrown whose
 * message includes the failing step name (e.g. "render: endpoint 503").
 */
export async function runVideoDirector(
  opts: {
    genre: VideoGenre
    brief: string
    userId: string
    tier: string
    /** Optional brand — a preset name OR inline BrandTokens. Resolved ONCE here
     *  (via resolveBrandInput) and threaded into both the author system prompt
     *  and the brief handed to the baker. */
    brand?: string | BrandTokens
  },
  deps: DirectorDeps,
): Promise<{ videoUrl: string; planType: "shot-sequence" }> {
  const { userId } = opts

  // Resolve the caller-supplied brand ONCE (preset name → tokens, or inline
  // tokens pass-through). Fed to the author (prompt) AND set on the brief below.
  const resolvedBrand = opts.brand ? resolveBrandInput(opts.brand) : undefined

  // ── 1. Author ──────────────────────────────────────────────────────────────
  await deps.onProgress?.("authoring")
  let authored: AuthoredSequence
  try {
    authored = await deps.author({ ...opts, brand: resolvedBrand })
  } catch (err) {
    throw new Error(`authoring: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── 2. Speech ──────────────────────────────────────────────────────────────
  await deps.onProgress?.("speech")
  let speechJobId: string
  try {
    const r = await deps.createSpeechJob(authored.voScript, userId)
    speechJobId = r.jobId
  } catch (err) {
    throw new Error(`speech: ${err instanceof Error ? err.message : String(err)}`)
  }
  const speechOut = await deps.waitForJob(speechJobId).catch((e: unknown) => {
    throw new Error(`speech: ${e instanceof Error ? e.message : String(e)}`)
  })
  const audioUrl = speechOut.output.audioUrl as string | undefined
  if (!audioUrl) throw new Error("speech: no audioUrl in job output")

  // ── 3. Alignment ───────────────────────────────────────────────────────────
  await deps.onProgress?.("alignment")
  let alignJobId: string
  try {
    const r = await deps.createAlignmentJob(audioUrl, authored.voScript, userId)
    alignJobId = r.jobId
  } catch (err) {
    throw new Error(`alignment: ${err instanceof Error ? err.message : String(err)}`)
  }
  const alignOut = await deps.waitForJob(alignJobId).catch((e: unknown) => {
    throw new Error(`alignment: ${e instanceof Error ? e.message : String(e)}`)
  })
  const alignment = alignOut.output.alignment as AlignmentWord[] | undefined
  if (!alignment) throw new Error("alignment: no alignment in job output")

  // ── 4. Bake (resolve) ──────────────────────────────────────────────────────
  // When the caller supplied a brand, set the resolved tokens on the brief so
  // the render pipeline (baker → plan.brandTokens) honors them. When no brand
  // was supplied, pass the brief unchanged so an author-chosen brandTokens survives.
  // ensureLogoLockupScene is the deterministic backstop: if the brand supplies a
  // logo image but the authored brief has no logo-assemble-lockup reveal, it
  // appends a trailing branding scene with one — identity otherwise.
  const briefToBake = (seq: AuthoredSequence) => {
    const withBrand = resolvedBrand ? { ...seq.shotSequenceBrief, brandTokens: resolvedBrand } : seq.shotSequenceBrief
    return ensureLogoLockupScene(withBrand, resolvedBrand)
  }

  await deps.onProgress?.("resolve")
  let plan: ShotSequencePlan
  try {
    const baked = bakeShotSequence(briefToBake(authored), alignment, audioUrl)
    plan = baked.plan
  } catch (err) {
    // ── One-round author self-repair (Task T2) ────────────────────────────
    // The bake/resolve step is a pure plan-validation seam: a rejection here
    // means the authoring LLM produced a brief that violates a resolver
    // invariant (e.g. overlapping scenes) — a nondeterministic failure class
    // where one repair round usually fixes it. Give the author ONE chance to
    // correct ONLY the scene/shot/reveal structure before failing the job.
    //
    // Speech + forced alignment are already generated from voScript/cues and
    // cannot be redone without re-billing, so the repaired output's voScript
    // AND cues (ids + text, order) MUST stay byte-identical to the original.
    // Any drift discards the repair and surfaces the ORIGINAL bake error, as
    // if no repair had been attempted at all. No third attempt.
    const originalMsg = err instanceof Error ? err.message : String(err)
    const originalError = new Error(`resolve: ${originalMsg}`)

    console.log(`[video-director] resolve failed, attempting author self-repair: ${originalMsg}`)
    // Still working the "resolve" stage from the caller's point of view — no
    // new stage name is introduced for the repair round.
    await deps.onProgress?.("resolve")

    let repaired: AuthoredSequence
    try {
      repaired = await deps.author({
        ...opts,
        brand: resolvedBrand,
        repair: { previousBrief: authored, resolverError: originalError.message },
      })
    } catch {
      // The repair authoring call itself failed — nothing to re-bake. Surface
      // the ORIGINAL bake error (the signal the caller/refund path cares
      // about), not the repair attempt's own failure.
      console.log(`[video-director] resolve self-repair outcome: repair-failed`)
      throw originalError
    }

    const cuesMatch =
      repaired.cues.length === authored.cues.length &&
      repaired.cues.every((c, i) => c.id === authored.cues[i].id && c.text === authored.cues[i].text)

    if (repaired.voScript !== authored.voScript || !cuesMatch) {
      console.log(`[video-director] resolve self-repair outcome: repair-discarded-voScript-drift`)
      throw originalError
    }

    // Re-bake with the SAME alignment + audioUrl — no new speech/alignment job.
    try {
      const baked = bakeShotSequence(briefToBake(repaired), alignment, audioUrl)
      plan = baked.plan
      console.log(`[video-director] resolve self-repair outcome: repaired-ok`)
    } catch (err2) {
      console.log(`[video-director] resolve self-repair outcome: repair-failed`)
      throw new Error(`resolve: ${err2 instanceof Error ? err2.message : String(err2)}`)
    }
  }

  // ── 5. Render ──────────────────────────────────────────────────────────────
  await deps.onProgress?.("render")
  let renderJobId: string
  try {
    const r = await deps.createRenderJob(plan, userId)
    renderJobId = r.jobId
  } catch (err) {
    throw new Error(`render: ${err instanceof Error ? err.message : String(err)}`)
  }
  const renderOut = await deps.waitForJob(renderJobId).catch((e: unknown) => {
    throw new Error(`render: ${e instanceof Error ? e.message : String(e)}`)
  })
  const videoUrl = renderOut.output.videoUrl as string | undefined
  if (!videoUrl) throw new Error("render: no videoUrl in job output")

  return { videoUrl, planType: "shot-sequence" }
}

// ---------------------------------------------------------------------------
// Default production wiring
// ---------------------------------------------------------------------------

/**
 * Build a DirectorDeps wired to the real job-creation paths via fastify.inject.
 * Mirrors the pattern used by verbs-audio.ts + verbs-shot-sequence.ts.
 *
 * CONCERNS (for Task 5 verification):
 * - TTS: uses elevenlabs-v3 model + no voice override (Rachel is the server
 *   default). If the worker needs a specific voice, thread it through opts.
 * - Render: passes userId in the body; the /v1/render-video/plan route expects
 *   the internal-orchestrator-secret header only. Task 5 should verify the
 *   route accepts this payload shape.
 * - waitForJob timeout: 600s is conservative; tune based on observed render durations.
 */
export function defaultDirectorDeps(fastify: FastifyInstance): DirectorDeps {
  async function injectJob(url: string, payload: unknown): Promise<{ jobId: string }> {
    const res = await fastify.inject({
      method: "POST",
      url,
      headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
      payload: payload as object,
    })
    if (res.statusCode >= 400) {
      throw new Error(`${url} failed (${res.statusCode}): ${res.body}`)
    }
    const body = JSON.parse(res.body) as { jobId?: string; id?: string }
    const jobId = body.jobId ?? body.id
    if (!jobId) throw new Error(`No jobId in response from ${url}: ${res.body}`)
    return { jobId }
  }

  return {
    author: authorShotSequence,

    createSpeechJob: (text, userId) =>
      injectJob("/v1/text-to-speech", {
        text,
        provider: "elevenlabs-v3",
        userId,
      }),

    createAlignmentJob: (audioUrl, transcript, userId) =>
      injectJob("/v1/forced-alignment", { audioUrl, transcript, userId }),

    createRenderJob: (plan, userId) =>
      injectJob("/v1/render-video/plan", {
        planType: "shot-sequence",
        plan,
        userId,
      }),

    waitForJob: async (jobId) => {
      const result = await _waitForJob({ jobId, timeoutMs: 600_000 })
      if (result.status !== "completed") {
        throw new Error(
          `Job ${jobId} ended with status "${result.status}": ${result.error ?? "(no detail)"}`,
        )
      }
      return { output: result.outputData ?? {} }
    },
  }
}
