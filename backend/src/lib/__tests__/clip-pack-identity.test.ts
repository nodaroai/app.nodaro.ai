// @test-units-by-name freezes Clip Pack's composed facts across its unit conversion
// @test-watches backend/src/lib/__tests__/fixtures/clip-pack-identity.json
/**
 * Clip Pack's facts as the server composes them, frozen before Clip Pack
 * becomes a node unit: its request body, its `GET /v1/nodes` entry, its
 * use-case descriptor, the chain it is built into, its (absent) length rule,
 * its fee and every list it belongs to. The conversion moves where these are
 * written; it must not change one of them.
 *
 * Only Clip Pack's own facts are recorded, plus its predecessor in each
 * ordered list (never a whole list): other nodes join those lists later, and
 * this fixture must survive that.
 *
 * Each graph and length row holds its own inputs; compare mode rebuilds every
 * row from those, so the fixture does not lean on today's defaults. The
 * fixture is written once (`UNITS_RECORD_CLIP_PACK_IDENTITY=1`), on the code
 * before the conversion, and a write is refused when it already exists. Never
 * re-record it after the conversion: a re-recording takes whatever the code
 * then builds as the truth.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  RUN_RESULT_TYPE_KEYS,
  USE_CASE_NODE_TYPES,
  toStoredInlineGraph,
  usecaseContinuePath,
  usecaseDescriptor,
  usecaseFanOutRefusalOf,
  usecaseFeeCreditId,
  usecaseListsItsResult,
  usecaseResultIsText,
  type UseCaseMediaSource,
} from "@nodaro/render-rules"
import { getOutputType } from "@nodaro/shared/apps"
import {
  AUDIO_PRODUCER_TYPES,
  DYNAMIC_PRODUCER_TYPES,
  FAN_OUT_EACH_HANDLES,
  REVIEW_HOLDING_USE_CASE_TYPES,
  VIDEO_PRODUCER_TYPES,
  declaredJsonOutput,
} from "@nodaro/shared/nodes"
import { NON_PROMPT_TEXT_LANES, fanOutTextFeedsPrompt } from "@nodaro/shared/workflow"
import { USE_CASE_BODIES } from "../use-case/bodies.js"
import { NODE_REGISTRY, chargedDescriptor, findNode } from "../node-registry.js"
import type { ChargedPrices } from "../pricing/charged-prices.js"
import { VIDEO_OUTPUT_LENGTH_RULES, videoOutputLength, type WireInput } from "../video-output-length.js"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "../cloud-only-nodes.js"
import { ALL_NODE_HANDLES } from "../node-handles.js"
import { NODE_HANDLES } from "../mcp/generated/node-handles.js"
import { CREDIT_COSTS, STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const FIXTURE = join(__dirname, "fixtures", "clip-pack-identity.json")
const TYPE = "clip-pack" as const

/** The charged-prices stand-in GET /v1/nodes is tested with (nodes-charged-prices.test.ts): every static base up 10%. */
const CHARGED: ChargedPrices = {
  credits: (identifier, units = 1) => {
    const base = STATIC_CREDIT_COSTS[identifier]
    return base === undefined ? undefined : Math.ceil((base * units * 110) / 100)
  },
  rate: (identifier) => {
    const base = STATIC_CREDIT_COSTS[identifier]
    return base === undefined ? undefined : Math.ceil(base * 100 * 1.1 - 1e-9) / 100
  },
}

interface GraphCase {
  readonly name: string
  readonly raw: Record<string, unknown>
  readonly sources: { readonly media: UseCaseMediaSource }
}
interface LengthCase {
  readonly name: string
  readonly data: Record<string, unknown>
  readonly inputs: WireInput[]
}

const RECORDING: UseCaseMediaSource = { url: "https://r2/ep.mp4", kind: "video" }
const AUDIO_RECORDING: UseCaseMediaSource = { url: "https://r2/ep.mp3", kind: "audio" }
const CUSTOM_FRAMING = { aspect: "16:9", layout: "side-by-side", switchType: "cut", emphasisStyle: "border+dim" }
/** A node's data off every default: what the credit resolver is asked besides the defaults. */
const TUNED_DATA = {
  count: 3, targetDurationSec: 30, framing: null, captions: false, captionStyle: "subtitle",
  reviewBeforeRender: true, planTier: "premium", instructions: "Only the jokes.", styleGuide: "No ad reads.",
}
const MEDIA_WIRE: WireInput = { sourceId: "rec", handle: "media", kind: "video", length: { fixedSec: 0, perEpisodeSec: 1 } }
const AUDIO_WIRE: WireInput = { sourceId: "rec", handle: "media", kind: "audio", length: { fixedSec: 0, perEpisodeSec: 1 } }

/** The inputs the fixture is recorded from. Read only when recording; compare mode rebuilds from the recorded inputs. */
function graphCases(): GraphCase[] {
  return [
    { name: "defaults", raw: {}, sources: { media: RECORDING } },
    { name: "framing None (null)", raw: { framing: null }, sources: { media: RECORDING } },
    { name: "captions off", raw: { captions: false }, sources: { media: RECORDING } },
    { name: "framing None and captions off", raw: { framing: null, captions: false }, sources: { media: RECORDING } },
    { name: "a custom framing (16:9 side by side, cut, border+dim)", raw: { framing: CUSTOM_FRAMING }, sources: { media: RECORDING } },
    { name: "framing 1:1 grid, emphasis none", raw: { framing: { aspect: "1:1", layout: "grid", switchType: "zoom", emphasisStyle: "none" } }, sources: { media: RECORDING } },
    { name: "framing 4:5 pip", raw: { framing: { aspect: "4:5", layout: "pip", switchType: "pan", emphasisStyle: "scale" } }, sources: { media: RECORDING } },
    { name: "framing 9:16 auto layout", raw: { framing: { aspect: "9:16", layout: "auto" } }, sources: { media: RECORDING } },
    { name: "framing with only an aspect (the rest defaults)", raw: { framing: { aspect: "16:9" } }, sources: { media: RECORDING } },
    {
      name: "framing partly invalid (each bad field falls back alone)",
      raw: { framing: { aspect: "21:9", layout: "single", switchType: "warp", emphasisStyle: "none+scale" } },
      sources: { media: RECORDING },
    },
    { name: "framing not an object (the default framing)", raw: { framing: "wide" }, sources: { media: RECORDING } },
    { name: "caption style word-highlight", raw: { captionStyle: "word-highlight" }, sources: { media: RECORDING } },
    { name: "caption style subtitle", raw: { captionStyle: "subtitle" }, sources: { media: RECORDING } },
    { name: "caption style unknown (the default)", raw: { captionStyle: "comic-sans" }, sources: { media: RECORDING } },
    { name: "count 8, 30 s clips", raw: { count: 8, targetDurationSec: 30 }, sources: { media: RECORDING } },
    { name: "count and length clamped low", raw: { count: 0, targetDurationSec: 2 }, sources: { media: RECORDING } },
    { name: "count and length clamped high", raw: { count: 99, targetDurationSec: 999 }, sources: { media: RECORDING } },
    { name: "review on", raw: { reviewBeforeRender: true }, sources: { media: RECORDING } },
    { name: "review on, framing None", raw: { reviewBeforeRender: true, framing: null }, sources: { media: RECORDING } },
    {
      name: "plan tier, instructions and style guide set",
      raw: { planTier: "premium", instructions: "Only the jokes.", styleGuide: "Keep the guest's punchlines; drop the ad reads." },
      sources: { media: RECORDING },
    },
    { name: "an audio recording, defaults", raw: {}, sources: { media: AUDIO_RECORDING } },
    {
      name: "an audio recording, framing and captions set (forced off)",
      raw: { framing: CUSTOM_FRAMING, captions: true, captionStyle: "bouncy", count: 4 },
      sources: { media: AUDIO_RECORDING },
    },
    { name: "an audio recording, review on", raw: { reviewBeforeRender: true }, sources: { media: AUDIO_RECORDING } },
  ]
}

/** Clip Pack has no length rule today: these rows freeze that a wired recording gives "no-rule". */
function lengthCases(): LengthCase[] {
  return [
    { name: "a video recording, defaults", data: {}, inputs: [MEDIA_WIRE] },
    { name: "an audio recording", data: {}, inputs: [AUDIO_WIRE] },
    { name: "a video recording, 8 clips of 30 s", data: { count: 8, targetDurationSec: 30 }, inputs: [MEDIA_WIRE] },
  ]
}

/** A value as JSON keeps it: functions and undefined keys dropped. */
const plain = <T>(v: T): unknown => (v === undefined ? "(undefined)" : JSON.parse(JSON.stringify(v)))

/** The type listed just before `type` (null when it is first or absent). */
function predecessor(types: readonly string[], type: string): string | null {
  const i = types.indexOf(type)
  return i > 0 ? types[i - 1]! : null
}

function requestBody(): unknown {
  return z.toJSONSchema(USE_CASE_BODIES[TYPE])
}

function graphRow(c: GraphCase) {
  const d = usecaseDescriptor(TYPE)
  const settings = d.resolveSettings(c.raw, c.sources.media.kind)
  return { name: c.name, raw: c.raw, sources: c.sources, stored: plain(toStoredInlineGraph(d.build(settings, c.sources), settings)) }
}

function lengthRow(c: LengthCase) {
  return { name: c.name, data: c.data, inputs: c.inputs, length: plain(videoOutputLength({ id: "c1", type: TYPE, data: c.data }, c.inputs)) }
}

function facts(graphs: readonly GraphCase[], lengths: readonly LengthCase[]) {
  const found = findNode(TYPE)
  const d = usecaseDescriptor(TYPE)
  const runResultKeys = RUN_RESULT_TYPE_KEYS[TYPE] ?? []
  return {
    requestBody: plain(requestBody()),
    nodesEntry: {
      found: plain(found),
      chargedDescription: found ? chargedDescriptor(found, CHARGED).description : "(not found)",
      registryPredecessor: predecessor(NODE_REGISTRY.map((n) => n.type), TYPE),
    },
    descriptor: plain({
      label: d.label, route: d.route, maxSourceSec: d.maxSourceSec, needsVideo: d.needsVideo, inputs: d.inputs,
      inputNodeIds: d.inputNodeIds, settingKeys: d.settingKeys, reviewable: d.reviewable, resultKind: d.resultKind,
      triesEvery: d.triesEvery,
      continuePath: usecaseContinuePath(TYPE),
      listsItsResult: usecaseListsItsResult(TYPE),
      resultIsText: usecaseResultIsText(TYPE),
    }),
    graphs: graphs.map(graphRow),
    // No length rule names Clip Pack today (its clips are runtime-typed, not a video producer).
    lengthRule: plain(VIDEO_OUTPUT_LENGTH_RULES[TYPE]),
    lengths: lengths.map(lengthRow),
    money: {
      staticFee: plain(STATIC_CREDIT_COSTS[`use-case-fee:${TYPE}`]),
      // The id the run route reserves the fee under (use-case-run.ts / use-case-continue.ts).
      reservedCreditId: usecaseFeeCreditId(TYPE),
      // The id the estimator and the engine bill a node of this type under (CREDIT_COSTS), for the defaults and for tuned data.
      creditResolver: {
        defaults: plain(CREDIT_COSTS[TYPE]?.({})),
        tuned: plain(CREDIT_COSTS[TYPE]?.(TUNED_DATA)),
      },
    },
    membership: {
      runResultTypeKeys: plain(RUN_RESULT_TYPE_KEYS[TYPE]),
      // `failedCaptions` is a count on the run's output_data (wrapper-output-lists.ts), not a node run-result key.
      runResultHasFailedClips: runResultKeys.includes("failedClips"),
      runResultHasFailedCaptions: runResultKeys.includes("failedCaptions"),
      fanOutEachHandles: plain(FAN_OUT_EACH_HANDLES[TYPE]),
      reviewHolding: REVIEW_HOLDING_USE_CASE_TYPES.has(TYPE),
      videoProducer: VIDEO_PRODUCER_TYPES.has(TYPE),
      audioProducer: AUDIO_PRODUCER_TYPES.has(TYPE),
      dynamicProducer: DYNAMIC_PRODUCER_TYPES.has(TYPE),
      declaredJsonOutput: plain(declaredJsonOutput(TYPE, "json")),
      declaredJsonOutputOnClips: plain(declaredJsonOutput(TYPE, "clips")),
      // Every non-prompt text lane that names Clip Pack itself (a lane open to every type, "*", is not Clip Pack's fact).
      nonPromptLanes: Object.entries(NON_PROMPT_TEXT_LANES)
        .filter(([, types]) => types !== "*" && types.includes(TYPE))
        .map(([lane]) => lane),
      // Whether text fanned out into each input pip feeds the prompt.
      textFeedsPrompt: Object.fromEntries(usecaseDescriptor(TYPE).inputs.map((h) => [h, fanOutTextFeedsPrompt(TYPE, h)])),
      outputType: getOutputType(TYPE),
      nodaroExclusive: NODARO_EXCLUSIVE_NODE_TYPES.has(TYPE),
      fanOutRefusal: plain(usecaseFanOutRefusalOf({ type: TYPE, data: {} })),
      fanOutRefusalReviewOn: plain(usecaseFanOutRefusalOf({ type: TYPE, data: { reviewBeforeRender: true } })),
      useCaseTypesPredecessor: predecessor(USE_CASE_NODE_TYPES, TYPE),
    },
    // The MCP handle row, read through the composer (the generated table holds it today; a unit's row comes from its manifest).
    mcpHandles: plain(ALL_NODE_HANDLES[TYPE]),
  }
}

type Facts = ReturnType<typeof facts>

describe("Clip Pack keeps its composed facts", () => {
  if (process.env.UNITS_RECORD_CLIP_PACK_IDENTITY === "1") {
    it("records the fixture", () => {
      if (existsSync(FIXTURE)) throw new Error(`${FIXTURE} already exists: it is recorded once, before the conversion, and never re-recorded`)
      writeFileSync(FIXTURE, JSON.stringify(facts(graphCases(), lengthCases()), null, 2) + "\n")
      expect(existsSync(FIXTURE)).toBe(true)
    })
    return
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Facts
  const now = facts(
    recorded.graphs.map((g) => ({ name: g.name, raw: g.raw, sources: g.sources })),
    recorded.lengths.map((l) => ({ name: l.name, data: l.data, inputs: l.inputs })),
  )

  it("covers every recorded case", () => {
    expect(recorded.graphs).toHaveLength(23)
    expect(recorded.lengths).toHaveLength(3)
  })
  it("the request body", () => expect(now.requestBody).toEqual(recorded.requestBody))
  it("the /v1/nodes entry, its charged description and its predecessor", () => expect(now.nodesEntry).toEqual(recorded.nodesEntry))
  it("the use-case descriptor", () => expect(now.descriptor).toEqual(recorded.descriptor))
  for (const [i, g] of recorded.graphs.entries()) {
    it(`graph ${i} (${g.name}): the same stored snapshot and hash`, () => expect(now.graphs[i]).toEqual(g))
  }
  it("the length rule (none today)", () => expect(now.lengthRule).toEqual(recorded.lengthRule))
  for (const [i, l] of recorded.lengths.entries()) {
    it(`length ${i} (${l.name}): the same delivered length`, () => expect(now.lengths[i]).toEqual(l))
  }
  it("the fee and the credit id a run reserves", () => expect(now.money).toEqual(recorded.money))
  it("every list it belongs to", () => expect(now.membership).toEqual(recorded.membership))
  it("the MCP handle row", () => expect(now.mcpHandles).toEqual(recorded.mcpHandles))
  it("the composed handle row is the generated one while Clip Pack is hand-registered", () => {
    if (NODE_HANDLES[TYPE]) expect(plain(ALL_NODE_HANDLES[TYPE])).toEqual(plain(NODE_HANDLES[TYPE]))
  })
})
