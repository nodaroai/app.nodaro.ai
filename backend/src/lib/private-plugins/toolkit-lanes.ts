/**
 * THE TOOLKIT'S CONCURRENCY LANES — every `tk.providers.*`, `tk.ffmpeg.*`,
 * `tk.media.*` and `tk.llm.*` member a plugin calls holds one slot of its
 * lane (lib/concurrency-lanes/slot.ts) for the whole member call: create →
 * poll → result, an encode from start to end, every attempt of an LLM call.
 * The provider, LLM and SDK funnels the member reaches inside run under that
 * slot (a leaf hold) and take none of their own, so one member call is one
 * slot, never two. Under a job's own leaf slot nothing is taken; under a
 * coordinator (a plugin coordinator, an undeclared plugin type) each member
 * call takes its own slot at the front of the user's line; outside any hold
 * it is counted once as ungated.
 *
 * Each section's table names EVERY member of the contract (the mapped type
 * below fails the build on a new one): a lane and how the member's arguments
 * name its provider, or `exempt` with the reason it takes no slot (a status
 * read, a probe, a file-system helper, a sync value). A wrapped member keeps
 * its signature and its result; `__tests__/toolkit-lanes.test.ts` holds the
 * built toolkit to the tables.
 *
 * With the lanes not enforced (the only state this release allows) a slot is
 * always granted at once: a member call is counted, never delayed.
 */
import { SEEDANCE_DRAFT_FINALIZE_PROVIDER } from "@nodaro/shared/model-catalog"
import type { LlmContentBlock, LlmMessage } from "../llm/types.js"
import type { LeafLane } from "../concurrency-lanes/leaf-lanes.js"
import { HANDLER_PROVIDERS, primaryProviderOfJob, primaryProviderOfLlm, providerServingModel } from "../concurrency-lanes/provider-of.js"
import { takeSlotAhead, withConcurrencySlot, withSlotTakenAheadOr, type SlotRequest } from "../concurrency-lanes/slot.js"
import type {
  PluginFfmpegToolkit, PluginLlmMultimodalRequest, PluginLlmRequest, PluginLlmSideHoldToolkit, PluginLlmToolkit,
  PluginMediaToolkit, PluginProvidersToolkit,
} from "./types.js"

/** A member that takes no slot, and why. */
export interface ExemptMember { readonly exempt: string }

/** What a member call counts against: its provider (null for none known) and model. */
export interface MemberTarget { readonly provider: string | null; readonly model?: string | null }

/** A member that holds a slot of `lane` for its whole call; `of` reads its target from the call's arguments. */
export interface LaneMember<A extends readonly unknown[]> {
  readonly lane: LeafLane
  readonly of: (...args: A) => MemberTarget
  /**
   * The call a metered side hold's slot was taken ahead for (withSideHoldSlot):
   * it runs in that slot when the job has one idle. Every other member takes
   * its own.
   */
  readonly takesSlotAhead?: true
}

/** A function member may take a slot; anything else (a class, a value, a sync function's result) never does. */
type MemberLaneOf<F> = F extends (...args: infer A) => Promise<unknown> ? LaneMember<A> | ExemptMember : ExemptMember

/** One entry for EVERY member of a section (optional ones included). */
export type SectionLanes<S> = { readonly [K in keyof S]-?: MemberLaneOf<NonNullable<S[K]>> }

/** The sections whose members take a slot. */
export const LANE_SECTIONS = ["providers", "ffmpeg", "media", "llm"] as const
export type LaneSection = (typeof LANE_SECTIONS)[number]

const fixed = (provider: string | null): (() => MemberTarget) => () => ({ provider })
/** The provider the core handler of job `jobName` calls (provider-of.ts), read at call time. */
const handlerProvider = (jobName: string): (() => MemberTarget) => () => ({ provider: HANDLER_PROVIDERS[jobName] ?? null })
const LOCAL: LaneMember<readonly unknown[]> = { lane: "local", of: fixed("local") }
const local = <A extends readonly unknown[]>(): LaneMember<A> => LOCAL as LaneMember<A>

export const PROVIDER_MEMBER_LANES: SectionLanes<PluginProvidersToolkit> = {
  directVoiceChanger: { lane: "provider", of: handlerProvider("voice-changer") },
  textToSpeech: { lane: "provider", of: (_text, opts) => ({ provider: HANDLER_PROVIDERS["text-to-speech"] ?? null, model: opts.model ?? null }) },
  ttsCapabilities: { exempt: "a capability sheet read from this app's catalog: no provider call" },
  separateAudio: { lane: "provider", of: handlerProvider("audio-separation") },
  // Both go to the KIE video provider directly, never through the router.
  textToVideo: { lane: "provider", of: (_prompt, model) => ({ provider: "kie", model }) },
  imageToVideo: { lane: "provider", of: (_image, _prompt, model) => ({ provider: "kie", model }) },
  videoUpscale: { lane: "provider", of: (_url, model) => ({ provider: providerServingModel("video-upscale", model), model }) },
  finalizeSeedanceDraft: {
    lane: "provider",
    of: () => ({ provider: primaryProviderOfJob("video-upscale", { provider: SEEDANCE_DRAFT_FINALIZE_PROVIDER }), model: SEEDANCE_DRAFT_FINALIZE_PROVIDER }),
  },
  imageUpscale: { lane: "provider", of: (_url, model) => ({ provider: providerServingModel("image-editing", model), model }) },
  generateImage: { lane: "provider", of: (_prompt, model) => ({ provider: providerServingModel("image-generation", model), model }) },
  generateMusic: { lane: "provider", of: handlerProvider("suno-generate") },
  getVideoTaskStatus: { exempt: "one status read of a task already created: no new provider work" },
  // A download of a public post through the proxy pool, as the
  // extract-youtube-audio job (a provider-lane job, no AI provider).
  downloadYouTubeVideo: { lane: "provider", of: fixed(null) },
  downloadSocialPostVideo: { lane: "provider", of: fixed(null) },
  ytMetadataProbe: { exempt: "a metadata read of one link: nothing is downloaded or generated" },
  probeSocialPostVideo: { exempt: "a metadata read of one link: nothing is downloaded or generated" },
  YtUrlNotAllowedError: { exempt: "an error class: wrapping it would break instanceof" },
  socialPostVideoUrl: { exempt: "a synchronous URL parse" },
}

export const FFMPEG_MEMBER_LANES: SectionLanes<PluginFfmpegToolkit> = {
  runFfmpeg: local(),
  runFfmpegCapture: local(),
  createWorkDir: { exempt: "makes a temporary directory" },
  cleanupWorkDir: { exempt: "removes a temporary directory" },
  downloadFile: { exempt: "a file download: no encode and no provider work" },
  combineVideos: local(),
  extractTail: local(),
  renderEdlTimeline: local(),
  trimVideo: local(),
  probeVideoMeta: { exempt: "an ffprobe read of a header: no encode" },
  runFfprobe: { exempt: "an ffprobe read of a header: no encode" },
  getVideoDuration: { exempt: "an ffprobe read of a header: no encode" },
  probeMediaDuration: { exempt: "an ffprobe read of a header: no encode" },
  probeMediaStreams: { exempt: "an ffprobe read of a header: no encode" },
  needsTranscode: { exempt: "an ffprobe read of a header: no encode" },
  transcodeToBrowserSafe: local(),
  needsContainerRemux: { exempt: "a synchronous check of a name" },
  remuxToMp4: local(),
}

export const MEDIA_MEMBER_LANES: SectionLanes<PluginMediaToolkit> = {
  readPublicVideoFrame: local(),
  ensureMediaProxy: local(),
  proxyFrameToSourceMs: { exempt: "a synchronous lookup in a span map" },
  // Decode and inference on this server (ffmpeg + onnxruntime), no vendor.
  detectFaces: local(),
  detectFacesInImage: local(),
  extractAudio: local(),
  removeAudio: local(),
  pitchTempo: local(),
  mixAudio: local(),
  mergeVideoAudio: local(),
  applyAudioFx: local(),
  applyImageWatermark: local(),
  uploadVideoMaybeWatermark: local(),
  withMemorySlot: { exempt: "the plugin's own in-process picture work, already held by the box's memory admission; it calls no host member that takes a slot" },
}

/** The LLM call `req` makes, as the router would serve it now. */
function llmTarget(req: { model: string; requireLane?: "kie" | "direct"; messages?: readonly LlmMessage[] }): MemberTarget {
  return {
    provider: primaryProviderOfLlm({ modelId: req.model, system: "", messages: [...(req.messages ?? [])], ...(req.requireLane ? { requireLane: req.requireLane } : {}) }),
    model: req.model,
  }
}

const multimodalMessages = (req: PluginLlmMultimodalRequest): LlmMessage[] =>
  req.messages.map((m) => ({ role: m.role, content: m.content as string | LlmContentBlock[] }))

export const LLM_MEMBER_LANES: SectionLanes<PluginLlmToolkit> = {
  isKnownModel: { exempt: "a synchronous registry lookup" },
  // A metered reading's call: the slot its side hold took ahead (every
  // metered caller makes its reading through this member).
  completeStructuredMetered: { lane: "llm", of: (req) => llmTarget({ ...req, messages: multimodalMessages(req) }), takesSlotAhead: true },
  completeStructured: { lane: "llm", of: (req: PluginLlmRequest) => llmTarget(req) },
  // The member pins the direct lane unless the caller names one.
  completeStructuredMultimodal: {
    lane: "llm",
    of: (req) => llmTarget({ ...req, requireLane: req.requireLane ?? "direct", messages: multimodalMessages(req) }),
  },
}

/** Marks a wrapped member with the lane it holds (for the totality test). */
export const MEMBER_LANE = Symbol.for("nodaro.toolkit.memberLane")

/** The lane a built toolkit member holds, or undefined when it takes none. */
export function memberLaneOf(member: unknown): LeafLane | undefined {
  return typeof member === "function" ? (member as { [MEMBER_LANE]?: LeafLane })[MEMBER_LANE] : undefined
}

/** Marks a wrapped member with the function it calls. */
const MEMBER_FN = Symbol.for("nodaro.toolkit.memberFn")

/** The function a built toolkit member calls inside its slot (the member itself when it takes none). For tests pinning the wiring. */
export function memberFnOf(member: unknown): unknown {
  return typeof member === "function" ? ((member as { [MEMBER_FN]?: unknown })[MEMBER_FN] ?? member) : member
}

function targetOf(spec: LaneMember<readonly unknown[]>, args: readonly unknown[]): MemberTarget {
  try {
    return spec.of(...args)
  } catch {
    // An argument the member itself will refuse: the call fails as before, under no provider.
    return { provider: null }
  }
}

/**
 * The section `members` with every member its table gives a lane wrapped to
 * hold a slot of it for the whole call. A member the section does not carry
 * (an optional one) stays absent; nothing else changes.
 */
export function withMemberSlots<S extends object>(section: LaneSection, members: S, lanes: SectionLanes<S>): S {
  const out: Record<string, unknown> = { ...(members as Record<string, unknown>) }
  for (const [name, spec] of Object.entries(lanes) as [string, LaneMember<readonly unknown[]> | ExemptMember][]) {
    const fn = out[name]
    if (typeof fn !== "function" || "exempt" in spec) continue
    const jobType = `tk.${section}.${name}`
    const wrapped = function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const target = targetOf(spec, args)
      // The call's own funnel calls are part of it (coversNested): one slot, counted once.
      const req: SlotRequest = { lane: spec.lane, provider: target.provider, jobType, model: target.model ?? null, coversNested: true }
      const run = () => (fn as (...a: unknown[]) => Promise<unknown>).apply(this, args)
      // A metered reading runs in the slot its side hold took ahead (withSideHoldSlot).
      return spec.takesSlotAhead ? withSlotTakenAheadOr(req, run) : withConcurrencySlot(req, run)
    }
    Object.defineProperty(wrapped, MEMBER_LANE, { value: spec.lane })
    Object.defineProperty(wrapped, MEMBER_FN, { value: fn })
    Object.defineProperty(wrapped, "name", { value: name })
    out[name] = wrapped
  }
  return out as S
}

type SideReserve = PluginLlmSideHoldToolkit["reserve"]
type SideHold = Extract<Awaited<ReturnType<SideReserve>>, { ok: true }>["hold"]

/**
 * `tk.llmBilling.side.reserve` taking the reading's `llm` slot FIRST: the
 * side-hold sweep counts its grace from the hold's reservation and call-start
 * stamps, so a wait for the slot after them could see a hold settled whose
 * call then runs. The slot is taken (and waited for) before the hold is
 * reserved; a wait that ends throws as the call would have, and no hold is
 * opened. The job's next metered reading (`completeStructuredMetered`) runs
 * in that slot (withSlotTakenAheadOr), with no second acquire; any other LLM
 * member takes its own. The slot is freed once the hold is settled (or its
 * call start refused, or the reserve refused) AND no reading runs in it, or
 * when the job ends. With metered pricing off (`available()` false) the
 * reserve's answer is a refusal whatever happens, so no slot is taken.
 */
export function withSideHoldSlot(reserve: SideReserve, available: () => boolean): SideReserve {
  return async (args) => {
    const target = available() ? plannedTarget(args) : null
    // A refusal that is certain (pricing off, a malformed request) takes no slot: the reserve answers as before.
    const ahead = target
      ? await takeSlotAhead({ lane: "llm", provider: target.provider, jobType: `tk.llmBilling.side.${args.feature}`, model: target.model ?? null })
      : NO_SLOT
    let r: Awaited<ReturnType<SideReserve>>
    try {
      r = await reserve(args)
    } catch (err) {
      await ahead.release("failed")
      throw err
    }
    if (!r.ok) {
      await ahead.release("completed")
      return r
    }
    return { ok: true, hold: holdFreeingSlot(r.hold, ahead.release) }
  }
}

const NO_SLOT = { release: async (): Promise<void> => {} }

/**
 * What the reading's first planned call counts against; null when the
 * request is malformed, which the reserve refuses (an answer, never a throw)
 * exactly as before the slot. Never throws.
 */
function plannedTarget(args: Parameters<SideReserve>[0]): MemberTarget | null {
  try {
    const first = args.calls[0]
    if (typeof first?.modelId !== "string" || first.modelId.length === 0) return null
    const req = first.request
    return {
      provider: llmTarget({ model: first.modelId, requireLane: req?.requireLane, messages: Array.isArray(req?.messages) ? (req.messages as LlmMessage[]) : [] }).provider,
      model: first.modelId,
    }
  } catch {
    return null
  }
}

/**
 * Every member of a side hold, each stated in holdFreeingSlot: a new one
 * (even an optional one, which a plugin `?.`-checks) fails the build until it
 * is passed through.
 */
const SIDE_HOLD_KEYS = ["jobId", "usageLogId", "chargeId", "holdCredits", "replayed", "callStarting", "noteSpend", "settle"] as const
type MissingSideHoldKey = Exclude<keyof SideHold, (typeof SIDE_HOLD_KEYS)[number]>
const sideHoldKeysComplete: MissingSideHoldKey extends never ? true : MissingSideHoldKey = true
void sideHoldKeysComplete

/** `hold`, whose settle (or a refused call start) also frees the reading's slot. */
function holdFreeingSlot(hold: SideHold, release: (outcome: "completed" | "failed") => Promise<void>): SideHold {
  return {
    jobId: hold.jobId,
    usageLogId: hold.usageLogId,
    chargeId: hold.chargeId,
    holdCredits: hold.holdCredits,
    replayed: hold.replayed,
    callStarting: async () => {
      try {
        await hold.callStarting()
      } catch (err) {
        // The call is not sent: its slot is not needed.
        await release("failed")
        throw err
      }
    },
    noteSpend: (spend) => hold.noteSpend(spend),
    settle: async (spend) => {
      try {
        return await hold.settle(spend)
      } finally {
        await release("completed")
      }
    },
  }
}
