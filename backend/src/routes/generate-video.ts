import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { shotsSchema, elementsSchema } from "../lib/video-schemas.js"
import { effectiveVideoPromptCeiling } from "../lib/video-prompt-ceiling.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { getModelCreditBaseCost } from "../ee/billing/credits.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { insertJobIdempotent } from "../lib/insert-job.js"
import { sendInternalError } from "../lib/http-errors.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { VIDEO_GEN_PROVIDERS, SEEDANCE_2_REF_LIMITS, SEEDANCE_2_5_REF_LIMITS, PROMPT_HARD_CEILING, isSeedance2Provider, isMinimaxH3Provider, isVeoProvider, estimateLoopTrimAddonCredits, seedance2AudioLimitSec, findSeedance2AudioOverLimit, videoModelCanSpeakDialogue, getVideoAudioCapability, TTS_PROVIDERS, buildVideoCreditModelIdentifier, applyDefaultVideoSelection, VIDEO_REF_LIMITS_BY_PROVIDER, type ConnectedReference } from "@nodaro/shared"
import { resolveVideoReferenceCore, resolveReferenceTokens, resolveRefIdTokens, composeVideoPromptText, type VideoExtraRef, type CharacterMeta } from "@nodaro/prompts"
import { connectedReferenceSchema } from "../lib/connected-reference-schema.js"
import { directionSchema } from "../lib/direction-schema.js"
import { subjectSchema } from "../lib/subject-schema.js"
import { formatZodError } from "../lib/zod-error.js"
import { backendHybridRoles } from "../lib/reference-format.js"

// Character-voice orchestration (voiced-video). All optional + additive: absent
// => today's behaviour. A "voiced" request ALSO requires a dialogue-capable
// provider (videoModelCanSpeakDialogue) — enforced in the route handler.
const characterVoiceSpecSchema = z.object({
  // Alphanumeric (+ space / _ / -): a premade name ("Rachel"), an ElevenLabs
  // voice-library/custom id, or a saved-voice slug. Bounded + character-guarded
  // because voiceId flows into provider URL paths (/v1/text-to-speech/{voiceId}).
  voiceId: z.string().min(1).max(64).regex(/^[A-Za-z0-9 _-]+$/, "voiceId must be alphanumeric (letters, digits, space, _ or -)"),
  voiceType: z.enum(["premade", "library", "custom"]).optional(),
  ttsProvider: z.enum(TTS_PROVIDERS).optional(),
  speaker: z.string().min(1).max(80).optional(),
})
const dialogueLineSchema = z.object({
  speaker: z.string().min(1).max(80),
  line: z.string().min(1).max(500),
})

export const generateVideoBody = z.object({
  imageUrl: safeUrlSchema.optional(),  // Optional in VEO REFERENCE_2_VIDEO mode
  endFrameUrl: safeUrlSchema.optional(),
  last_frame_image: safeUrlSchema.optional(),  // LTX image_to_video end-frame URL (snake_case)
  audioUrl: safeUrlSchema.optional(),
  prompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  userPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  provider: z.enum(VIDEO_GEN_PROVIDERS).optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().min(1).max(60).optional(),
  mode: z.enum(["pro", "std", "4K"]).optional(),
  sound: z.boolean().optional(),
  negativePrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  motionPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  cfgScale: z.number().min(0).max(1).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "21:9", "9:21", "adaptive", "Auto"]).optional(),
  multiShot: z.boolean().optional(),
  shots: shotsSchema.optional(),
  elements: elementsSchema.optional(),
  resolution: z.string().optional(),
  grokMode: z.enum(["fun", "normal", "spicy"]).optional(),
  videoSize: z.enum(["standard", "high"]).optional(),
  seed: z.number().int().min(-1).max(2147483647).optional(),
  cameraFixed: z.boolean().optional(),
  // The wire ceiling is the WIDEST provider's caps (Seedance 2.5: 30/10/10,
  // 2026-08-15) — per-provider enforcement lives in the input resolvers,
  // which drop trailing entries to the actual provider's own limits.
  referenceImageUrls: z.array(safeUrlSchema).max(SEEDANCE_2_5_REF_LIMITS.images).optional(),
  referenceVideoUrls: z.array(safeUrlSchema).max(SEEDANCE_2_5_REF_LIMITS.videos).optional(),
  referenceAudioUrls: z.array(safeUrlSchema).max(SEEDANCE_2_5_REF_LIMITS.audio).optional(),
  // Structured references (parity with generate-image). When present, the route
  // assembles them server-side via the shared video resolver — auto-attaching
  // unmentioned wired-ref URLs to `referenceImageUrls`, emitting per-ref
  // directives, and expanding `{image:N:label}` tokens. Absent → byte-identical
  // to the pre-assembly flat path. The `url` of each rides `safeUrlSchema` (same
  // SSRF gate as the flat `referenceImageUrls`).
  connectedReferences: z.array(connectedReferenceSchema).max(14).optional(),
  // User-defined reorder of the injected reference list (stable tile ids),
  // honored by `resolveVideoReferenceCore`'s `applyReferenceOrderToVideo` pass.
  referenceOrder: z.array(z.string()).max(14).optional(),
  // Structured cinematic direction: catalog IDS, not hint text. The route
  // renders them into the prompt body via `composeVideoPromptText` with the
  // platform's verbosity policy (motion compact / look full), so a client stops
  // baking catalog wording it can never un-bake. Absent → the flat path is
  // byte-identical. The schema is surface-AGNOSTIC on purpose: an image-only
  // dimension is accepted here and simply contributes no video hint (filtering
  // is a render concern), and unknown keys/ids are stripped/skipped, never 400.
  direction: directionSchema.optional(),
  // Structured SUBJECT: the same doctrine one channel over — catalog IDS for
  // WHO is in the shot (Person / Styling / props) instead of the client baking
  // their wording. Folded ahead of the direction clauses by the same composer,
  // at the platform's video verbosity policy (compact terms: the start frame
  // already carries the subject's identity into the clip). Absent → the flat
  // path is byte-identical.
  subject: subjectSchema.optional(),
  webSearch: z.boolean().optional(),
  nsfwChecker: z.boolean().optional(),
  generationType: z.enum(["TEXT_2_VIDEO", "FIRST_AND_LAST_FRAMES_2_VIDEO", "REFERENCE_2_VIDEO"]).optional(),
  // VEO3.1 first+last-frame mode adds a ~333ms tail dissolve that
  // breaks loop seamlessness. Default true: strip the last 8 frames
  // post-render so the rendered last frame matches the supplied
  // `last_frame_url` exactly. Set false to keep the dissolve.
  loopTrim: z.object({
    enabled: z.boolean(),
    framesToTest: z.number().int().min(1).max(64).optional(),
    quality: z.enum(["lossless", "precise"]).optional(),
  }).optional(),
  // Legacy field — accepted for one release as a deprecation cycle.
  // Frontend migrates on workflow load; routes/MCP map it on entry.
  autoLoopTrim: z.boolean().optional(),
  // VEO 3.x: opt out of KIE's auto-translate-to-English (default true
  // upstream). Set false to keep prompts verbatim — useful when the
  // prompt's exact wording is load-bearing (perfect-loop seal phrase,
  // non-English creative direction). Has no effect on non-VEO providers.
  enableTranslation: z.boolean().optional(),
  seedance2InputMode: z.enum(["frames", "references"]).optional(),
  // Identity injection (image-to-video). When the upstream Character node
  // has its "Inject identity description in downstream prompts" toggle
  // enabled, the frontend / DAG executor passes injectCharacterContext +
  // attachToCharacterId so the route appends the character's
  // canonical_description (with an identity-preserve suffix) to the prompt
  // before reservation and worker enqueue. Default off.
  injectCharacterContext: z.boolean().optional().default(false),
  attachToCharacterId: z.string().uuid().optional(),
  // When set alongside attachToCharacterId, the completed clip is appended to
  // characters.reference_videos_by_variant[<this label>] on job completion
  // (worker + reconcile, via job-finalize.ts). The label is the variant slug
  // (e.g. an emotion take "happy"); the RPC lowercases/trims + caps it.
  attachReferenceVideoVariant: z.string().min(1).max(80).optional(),
  userId: z.string().uuid().optional(),
  videoTrimStart: z.number().int().min(0).optional(),
  videoTrimEnd: z.number().int().min(0).optional(),
  // Character-voice orchestration. When present AND the provider can voice
  // dialogue, the route enqueues a "voiced-video" job; otherwise the spec is
  // ignored with a non-fatal warning (the clip still generates, just silent).
  characterVoices: z.array(characterVoiceSpecSchema).max(8).optional(),
  dialogue: z.array(dialogueLineSchema).max(50).optional(),
}).superRefine((b, ctx) => {
  // Validate the EFFECTIVE trim window when EITHER bound is supplied — a one-sided
  // value still resolves a window at the provider (start ?? 0, ends ?? start+10),
  // so e.g. videoTrimEnd:30 alone (→ 0..30) must be rejected here, not at KIE.
  if (b.videoTrimStart != null || b.videoTrimEnd != null) {
    const start = b.videoTrimStart ?? 0
    const ends = b.videoTrimEnd ?? start + 10
    if (ends <= start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "videoTrimEnd must be greater than videoTrimStart", path: ["videoTrimEnd"] })
    } else if (ends - start > 10) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "trim window must be ≤ 10 seconds", path: ["videoTrimEnd"] })
    }
  }
})

const IDENTITY_PRESERVE_SUFFIX =
  "The subject must remain exactly the same person — preserve facial identity, eye color, hair color, skin tone, and unique features."

/**
 * Server-side `connectedReferences` assembly for the single-node generate-video
 * route — the video analog of generate-image's `assembleImageInput` path. Wired
 * characters drive mention resolution + canonical fallback + identity
 * directives; every OTHER source (`wired-image` / `wired-object` /
 * `wired-location` / `manual`) rides the extras path so an UNMENTIONED wired ref
 * auto-attaches its URL and emits an `@image_N (reference)` directive.
 * `{image:N:label}` tokens expand and `referenceOrder` is honored — all via
 * `resolveVideoReferenceCore`, the SAME shared core the canvas
 * (`assembleVideoPrompt`) and orchestrator (`payload-builder`) delegate to, so a
 * direct API/SDK run binds inline references identically to a canvas run.
 *
 * Engine note: this deliberately does NOT use `assembleImageInput` —
 * `buildImagePrompt` drops every reference URL when the provider isn't a known
 * IMAGE model (`MODELS_WITH_REFERENCE_IMAGE_SUPPORT`), which no video provider
 * is. `resolveVideoReferenceCore` is provider-agnostic and is the correct video
 * equivalent.
 *
 * Provider-gated by the catalog: when the video provider has no image-reference
 * support (`VIDEO_REF_LIMITS_BY_PROVIDER[provider].images` falsy) the refs can't
 * be sent, so we only strip the editor's `{image:N}` tokens to bare labels
 * (parity with the canvas `stripVideoImageTokens`) and attach nothing.
 *
 * Pure: no I/O, no mutation of inputs. Exported for unit tests.
 */
export function assembleVideoConnectedReferences(args: {
  prompt: string | undefined
  provider: string | undefined
  connectedReferences: ConnectedReference[]
  baseReferenceImageUrls?: string[]
  referenceOrder?: string[]
  referenceVideoCount: number
  referenceAudioCount: number
  /**
   * Lower the provider's image cap for this call (never raises it, and a
   * provider with no image-ref support stays at 0). The extend flow passes
   * `cap − 1` because its i2v transport appends the source's last frame as an
   * anchor INTO `reference_image_urls` at generation time — without the
   * reserved slot, a full assembly here would number an `@image_N` directive
   * onto the seat the anchor later occupies (misbind). Pre-slicing the INPUTS
   * is not equivalent: mention-variant multiplication can emit more URLs than
   * refs went in, so the budget must bound the assembly itself.
   */
  imageCapOverride?: number
}): { prompt: string | undefined; referenceImageUrls: string[] | undefined } {
  const {
    prompt,
    provider,
    connectedReferences,
    baseReferenceImageUrls,
    referenceOrder,
    referenceVideoCount,
    referenceAudioCount,
  } = args
  const providerCap = provider ? (VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.images ?? 0) : 0
  const imageCap =
    args.imageCapOverride !== undefined ? Math.min(Math.max(0, args.imageCapOverride), providerCap) : providerCap

  // Every reference the caller named, by ITS id → display name — built from the
  // FULL list, before any cap, so a `{ref:<id>}` for a reference that never
  // reaches the walk (capped out below, or no image support at all) degrades to
  // the name the caller gave it rather than to nothing.
  const refNamesById = new Map<string, string>()
  for (const r of connectedReferences) {
    if (r.id && !refNamesById.has(r.id)) refNamesById.set(r.id, r.defaultName)
  }

  // Provider can't carry image references → nothing to attach. Strip the
  // editor's `{image:N}` tokens to bare labels so they never ship raw to the
  // model; `{video:N}` / `{audio:N}` still resolve against the flat ref counts.
  // `{ref:<id>}` degrades the same way (label → name → nothing). A prompt that
  // resolves to nothing ships as empty text — never as the raw token.
  if (imageCap <= 0) {
    const resolved = resolveReferenceTokens(
      resolveRefIdTokens(prompt, { slotById: new Map(), nameById: refNamesById, imageCount: 0 }),
      {
        image: 0,
        video: referenceVideoCount,
        audio: referenceAudioCount,
      },
    )
    return {
      prompt: resolved ?? (prompt === undefined ? undefined : ""),
      referenceImageUrls: baseReferenceImageUrls,
    }
  }

  // Cap the URL-producing refs to the provider's image limit BEFORE assembly.
  // The shared core numbers an `@image_N` directive (and resolves `{image:N}`
  // tokens) for EVERY ref it is given; if it numbered all of them and we only
  // sliced the URL list to the cap afterward, the prompt would carry directives
  // binding `@image_(cap+1)…` to images that never reach the worker. Bounding the
  // input here mirrors the canvas, where the `imageReferences` handle is hard-
  // limited to the same cap (`handle-limits.ts`), so the core never sees more
  // refs than the cap. `referenceOrder` still reorders within the surviving set;
  // `lookupCharacterBySlug` below still reads the FULL list (metadata only — no
  // URL/directive impact). The post-assembly `merged.slice(0, imageCap)` remains
  // a defensive net for the rare mention-variant-multiply case.
  //
  // D5 image-refs-first: the LEADING flat refs consume the cap budget first
  // (mirrors the image side's `imageReferenceLimit` rule in prompt-builder.ts),
  // and the structured refs get the remainder — so `@image_N` is identical to the
  // canvas/orchestrator (flat refs are `@image_1 … @image_offset`, assets after).
  const cappedLeading = (baseReferenceImageUrls ?? []).slice(0, imageCap)
  const structuredBudget = Math.max(0, imageCap - cappedLeading.length)
  const cappedReferences = connectedReferences.slice(0, structuredBudget)

  // Split incoming refs: canonical wired characters (mention + canonical-fallback
  // + identity directives) vs. everything else (extras → auto-attach + bullet).
  const wiredCharRefs: ConnectedReference[] = []
  const extraRefs: VideoExtraRef[] = []
  for (const r of cappedReferences) {
    if (r.source === "wired-character" && !r.isExtraRef) {
      wiredCharRefs.push(r)
    } else {
      extraRefs.push({
        // The caller's own id — what a `{ref:<id>}` token in the prompt names.
        id: r.id,
        url: r.url,
        // Best available label for the "(reference): <…>" bullet.
        description: (r.description ?? "").trim() || r.defaultName,
        characterSlug: r.characterSlug,
        variantSlug: r.variantSlug,
        usageMode: r.defaultUsageMode,
        // Node-default role + mapped identity-lock (Character Node Role+Lock).
        // `usageMode` above is the COALESCED mode (always set for character
        // extras), which would trip the core's meta-suppression gate — so the
        // role rides the dedicated per-extra slot instead. The expander already
        // cleared `defaultRole` when a true per-ref override existed, so
        // override-wins precedence is preserved. Without these two fields a
        // direct-API/MCP run silently ignores the character node's role/lock
        // controls on the extras leg (canvas + orchestrator honor them).
        defaultRole: r.defaultRole,
        identityLock: r.identityLock,
      })
    }
  }

  // The core looks up an extra character-variant ref's metadata by slug. On the
  // route there is no graph — read it straight off the wired-character ref that
  // carries the same slug (self-contained; mirrors the FE/BE lookups).
  const lookupCharacterBySlug = (slug: string): CharacterMeta | undefined => {
    const m = connectedReferences.find(
      (r) => r.source === "wired-character" && r.characterSlug === slug,
    )
    if (!m) return undefined
    return {
      characterName: m.defaultName,
      defaultUsageMode: m.defaultUsageMode,
      canonicalDescription: m.characterCanonicalDescription ?? undefined,
      // Keep this third CharacterMeta producer in lockstep with the FE
      // (video-prompt-assembly.ts) and orchestrator (payload-builder.ts) ones.
      defaultRole: m.defaultRole,
      identityLock: m.identityLock,
    }
  }

  const core = resolveVideoReferenceCore({
    prompt,
    wiredCharRefs,
    extraRefs,
    lookupCharacterBySlug,
    referenceOrder,
    // D5 image-refs-first: the flat refs LEAD the unified `@image_N` numbering;
    // the core numbers assets after them and returns them prepended to
    // additionalUrls. `{image:N}` counts the full merged list; video/audio tokens
    // resolve against the flat ref counts.
    leadingRefUrls: cappedLeading,
    videoRefCount: referenceVideoCount,
    audioRefCount: referenceAudioCount,
    // BE gate: same env determination as the image side (see reference-format.ts).
    // default false = legacy block (dark in prod); flips in lockstep with image.
    hybridRoles: backendHybridRoles(),
    // `{ref:<id>}` degrade names for the refs the cap kept OUT of the walk.
    refNamesById,
  })

  // `core.additionalUrls` is already `[leading flat refs, …asset URLs]` (D5), so
  // `@image_N` numbered from the front lines up with the worker payload. Dedup
  // defensively, then cap at the provider's image-ref limit.
  const merged: string[] = []
  const seen = new Set<string>()
  for (const u of core.additionalUrls) {
    if (u && !seen.has(u)) {
      seen.add(u)
      merged.push(u)
    }
  }
  const capped = merged.slice(0, imageCap)
  return {
    prompt: core.prompt,
    referenceImageUrls: capped.length > 0 ? capped : baseReferenceImageUrls,
  }
}

/** True when the request carries a character-voice spec (voices and/or dialogue). */
function voiceSpecPresent(b: { characterVoices?: unknown; dialogue?: unknown }): boolean {
  return (
    (Array.isArray(b.characterVoices) && b.characterVoices.length > 0) ||
    (Array.isArray(b.dialogue) && b.dialogue.length > 0)
  )
}

/**
 * Credit id for the voiced-video audio step: audio_driven (Seedance 2)
 * synthesises a Dialogue v3 track; native_speech (VEO) revoices the baked audio
 * via the voice-changer. Single source for both the reservation (here) and the
 * worker's commit (forwarded through the queue as `voicedAudioAddon`).
 */
function voicedAudioAddonId(provider: string | undefined): "elevenlabs-dialogue" | "elevenlabs-voice-changer" {
  return getVideoAudioCapability(provider).mode === "audio_driven"
    ? "elevenlabs-dialogue"
    : "elevenlabs-voice-changer"
}

/**
 * Base (pre-markup) credit addon for the voiced-video audio chain, or 0 when the
 * request isn't voiced or the provider can't carry dialogue. Mirrors the
 * loop-trim addon: reserved up front via base costs (no double-markup), and
 * refunded by the worker's finalize if the audio step doesn't actually run.
 */
async function voicedAudioAddonCredits(b: Record<string, unknown>): Promise<number> {
  const provider = b.provider as string | undefined
  if (!voiceSpecPresent(b) || !videoModelCanSpeakDialogue(provider)) return 0
  const { creditCost } = await getModelCreditBaseCost(voicedAudioAddonId(provider))
  return creditCost
}

/**
 * Fastify preHandler: for Seedance 2.0 providers with a verified r2v
 * reference-audio cap (e.g. seedance-2-fast ≤ 15.2s), ffprobe each reference
 * audio and reject BEFORE submit if any exceeds the limit — otherwise KIE 400s
 * after the job is created (and, pre-fix, the reconcile cron sat on it ~90 min).
 * Best-effort on the probe: a probe failure does NOT block the request (it
 * proceeds; a genuinely-too-long clip is then caught by KIE and fails fast via
 * the reconcile upstream-failure path). Skips any provider without an enforced
 * cap. Runs BEFORE creditGuard so we never reserve credits for a request we're
 * about to reject. (Input mode is auto-detected downstream by
 * resolveSeedance2Inputs; reference audio is always validated when present.)
 */

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/generate-video",
  description:
    "Generate a video (async): text-to-video, image-to-video (imageUrl = start " +
    "frame), first+last frame, or reference mode — chosen from the inputs. " +
    "Omitting provider uses the platform default. Returns a jobId — poll " +
    "GET /v1/jobs/{id}/status.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: generateVideoBody } } } },
  responses: {
    200: {
      description: "Job created (may include non-fatal warnings)",
      content: { "application/json": { schema: z.object({
        jobId: z.string().uuid(),
        warnings: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
      }) } },
    },
    401: { description: "Unauthorized" },
    402: { description: "Insufficient credits" },
  },
})

export async function validateSeedance2AudioPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const provider = body.provider as string | undefined
  const limit = seedance2AudioLimitSec(provider)
  if (limit === null) return
  const urls = body.referenceAudioUrls
  if (!Array.isArray(urls) || urls.length === 0) return

  // Probe in parallel, bounded to the PROVIDER's accepted audio count (2.5
  // takes 10 where 2.0 takes 3) — this runs BEFORE the Zod ceiling check, so
  // never ffprobe an unbounded list. A probe failure is best-effort: map it
  // to NaN (which findSeedance2AudioOverLimit ignores) so a blip can't block
  // a valid request.
  const audioCap = { ...SEEDANCE_2_REF_LIMITS, ...(provider ? (VIDEO_REF_LIMITS_BY_PROVIDER[provider] ?? {}) : {}) }.audio
  const candidates = urls
    .slice(0, audioCap)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
  const settled = await Promise.allSettled(candidates.map((u) => probeMediaDuration(u)))
  const durations = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value
    req.log.warn({ err: r.reason, url: candidates[i] }, "generate-video: seedance-2 reference-audio ffprobe failed; skipping length check")
    return NaN
  })

  const over = findSeedance2AudioOverLimit(provider, durations)
  if (over !== null) {
    reply.status(400).send({
      error: {
        code: "audio_too_long",
        message: `Reference audio is too long for this model: ${over.toFixed(1)}s exceeds the ${limit}s limit. Please use a shorter audio clip.`,
      },
    })
  }
}

export async function generateVideoRoutes(app: FastifyInstance) {
  app.post("/v1/generate-video", {
    preHandler: [
      validateSeedance2AudioPreHandler,
      creditGuard(
      (req) => {
        const body = req.body as Record<string, unknown>
        const hasVideoRef = Array.isArray(body?.referenceVideoUrls) && (body.referenceVideoUrls as unknown[]).length > 0
        const sel = applyDefaultVideoSelection({ provider: body?.provider as string | undefined, duration: body?.duration as number | string | undefined })
        return buildVideoCreditModelIdentifier(
          sel.provider,
          sel.duration,
          body?.sound as boolean | undefined,
          "image-to-video",
          body?.videoSize as string | undefined,
          body?.resolution as string | undefined,
          hasVideoRef,
        )
      },
      {
        computeCredits: async (body) => {
          const b = body as Record<string, unknown>
          const hasVideoRef = Array.isArray(b?.referenceVideoUrls) && (b.referenceVideoUrls as unknown[]).length > 0
          // Seedance 2 reference-video runs are billed unit×(input+output). The
          // seeded `-ref` composite only encodes the per-8s OUTPUT rate, so we
          // ffprobe the connected reference videos and reserve the FULL scaled
          // base UP FRONT (commit_credits only refunds — never up-charges). Core
          // may not statically import ee/, so the helper is loaded dynamically
          // (the allowed escape hatch — same pattern the credit-guard shim uses).
          if (isSeedance2Provider(b?.provider as string | undefined) && hasVideoRef) {
            const { seedance2RefVideoBaseCreditsFromUrls } = await import("../ee/billing/seedance2-ref-video-credits.js")
            return seedance2RefVideoBaseCreditsFromUrls({
              provider: b.provider as string,
              resolution: (b.resolution as string | undefined) ?? "720p",
              outputDurationSec: Number(b.duration ?? 5),
              referenceVideoUrls: b.referenceVideoUrls as unknown[],
            })
          }
          // MiniMax Hailuo 3 bills unit×(input+output) for reference-video runs
          // AND surcharges input images beyond the first 5 (11 KIE cr each).
          // Predict the ASSEMBLED reference-image count exactly the way the
          // handler will build it (connectedReferences → referenceImageUrls →
          // frames folded by the shared resolver), then reserve the full
          // scaled base up front (commit_credits only refunds).
          //
          // The `direction` fold is deliberately NOT applied here, and the
          // prediction stays exact without it: the fold is TEXT-ONLY, and the
          // billed quantity below is the assembled REFERENCE COUNT, which no
          // amount of prompt text can move. The one shape that could — a
          // catalog hint, term or LABEL containing a literal `{image:N}` /
          // `{ref:` / `@slug:N` (labels are woven verbatim into the multi-pick
          // blend clauses) — is ruled out for every registered catalog by
          // `packages/prompts/src/__tests__/direction-hint-token-safety.test.ts`.
          if (isMinimaxH3Provider(b?.provider as string | undefined)) {
            const { minimaxH3BaseCreditsFromUrls, minimaxH3BillableRefImageCount, MINIMAX_H3_FREE_INPUT_IMAGES } =
              await import("../ee/billing/minimax-h3-credits.js")
            const refVideos = Array.isArray(b.referenceVideoUrls) ? (b.referenceVideoUrls as unknown[]) : []
            const assembled = assembleVideoConnectedReferences({
              prompt: b.prompt as string | undefined,
              provider: b.provider as string,
              connectedReferences: (Array.isArray(b.connectedReferences) ? b.connectedReferences : []) as ConnectedReference[],
              baseReferenceImageUrls: (Array.isArray(b.referenceImageUrls) ? b.referenceImageUrls : undefined) as string[] | undefined,
              referenceOrder: (Array.isArray(b.referenceOrder) ? b.referenceOrder : undefined) as string[] | undefined,
              referenceVideoCount: refVideos.length,
              referenceAudioCount: Array.isArray(b.referenceAudioUrls) ? (b.referenceAudioUrls as unknown[]).length : 0,
            })
            const refImageCount = minimaxH3BillableRefImageCount({
              referenceImageUrls: assembled.referenceImageUrls,
              firstFrameUrl: b.imageUrl,
              lastFrameUrl: b.endFrameUrl,
              referenceVideoUrls: refVideos,
              referenceAudioUrls: Array.isArray(b.referenceAudioUrls) ? (b.referenceAudioUrls as unknown[]) : undefined,
            })
            if (hasVideoRef || refImageCount > MINIMAX_H3_FREE_INPUT_IMAGES) {
              return minimaxH3BaseCreditsFromUrls({
                outputDurationSec: Number(b.duration ?? 6),
                referenceVideoUrls: refVideos,
                referenceImageCount: refImageCount,
                resolution: b.resolution,
              })
            }
            // No ref videos and ≤5 images → the seeded duration composite prices it.
          }
          const bSel = applyDefaultVideoSelection({ provider: b?.provider as string | undefined, duration: b?.duration as number | string | undefined })
          const modelId = buildVideoCreditModelIdentifier(
            bSel.provider,
            bSel.duration,
            b?.sound as boolean | undefined,
            "image-to-video",
            b?.videoSize as string | undefined,
            b?.resolution as string | undefined,
            hasVideoRef,
          )
          const { creditCost: baseCost } = await getModelCreditBaseCost(modelId)
          // Normalize legacy autoLoopTrim into loopTrim for addon math.
          const rawLoopTrim = b.loopTrim as { enabled?: boolean; framesToTest?: number } | undefined
          const legacyAuto = b.autoLoopTrim as boolean | undefined
          const loopTrim = rawLoopTrim ?? (legacyAuto !== undefined
            ? (legacyAuto ? { enabled: true, framesToTest: 8 } : { enabled: false })
            : undefined)
          const duration = typeof b.duration === "number" ? b.duration : 8
          const addon = estimateLoopTrimAddonCredits(loopTrim, duration)
          const audioAddon = await voicedAudioAddonCredits(b)
          return baseCost + addon + audioAddon
        },
      },
    ),
    ],
  }, async (req, reply) => {
    const parsed = generateVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, prompt: rawPrompt, provider: rawProvider, generateAudio, duration: rawDuration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, webSearch, nsfwChecker, generationType: rawGenerationType, autoLoopTrim, loopTrim: rawLoopTrim, enableTranslation, videoTrimStart, videoTrimEnd, characterVoices, dialogue } = parsed.data
    // Platform default when the request omits provider/duration — the SAME
    // helper the DAG payload builder uses, so the two paths cannot drift.
    const { provider, duration } = applyDefaultVideoSelection({ provider: rawProvider, duration: rawDuration })
    let prompt = rawPrompt

    // Cinematic direction fold — catalog IDS → prompt text, server-side.
    //
    // Runs BEFORE the connected-reference assembly below because
    // `resolveVideoReferenceCore` FRAMES the body: the legacy format prepends
    // its "Use these characters:" block, hybrid prepends the lock lines and
    // APPENDS the canonical role phrases. Folding afterwards would strand the
    // scene/look description past the identity directives — a worse version of
    // the bug this channel exists to fix.
    //
    // No `subject`/`direction` → `composeVideoPromptText` returns `prompt` verbatim
    // (`undefined` included), so the flat path stays byte-identical (the
    // "backward-compatible: no connectedReferences → prompt + flat refs pass
    // through unchanged" oracle in generate-video.test.ts).
    // The provider clamp (`applyVideoNegativePrompt`) hard-slices the prompt
    // tail at this ceiling, ORDER-BLIND. The EFFECTIVE ceiling is not always the
    // model cap: for a provider without a native negative param the clamp folds
    // the negative in as a "\nAvoid: …" suffix and RESERVES room for it first
    // (`model-constants.ts`'s `room = promptMax - avoid.length`), so the base
    // prompt is cut at `cap - suffix`. `effectiveVideoPromptCeiling` is the one
    // mirror of that reservation, shared with text-to-video.
    const promptCeiling = effectiveVideoPromptCeiling(provider, negativePrompt)

    // The FRAMING the cap is measured through. `resolveVideoReferenceCore` runs
    // AFTER the fold (see above) and ADDS the binding text — hybrid APPENDS the
    // canonical role phrases, so they land behind every folded hint and are the
    // first thing a tail cut destroys. Handing the composer this closure puts
    // that added text inside the shed's budget while leaving it un-sheddable:
    // the only thing the composer can drop is a clause it rendered itself.
    // Pure and cheap (no I/O), so calling it once per shed iteration is fine —
    // the real assembly below re-runs it on the settled body.
    //
    // Mirrors the assembly's own gate exactly: no `connectedReferences` → the
    // body is not framed at all, so the frame is identity.
    const connectedRefs = parsed.data.connectedReferences
    const frameWithReferences = (body: string | undefined): string | undefined =>
      connectedRefs && connectedRefs.length > 0
        ? assembleVideoConnectedReferences({
          prompt: body,
          provider,
          connectedReferences: connectedRefs,
          baseReferenceImageUrls: parsed.data.referenceImageUrls,
          referenceOrder: parsed.data.referenceOrder,
          referenceVideoCount: parsed.data.referenceVideoUrls?.length ?? 0,
          referenceAudioCount: parsed.data.referenceAudioUrls?.length ?? 0,
        }).prompt
        : body

    if (parsed.data.direction || parsed.data.subject) {
      // TRUNCATION ORDERING: pass the ceiling + the framing so the composer
      // sheds its own hint clauses (last-folded first) instead of letting the
      // order-blind clamp sever a reference binding or the end of the prose.
      // A prompt that already fits is byte-identical to the capless fold.
      // Both catalog channels ride the one sheddable list, subject ahead of
      // direction, so a subject-only fold is budgeted the same way.
      const composed = composeVideoPromptText(prompt, parsed.data.direction, undefined, {
        ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
        cap: promptCeiling,
        frame: frameWithReferences,
      })
      if (composed !== prompt) {
        // `input_data.userPrompt` records the SOURCE, never the render.
        // `buildJobInputData` only mirrors prompt→userPrompt when userPrompt is
        // unset, and it runs AFTER we overwrite parsed.data.prompt — so pin the
        // original submission here. The `?? ""` branch is load-bearing: a
        // direction- or subject-only run has no `prompt`, and without it the fold's OUTPUT
        // would be recorded as the user's own words. (A FULL shed folds nothing
        // and leaves `composed === prompt`, so it correctly pins nothing.)
        parsed.data.userPrompt ??= rawPrompt ?? ""
        prompt = composed
        parsed.data.prompt = prompt
      }
    }

    // Seedance 2 accepts unified inputs: pass every wired input (first/last frame,
    // reference image/video/audio) through unconditionally. The shared
    // resolveSeedance2Inputs (kie/video.ts::applySeedance2Params) is the single
    // decision point that derives the mode from whatever inputs arrive — there is
    // no mutual-exclusivity to enforce here. (The deprecated seedance2InputMode
    // body field is accepted-but-ignored for back-compat.)
    const imageUrl = parsed.data.imageUrl
    const endFrameUrl = parsed.data.endFrameUrl
    let referenceImageUrls = parsed.data.referenceImageUrls
    const referenceVideoUrls = parsed.data.referenceVideoUrls
    const referenceAudioUrls = parsed.data.referenceAudioUrls

    // Legacy autoLoopTrim → loopTrim normalization. Drop in a future release.
    const loopTrim = rawLoopTrim ?? (autoLoopTrim !== undefined
      ? (autoLoopTrim
        ? { enabled: true, framesToTest: 8, quality: "precise" as const }
        : { enabled: false })
      : undefined)
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Structured references (parity with generate-image). When present, assemble
    // them server-side via the shared video resolver — the SAME core the canvas
    // + orchestrator use — so a direct API/SDK run binds inline `{image:N}`
    // references to the right attached image. Absent → flat path untouched
    // (byte-identical to before). Runs BEFORE identity injection so that, when
    // both are set, the canonical-description suffix layers on top of the
    // assembled prompt (mirrors generate-image's ordering).
    if (parsed.data.connectedReferences && parsed.data.connectedReferences.length > 0) {
      const assembled = assembleVideoConnectedReferences({
        prompt,
        provider,
        connectedReferences: parsed.data.connectedReferences,
        baseReferenceImageUrls: referenceImageUrls,
        referenceOrder: parsed.data.referenceOrder,
        referenceVideoCount: referenceVideoUrls?.length ?? 0,
        referenceAudioCount: referenceAudioUrls?.length ?? 0,
      })
      prompt = assembled.prompt
      referenceImageUrls = assembled.referenceImageUrls
      // Mirror the assembled values into parsed.data so buildJobInputData records
      // exactly what the worker receives.
      parsed.data.prompt = prompt
      parsed.data.referenceImageUrls = referenceImageUrls
    }

    // Truncation warning, measured on the ASSEMBLED prompt — the same string the
    // shed above budgeted for, and the one the provider clamp will actually cut.
    // (Before shedding existed this compared the pre-resolver body, which both
    // over-fired on runs the clamp never touched and missed every byte the
    // resolver added.) Reaching here means the overflow was UNSHEDABLE: prose or
    // bindings alone clear the ceiling, so the order-blind clamp is the last
    // resort. Still gated on the fold — the platform only owns the length on the
    // runs where it rendered the text — but that gate is now EITHER catalog
    // channel: a subject-only fold renders text the same way, so leaving it out
    // would make exactly those overflows clamp silently.
    if ((parsed.data.direction || parsed.data.subject) && prompt && prompt.length > promptCeiling) {
      req.log.warn(
        { provider, promptLength: prompt.length, promptCeiling },
        "[generate-video] assembled prompt exceeds the provider ceiling after shedding every hint; the tail will be clamped",
      )
    }

    // Identity injection — when enabled + a character is referenced, append
    // the canonical_description (with description fallback) plus an
    // identity-preserve suffix to the prompt. Off by default.
    if (parsed.data.injectCharacterContext && parsed.data.attachToCharacterId) {
      const { data: char } = await supabase
        .from("characters")
        .select("canonical_description, description, name")
        .eq("id", parsed.data.attachToCharacterId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single()
      if (char) {
        const canonical = typeof char.canonical_description === "string" ? char.canonical_description.trim() : ""
        const desc = typeof char.description === "string" ? char.description.trim() : ""
        const identityText = canonical.length > 0 ? canonical : (desc.length > 0 ? desc : "")
        if (identityText.length > 0) {
          const base = (prompt ?? "").trim()
          // image-to-video prompt is optional — start from empty if absent.
          prompt = base.length > 0
            ? `${base}\n\n${identityText}\n\n${IDENTITY_PRESERVE_SUFFIX}`
            : `${identityText}\n\n${IDENTITY_PRESERVE_SUFFIX}`
          // Mirror the final prompt into parsed.data so buildJobInputData
          // captures it in jobs.input_data.
          parsed.data.prompt = prompt
          if (prompt.length > 2000) {
            req.log.warn(
              { characterId: parsed.data.attachToCharacterId, finalPromptLength: prompt.length },
              "[image-to-video] character context injection produced a long prompt; consider trimming canonicalDescription",
            )
          }
        }
      }
    }

    // B4b: apply any registered video PromptPolicy at the server-authoritative
    // final prompt (covers structured assembly, identity injection, and the
    // legacy verbatim path). Mirror into parsed.data so buildJobInputData records
    // exactly what the worker receives. No policy registered = identity.
    if (prompt !== undefined) {
      prompt = applyPromptPolicies({ prompt, negativePrompt: "", kind: "video" }).prompt
      parsed.data.prompt = prompt
    }

    // Ref-only exemption from the imageUrl requirement is CATALOG-driven, not a
    // hardcoded provider list: the run may proceed without a start frame when at
    // least one reference kind that is PRESENT is also CARRYABLE by the provider
    // (a positive VIDEO_REF_LIMITS_BY_PROVIDER cap for that kind). The previous
    // hardcoded (Seedance-2 | gemini-omni-video) pair 400'd every references-only
    // run for kling-3-omni / grok-i2v / happyhorse-ref2v once the catalog
    // advertised their image-ref caps — the References UI is catalog-driven, so
    // this guard must derive from the same source. Matching per KIND (not "any
    // cap") keeps the guard meaningful: refs the provider would silently drop
    // (e.g. audio-only refs on an images-only model) still 400 rather than
    // degrade into an unanchored generation the user didn't ask for.
    const refCaps = VIDEO_REF_LIMITS_BY_PROVIDER[provider]
    const hasMultimodalRef =
      ((refCaps?.images ?? 0) > 0 && (referenceImageUrls?.length ?? 0) > 0) ||
      ((refCaps?.videos ?? 0) > 0 && (referenceVideoUrls?.length ?? 0) > 0) ||
      ((refCaps?.audio ?? 0) > 0 && (referenceAudioUrls?.length ?? 0) > 0)

    // VEO picks its REFERENCE_2_VIDEO wire mode from an explicit generationType
    // (the kie/video.ts i2v branch otherwise falls back to `[imageUrl!]`, which
    // is [undefined] on a ref-only run). The orchestrator already normalizes
    // this for ref-only workflow runs (payload-builder's refs-present arm);
    // mirror it here so direct API/SDK callers get the same behavior without
    // knowing the VEO-specific flag.
    let generationType = rawGenerationType
    if (!generationType && !imageUrl && isVeoProvider(provider) && (referenceImageUrls?.length ?? 0) > 0) {
      generationType = "REFERENCE_2_VIDEO"
      // Mirror into parsed.data so buildJobInputData records what the worker receives.
      parsed.data.generationType = generationType
    }

    if (!imageUrl && generationType !== "REFERENCE_2_VIDEO" && !hasMultimodalRef) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "imageUrl is required" },
      })
    }

    // Determine model identifier for credit check (supports variable pricing by duration/audio/resolution/video-ref)
    const modelIdentifier = buildVideoCreditModelIdentifier(
      provider,
      duration,
      sound,
      "image-to-video",
      videoSize,
      resolution,
      (referenceVideoUrls?.length ?? 0) > 0,
    )

    const mcpClient = extractMcpClient(req.body)
    // job_type is required for the reconcile cron to finalise the job
    // correctly — `lib/reconcile/replicate.ts` reads job_type to dispatch
    // into the right VIDEO_TYPES bucket in job-finalize.ts. Without it,
    // reconcile defaults to "generate-image" and tries to upload an LTX
    // video as an image. Always "image-to-video" here — this route only
    // serves i2v; the t2v route is `/v1/text-to-video`.
    //
    // Race-proof INSERT: see generate-image.ts for the rationale. If a
    // concurrent caller already inserted with the same (user_id,
    // idempotency_key), the DB UNIQUE constraint catches it and we get
    // back the winner's row with `created: false`.
    let insertResult: { row: { id: string }; created: boolean }
    try {
      insertResult = await insertJobIdempotent<{ id: string }>(
        req,
        {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          job_type: "image-to-video",
          status: "pending",
          input_data: buildJobInputData(parsed.data, "image-to-video"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        },
        req.idempotencyKey,
      )
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to create video generation job")
    }
    const job = insertResult.row

    if (!insertResult.created) {
      reply.header("X-Dedup-Hit", "1")
      return reply.code(200).send({ jobId: job.id, deduped: true })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // Voiced-video gate: a voice spec only triggers the audio chain when the
    // model can carry dialogue (native_speech / audio_driven). Otherwise the
    // spec is dropped and the clip generates silently — we never fail it — but
    // we surface a non-fatal warning so the skip is never silent. The render-time
    // "no voice on this model" confirmation lives in studio (client-side, via the
    // same videoModelCanSpeakDialogue helper).
    const wantsVoice = voiceSpecPresent(parsed.data)
    const canVoice = videoModelCanSpeakDialogue(provider)
    const isVoiced = wantsVoice && canVoice
    // Credit addon the worker commits on top of the video provider cost (mirrors
    // loop-trim's extraNonProviderCredits). Computed here so the route owns all
    // billing math; the worker forwards it verbatim to finalize.
    const voicedAudioAddon = isVoiced
      ? (await getModelCreditBaseCost(voicedAudioAddonId(provider))).creditCost
      : 0

    await videoQueue.add(isVoiced ? "voiced-video" : "image-to-video", {
      jobId: job.id,
      imageUrl,
      endFrameUrl,
      audioUrl,
      prompt,
      provider,
      generateAudio,
      duration,
      mode,
      sound,
      negativePrompt,
      motionPrompt,
      cfgScale,
      aspectRatio,
      multiShot,
      shots,
      elements,
      resolution,
      grokMode,
      videoSize,
      seed,
      cameraFixed,
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      webSearch,
      nsfwChecker,
      generationType,
      loopTrim,
      enableTranslation,
      videoTrimStart,
      videoTrimEnd,
      ...(isVoiced ? { characterVoices, dialogue, voicedAudioAddon } : {}),
      usageLogId,
    })

    if (wantsVoice && !canVoice) {
      return {
        jobId: job.id,
        warnings: [
          {
            code: "voice_unsupported_for_provider",
            message: `The selected model (${provider}) can't voice dialogue; the clip was generated without voice. Use a VEO 3.x or Seedance-2 model for character voice.`,
          },
        ],
      }
    }
    return { jobId: job.id }
  })
}
