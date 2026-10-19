// @test-units-by-name freezes Trailer's composed facts across its unit conversion
// @test-watches backend/src/lib/__tests__/fixtures/episode-trailer-identity.json
/**
 * Trailer's facts as the server composes them, frozen before Trailer becomes a
 * node unit: its request body, its `GET /v1/nodes` entry, its use-case
 * descriptor, the chain it is built into, the length it delivers, its fee and
 * every list it belongs to. The conversion moves where these are written; it
 * must not change one of them.
 *
 * Only Trailer's own facts are recorded, plus its predecessor in each ordered
 * list (never a whole list): other nodes join those lists later, and this
 * fixture must survive that.
 *
 * Each graph and length row holds its own inputs; compare mode rebuilds every
 * row from those, so the fixture does not lean on today's defaults. The
 * fixture is written once (`UNITS_RECORD_TRAILER_IDENTITY=1`), on the code
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
  usecaseDescriptor,
  usecaseFanOutRefusalOf,
  usecaseFeeCreditId,
  type UseCaseMediaSource,
} from "@nodaro/render-rules"
import { getOutputType } from "@nodaro/shared/apps"
import {
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
import { videoOutputLength, type WireInput } from "../video-output-length.js"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "../cloud-only-nodes.js"
import { ALL_NODE_HANDLES } from "../node-handles.js"
import { NODE_HANDLES } from "../mcp/generated/node-handles.js"
import { CREDIT_COSTS, STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const FIXTURE = join(__dirname, "fixtures", "episode-trailer-identity.json")
const TYPE = "episode-trailer" as const

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
  readonly sources: { readonly media: UseCaseMediaSource; readonly introCard?: { readonly url: string; readonly durationSec?: number } }
}
interface LengthCase {
  readonly name: string
  readonly inputs: WireInput[]
}

const RECORDING: UseCaseMediaSource = { url: "https://r2/ep.mp4", kind: "video" }
/** A node's data off every default: what the credit resolver is asked besides the defaults. */
const TUNED_DATA = { formats: ["16:9"], reviewBeforeRender: true, planTier: "premium", instructions: "Open on the laugh.", styleGuide: "No ad reads." }
const MEDIA_WIRE: WireInput = { sourceId: "rec", handle: "media", kind: "video", length: { fixedSec: 0, perEpisodeSec: 1 } }

/** The inputs the fixture is recorded from. Read only when recording; compare mode rebuilds from the recorded inputs. */
function graphCases(): GraphCase[] {
  return [
    { name: "defaults", raw: {}, sources: { media: RECORDING } },
    {
      name: "all four formats, an 8 s intro card",
      raw: { formats: ["9:16", "1:1", "4:5", "16:9"] },
      sources: { media: RECORDING, introCard: { url: "https://r2/intro.mp4", durationSec: 8 } },
    },
    { name: "review on", raw: { reviewBeforeRender: true }, sources: { media: RECORDING } },
    {
      name: "plan tier, instructions and style guide set",
      raw: { planTier: "premium", instructions: "Open on the laugh.", styleGuide: "Keep the guest's punchlines; drop the ad reads." },
      sources: { media: RECORDING },
    },
  ]
}

function lengthCases(): LengthCase[] {
  return [
    { name: "no card", inputs: [MEDIA_WIRE] },
    { name: "a card of fixed 10 s", inputs: [MEDIA_WIRE, { sourceId: "card", handle: "introCard", kind: "video", length: { fixedSec: 10, perEpisodeSec: 0 } }] },
    { name: "a card per episode", inputs: [MEDIA_WIRE, { sourceId: "card", handle: "introCard", kind: "video", length: { fixedSec: 0, perEpisodeSec: 1 } }] },
    { name: "a card of unknown length", inputs: [MEDIA_WIRE, { sourceId: "card", handle: "introCard", kind: "video", length: "unknown" }] },
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
  return { name: c.name, inputs: c.inputs, length: plain(videoOutputLength({ id: "t1", type: TYPE, data: {} }, c.inputs)) }
}

function facts(graphs: readonly GraphCase[], lengths: readonly LengthCase[]) {
  const found = findNode(TYPE)
  const d = usecaseDescriptor(TYPE)
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
    }),
    graphs: graphs.map(graphRow),
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
      fanOutEachHandles: plain(FAN_OUT_EACH_HANDLES[TYPE]),
      reviewHolding: REVIEW_HOLDING_USE_CASE_TYPES.has(TYPE),
      videoProducer: VIDEO_PRODUCER_TYPES.has(TYPE),
      dynamicProducer: DYNAMIC_PRODUCER_TYPES.has(TYPE),
      declaredJsonOutput: plain(declaredJsonOutput(TYPE, "json")),
      introCardIsNonPromptLane: NON_PROMPT_TEXT_LANES.introCard === "*" || (NON_PROMPT_TEXT_LANES.introCard ?? []).includes(TYPE),
      // Whether text fanned out into each input pip feeds the prompt (an intro card or a recording never does).
      textFeedsPrompt: Object.fromEntries(usecaseDescriptor(TYPE).inputs.map((h) => [h, fanOutTextFeedsPrompt(TYPE, h)])),
      outputType: getOutputType(TYPE),
      nodaroExclusive: NODARO_EXCLUSIVE_NODE_TYPES.has(TYPE),
      fanOutRefusal: plain(usecaseFanOutRefusalOf({ type: TYPE, data: {} })),
      useCaseTypesPredecessor: predecessor(USE_CASE_NODE_TYPES, TYPE),
    },
    // The MCP handle row, read through the composer (the generated table holds it today; a unit's row comes from its manifest).
    mcpHandles: plain(ALL_NODE_HANDLES[TYPE]),
  }
}

type Facts = ReturnType<typeof facts>

describe("Trailer keeps its composed facts", () => {
  if (process.env.UNITS_RECORD_TRAILER_IDENTITY === "1") {
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
    recorded.lengths.map((l) => ({ name: l.name, inputs: l.inputs })),
  )

  it("covers every recorded case", () => {
    expect(recorded.graphs).toHaveLength(4)
    expect(recorded.lengths).toHaveLength(4)
  })
  it("the request body", () => expect(now.requestBody).toEqual(recorded.requestBody))
  it("the /v1/nodes entry, its charged description and its predecessor", () => expect(now.nodesEntry).toEqual(recorded.nodesEntry))
  it("the use-case descriptor", () => expect(now.descriptor).toEqual(recorded.descriptor))
  for (const [i, g] of recorded.graphs.entries()) {
    it(`graph ${i} (${g.name}): the same stored snapshot and hash`, () => expect(now.graphs[i]).toEqual(g))
  }
  for (const [i, l] of recorded.lengths.entries()) {
    it(`length ${i} (${l.name}): the same delivered length`, () => expect(now.lengths[i]).toEqual(l))
  }
  it("the fee and the credit id a run reserves", () => expect(now.money).toEqual(recorded.money))
  it("every list it belongs to", () => expect(now.membership).toEqual(recorded.membership))
  it("the MCP handle row", () => expect(now.mcpHandles).toEqual(recorded.mcpHandles))
  it("the composed handle row is the generated one while Trailer is hand-registered", () => {
    if (NODE_HANDLES[TYPE]) expect(plain(ALL_NODE_HANDLES[TYPE])).toEqual(plain(NODE_HANDLES[TYPE]))
  })
})
