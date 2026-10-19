// @test-units-by-name freezes the one-recording facts of the four use-case types it names, before multicam
// @test-watches backend/src/lib/__tests__/fixtures/use-case-single-recording-identity.json
/**
 * What a use-case node does with ONE recording, frozen before the multicam
 * work: a run started before a later change deploys is continued and
 * Render-finalled after it, and a continuation's identity is its stored hash.
 * This pins what the older identity fixtures leave open (Tighten Episode's
 * graph, Trailer's and Clip Pack's composed facts and Tighten's run bodies stay
 * pinned where they are):
 *  - graphs: Chapters, Trailer and Clip Pack built from one recording, its
 *    probed length known or not, an intro card wired with or without a length
 *    — each row's hash, outputMap, first-run subset and resolved settings, plus
 *    one whole stored snapshot per type;
 *  - bodies: what the engine sends each type's route (`freshRunInputs`), key
 *    order included. The editor's twin
 *    (`frontend/src/__tests__/use-case-single-recording-body.test.ts`) sends the
 *    same rows' inputs through the canvas's own run;
 *  - expansions: the chain every estimator prices each of the four types by,
 *    wired to one recording and to each optional input, review on, the whole
 *    chain and a Render final;
 *  - bodySchemas: Tighten's and Chapters' route bodies as JSON Schema (Trailer's
 *    and Clip Pack's are in their own identity fixtures).
 *
 * The server's preparation (`prepareUseCase`, the route's keyless preflight)
 * is held to the graph rows by `use-case-single-recording-prepare.test.ts`.
 *
 * The four types are named here, never read from the live type list: a type
 * added later records its own facts. Each row holds its own inputs and compare
 * mode rebuilds every row from those, so the fixture does not lean on today's
 * defaults. The fixture is recorded section by section
 * (`RECORD_SINGLE_RECORDING_IDENTITY=1`): a write records only the sections
 * it does not hold yet, keeps every recorded one as it is, and is refused when
 * every section is recorded. Never re-record a section: a re-recording takes
 * whatever the code then builds as the truth.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  USE_CASE_NODE_TYPES,
  expandUseCaseNodes,
  initialRunNodeIds,
  isStoredInlineGraph,
  toStoredInlineGraph,
  usecaseDescriptor,
  type UseCaseExpandOptions,
  type UseCaseMediaKind,
  type UseCaseNodeType,
  type UseCaseSources,
} from "@nodaro/render-rules"
import { USE_CASE_BODIES } from "../use-case/bodies.js"
import { freshRunInputs } from "../../services/workflow-engine/use-case-request.js"
import type { ResolvedInputs, SimpleNode } from "../../services/workflow-engine/types.js"

const FIXTURE = join(__dirname, "fixtures", "use-case-single-recording-identity.json")
const RECORD = process.env.RECORD_SINGLE_RECORDING_IDENTITY === "1"

/** The four use-case types this fixture freezes, named (never the live list). */
const TYPES = ["tighten-episode", "episode-chapters", "episode-trailer", "clip-pack"] as const satisfies readonly UseCaseNodeType[]
type FrozenType = (typeof TYPES)[number]
/** Tighten Episode's graphs are its own fixture's (tighten-episode-identity.json). */
const GRAPH_TYPES = ["episode-chapters", "episode-trailer", "clip-pack"] as const satisfies readonly FrozenType[]
type GraphType = (typeof GRAPH_TYPES)[number]
/** Rows per graph type: Chapters 2 kinds × 2 variants × 2 lengths; Trailer video × 4 variants × 2 lengths × (no card, a card without and with a length); Clip Pack 2 kinds × 5 variants × 2 lengths. */
const GRAPH_ROWS: Readonly<Record<GraphType, number>> = { "episode-chapters": 8, "episode-trailer": 24, "clip-pack": 20 }

/** A value as JSON keeps it: functions and undefined keys dropped. */
const plain = <T>(v: T): unknown => (v === undefined ? "(undefined)" : JSON.parse(JSON.stringify(v)))

// ---------------------------------------------------------------------------
// Graphs
// ---------------------------------------------------------------------------

interface GraphCase {
  readonly type: GraphType
  readonly kind: UseCaseMediaKind
  readonly raw: Record<string, unknown>
  /** The recording's probed length (null: unknown). */
  readonly durationSec: number | null
  /** The optional inputs wired, each a fixed URL. */
  readonly optional: readonly ("music" | "introCard")[]
  /** The intro card's probed length, when one is wired (null: unknown). */
  readonly introCardSec: number | null
}
interface GraphRow extends GraphCase {
  readonly hash: string
  readonly outputMap: unknown
  readonly firstRun: string[] | null
  readonly settings: unknown
  /** The whole stored snapshot, on each type's first row. */
  readonly stored?: unknown
}

interface GraphPlan {
  readonly kinds: readonly UseCaseMediaKind[]
  readonly optional: ReadonlyArray<readonly ("music" | "introCard")[]>
  /** Settings worth varying: the defaults, then values off every default the resolver reads. */
  readonly variants: ReadonlyArray<Record<string, unknown>>
}

/** Read only when recording; compare mode rebuilds from the recorded inputs. */
const GRAPH_PLANS: Readonly<Record<GraphType, GraphPlan>> = {
  "episode-chapters": {
    kinds: ["video", "audio"],
    optional: [[]],
    variants: [{}, { planTier: "premium", instructions: "Chapters per guest.", styleGuide: "Short titles." }],
  },
  "episode-trailer": {
    // An audio-only recording is refused before anything is built.
    kinds: ["video"],
    optional: [[], ["introCard"]],
    variants: [
      {},
      { formats: ["9:16"] },
      { formats: ["16:9", "1:1"], reviewBeforeRender: true },
      { formats: ["9:16", "1:1", "4:5", "16:9"], planTier: "premium", instructions: "Lead with the guest's best line.", styleGuide: "No spoilers." },
    ],
  },
  "clip-pack": {
    kinds: ["video", "audio"],
    optional: [[]],
    variants: [
      {},
      { count: 3, targetDurationSec: 30 },
      { framing: null, captions: false },
      { framing: { aspect: "1:1", layout: "single", switchType: "cut", emphasisStyle: "none" }, captions: true, captionStyle: "word-highlight", reviewBeforeRender: true },
      { count: 12, targetDurationSec: 90, planTier: "premium", instructions: "Funny moments only.", styleGuide: "Hook first." },
    ],
  },
}

const URLS = { music: "https://r2/bed.mp3", introCard: "https://r2/card.mp4" } as const

function graphCases(): GraphCase[] {
  const out: GraphCase[] = []
  for (const type of GRAPH_TYPES) {
    const plan = GRAPH_PLANS[type]
    for (const kind of plan.kinds)
      for (const raw of plan.variants)
        for (const durationSec of [null, 3600])
          for (const optional of plan.optional)
            for (const introCardSec of optional.includes("introCard") ? [null, 6] : [null])
              out.push({ type, kind, raw, durationSec, optional, introCardSec })
  }
  return out
}

function buildGraph(c: GraphCase) {
  const d = usecaseDescriptor(c.type)
  const settings = d.resolveSettings(c.raw, c.kind)
  const sources: UseCaseSources = {
    media: { url: `https://r2/ep.${c.kind === "audio" ? "m4a" : "mp4"}`, kind: c.kind, ...(c.durationSec !== null ? { durationSec: c.durationSec } : {}) },
    ...(c.optional.includes("music") ? { music: { url: URLS.music } } : {}),
    ...(c.optional.includes("introCard")
      ? { introCard: { url: URLS.introCard, ...(c.introCardSec !== null ? { durationSec: c.introCardSec } : {}) } }
      : {}),
  }
  const graph = d.build(settings, sources)
  return { graph, settings, stored: toStoredInlineGraph(graph, settings) }
}

function graphRow(c: GraphCase, withStored: boolean): GraphRow {
  const { graph, settings, stored } = buildGraph(c)
  return {
    ...c,
    hash: stored.hash,
    outputMap: plain(graph.outputMap),
    firstRun: initialRunNodeIds(graph),
    settings: plain(settings),
    ...(withStored ? { stored: plain(stored) } : {}),
  }
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

interface BodyCase {
  readonly name: string
  readonly type: FrozenType
  /** The node's data (its label and field mappings are added). */
  readonly data: Record<string, unknown>
  /** What the resolver hands the node: its recordings and optional inputs. */
  readonly inputs: { readonly useCaseMedia: ReadonlyArray<{ nodeId: string; url: string }>; readonly useCaseMusic?: string; readonly useCaseIntroCard?: string }
}
interface BodyRow extends BodyCase {
  /** `JSON.stringify(freshRunInputs(...))`: the engine's body before the lane, key order included. */
  readonly engine: string
}

const REC = [{ nodeId: "rec", url: "https://r2/ep.mp4" }]
const TWO_RECS = [...REC, { nodeId: "rec2", url: "https://r2/ep-cam2.mp4" }]
/** Every optional input any type takes, wired: a type that does not take one never sends it. */
const ALL_OPTIONAL = { useCaseMusic: URLS.music, useCaseIntroCard: URLS.introCard }

/** Each type's default data (its unit's), without label and field mappings. */
const DEFAULT_DATA: Readonly<Record<FrozenType, Record<string, unknown>>> = {
  "tighten-episode": { output: "video", captions: true, captionStyle: "word-highlight", reviewBeforeRender: false, planTier: "standard", instructions: "" },
  "episode-chapters": { planTier: "economy", instructions: "", styleGuide: "" },
  "episode-trailer": { formats: ["9:16", "1:1", "4:5"], reviewBeforeRender: false, planTier: "standard", instructions: "" },
  "clip-pack": {
    count: 8, targetDurationSec: 60, framing: { aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale" },
    captions: true, captionStyle: "karaoke", reviewBeforeRender: false, planTier: "standard", instructions: "",
  },
}

/** Every setting off its default. */
const TUNED_DATA: Readonly<Record<FrozenType, Record<string, unknown>>> = {
  "tighten-episode": {
    output: "video", framing: { aspect: "9:16", layout: "stacked" }, captions: false, captionStyle: "karaoke", reviewBeforeRender: true,
    planTier: "premium", instructions: "Cut the cross-talk.", styleGuide: "Tight.", musicDuckAmount: 40,
  },
  "episode-chapters": { planTier: "premium", instructions: "Chapters per guest.", styleGuide: "Short titles." },
  "episode-trailer": {
    formats: ["16:9", "9:16"], reviewBeforeRender: true, planTier: "premium", instructions: "Lead with the guest's best line.", styleGuide: "No spoilers.",
  },
  "clip-pack": {
    count: 12, targetDurationSec: 90, framing: { aspect: "1:1", layout: "single", switchType: "cut", emphasisStyle: "none" },
    captions: true, captionStyle: "word-highlight", reviewBeforeRender: true, planTier: "premium", instructions: "Funny moments only.", styleGuide: "Hook first.",
  },
}

/** Read only when recording; compare mode rebuilds from the recorded inputs. */
function bodyCases(): BodyCase[] {
  const out: BodyCase[] = []
  for (const type of TYPES) {
    out.push(
      { name: `${type}: the defaults`, type, data: DEFAULT_DATA[type], inputs: { useCaseMedia: REC } },
      { name: `${type}: every setting tuned`, type, data: TUNED_DATA[type], inputs: { useCaseMedia: REC } },
      { name: `${type}: nothing set`, type, data: {}, inputs: { useCaseMedia: REC } },
      // The engine sends an empty instruction; the editor leaves it out.
      { name: `${type}: an empty instruction and style guide`, type, data: { instructions: "", styleGuide: "" }, inputs: { useCaseMedia: REC } },
      // A null on a setting whose body takes no null is left out.
      { name: `${type}: null instructions and review`, type, data: { instructions: null, reviewBeforeRender: null }, inputs: { useCaseMedia: REC } },
      // Only the first recording is sent; only the optional inputs the type takes are.
      { name: `${type}: two recordings and every optional input wired`, type, data: TUNED_DATA[type], inputs: { useCaseMedia: TWO_RECS, ...ALL_OPTIONAL } },
    )
  }
  out.push(
    { name: "tighten-episode: a music bed", type: "tighten-episode", data: DEFAULT_DATA["tighten-episode"], inputs: { useCaseMedia: REC, useCaseMusic: URLS.music } },
    { name: "tighten-episode: framing None", type: "tighten-episode", data: { ...DEFAULT_DATA["tighten-episode"], framing: null }, inputs: { useCaseMedia: REC } },
    { name: "episode-trailer: an intro card", type: "episode-trailer", data: DEFAULT_DATA["episode-trailer"], inputs: { useCaseMedia: REC, useCaseIntroCard: URLS.introCard } },
    { name: "clip-pack: framing None", type: "clip-pack", data: { ...DEFAULT_DATA["clip-pack"], framing: null }, inputs: { useCaseMedia: REC } },
    { name: "clip-pack: framing None and captions null", type: "clip-pack", data: { ...DEFAULT_DATA["clip-pack"], framing: null, captions: null }, inputs: { useCaseMedia: REC } },
  )
  return out
}

function engineBody(c: BodyCase): string {
  const node = { id: "u1", type: c.type, data: { label: usecaseDescriptor(c.type).label, fieldMappings: {}, ...c.data } } as unknown as SimpleNode
  return JSON.stringify(freshRunInputs(node, c.inputs as unknown as ResolvedInputs))
}

// ---------------------------------------------------------------------------
// Expansions
// ---------------------------------------------------------------------------

interface ExpandNode { readonly id: string; readonly type: string; readonly data: Record<string, unknown> }
interface ExpandEdge { readonly source: string; readonly target: string; readonly sourceHandle: string | null; readonly targetHandle: string | null; readonly data?: unknown }
interface ExpansionCase {
  readonly name: string
  readonly type: FrozenType
  readonly nodes: readonly ExpandNode[]
  readonly edges: readonly ExpandEdge[]
  readonly options?: UseCaseExpandOptions
}
interface ExpansionRow extends ExpansionCase {
  readonly expansion: unknown
}

const REC_VIDEO: ExpandNode = { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4", metadata: { durationSeconds: 3600 } } }
const REC_VIDEO_2: ExpandNode = { id: "rec2", type: "upload-video", data: { url: "https://r2/ep-cam2.mp4", metadata: { durationSeconds: 3600 } } }
const REC_AUDIO: ExpandNode = { id: "rec", type: "upload-audio", data: { url: "https://r2/ep.m4a", metadata: { durationSeconds: 1800 } } }
const BED: ExpandNode = { id: "bed", type: "upload-audio", data: { url: URLS.music } }
const CARD: ExpandNode = { id: "card", type: "upload-video", data: { url: URLS.introCard, metadata: { durationSeconds: 6 } } }
const MEDIA_CONSUMER: ExpandNode = { id: "post", type: "social-media-format", data: {} }
const JSON_CONSUMER: ExpandNode = { id: "jp", type: "json-process", data: {} }

/** Each type's own output pips: its media (or text, or clips) and its plan. */
const OUTPUTS: Readonly<Record<FrozenType, readonly [string, string]>> = {
  "tighten-episode": ["media", "json"],
  "episode-chapters": ["text", "json"],
  "episode-trailer": ["media", "json"],
  "clip-pack": ["clips", "json"],
}
/** The optional inputs each type takes, and the node wired into each. */
const OPTIONAL_WIRES: Readonly<Record<FrozenType, ReadonlyArray<{ handle: string; node: ExpandNode; sourceHandle: string }>>> = {
  "tighten-episode": [{ handle: "music", node: BED, sourceHandle: "audio" }],
  "episode-chapters": [],
  "episode-trailer": [{ handle: "introCard", node: CARD, sourceHandle: "video" }],
  "clip-pack": [],
}
const TAKES_AUDIO: ReadonlySet<FrozenType> = new Set(["tighten-episode", "episode-chapters", "clip-pack"])
const REVIEWABLE: ReadonlySet<FrozenType> = new Set(["tighten-episode", "episode-trailer", "clip-pack"])

const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): ExpandEdge => ({ source, sourceHandle, target, targetHandle })

/** Read only when recording; compare mode rebuilds from the recorded inputs. */
function expansionCases(): ExpansionCase[] {
  const out: ExpansionCase[] = []
  for (const type of TYPES) {
    const node = (data: Record<string, unknown>): ExpandNode => ({ id: "u1", type, data: { label: usecaseDescriptor(type).label, ...data } })
    const media = wire("rec", "video", "u1", "media")
    const consumers = [MEDIA_CONSUMER, JSON_CONSUMER]
    const out1 = wire("u1", OUTPUTS[type][0], "post", "in")
    const out2 = wire("u1", OUTPUTS[type][1], "jp", "in")
    const optional = OPTIONAL_WIRES[type]
    const everyInput = { nodes: optional.map((o) => o.node), edges: optional.map((o) => wire(o.node.id, o.sourceHandle, "u1", o.handle)) }
    out.push(
      { name: `${type}: unwired`, type, nodes: [node(DEFAULT_DATA[type])], edges: [] },
      { name: `${type}: one video recording`, type, nodes: [REC_VIDEO, node(DEFAULT_DATA[type])], edges: [media] },
      {
        name: `${type}: one video recording, every optional input, consumers on both outputs`,
        type,
        nodes: [REC_VIDEO, ...everyInput.nodes, node(DEFAULT_DATA[type]), ...consumers],
        edges: [media, ...everyInput.edges, out1, out2],
      },
      {
        name: `${type}: tuned settings, every optional input, consumers`,
        type,
        nodes: [REC_VIDEO, ...everyInput.nodes, node(TUNED_DATA[type]), ...consumers],
        edges: [media, ...everyInput.edges, out1, out2],
      },
      {
        name: `${type}: two recordings wired into media`,
        type,
        nodes: [REC_VIDEO, REC_VIDEO_2, node(DEFAULT_DATA[type]), ...consumers],
        edges: [media, wire("rec2", "video", "u1", "media"), out1, out2],
      },
      {
        name: `${type}: a wire with its own output mode, out to a consumer`,
        type,
        nodes: [REC_VIDEO, node(DEFAULT_DATA[type]), ...consumers],
        edges: [{ ...media, data: { outputMode: "all" } }, { ...out1, data: { outputMode: "each" } }, out2],
      },
    )
    if (TAKES_AUDIO.has(type)) {
      out.push({
        name: `${type}: one audio recording, consumers`,
        type,
        nodes: [REC_AUDIO, ...everyInput.nodes, node(DEFAULT_DATA[type]), ...consumers],
        edges: [wire("rec", "audio", "u1", "media"), ...everyInput.edges, out1, out2],
      })
    }
    if (REVIEWABLE.has(type)) {
      const review = node({ ...DEFAULT_DATA[type], reviewBeforeRender: true })
      const graph = { nodes: [REC_VIDEO, ...everyInput.nodes, review, ...consumers], edges: [media, ...everyInput.edges, out1, out2] }
      out.push(
        { name: `${type}: review on, first run`, type, ...graph },
        { name: `${type}: review on, the whole chain`, type, ...graph, options: { chain: "whole" } },
        {
          name: `${type}: a Render final, with its run's settings, plan and edit`,
          type,
          nodes: [
            REC_VIDEO, ...everyInput.nodes,
            node({
              ...TUNED_DATA[type],
              reviewBeforeRender: true,
              useCaseContinue: { mode: "render-final", jobId: "job-1", settings: { ...DEFAULT_DATA[type], reviewBeforeRender: true } },
              generatedJson: { segments: [{ start: 0, end: 10 }] },
              editedEdl: { segments: [{ start: 1, end: 9 }] },
            }),
            ...consumers,
          ],
          edges: [media, ...everyInput.edges, out1, out2],
        },
      )
    }
  }
  return out
}

function expansionOf(c: ExpansionCase): unknown {
  const x = expandUseCaseNodes(c.nodes, c.edges, c.options)
  // `members` is a Map: JSON would keep nothing of it.
  return plain({ nodes: x.nodes, edges: x.edges, fees: x.fees, members: Object.fromEntries(x.members), expanded: x.expanded })
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

/** The route bodies no other identity fixture pins (Trailer's and Clip Pack's are in theirs). */
const BODY_SCHEMA_TYPES = ["tighten-episode", "episode-chapters"] as const satisfies readonly FrozenType[]

const bodySchemaOf = (type: FrozenType): unknown => plain(z.toJSONSchema(USE_CASE_BODIES[type]))

// ---------------------------------------------------------------------------

interface Fixture {
  readonly graphs: readonly GraphRow[]
  readonly bodies: readonly BodyRow[]
  readonly expansions: readonly ExpansionRow[]
  readonly bodySchemas: Readonly<Record<string, unknown>>
}

/** Each section, recorded from the cases above. Only a section the fixture does not hold yet is ever asked. */
const SECTIONS: { readonly [K in keyof Fixture]: () => Fixture[K] } = {
  graphs: () => {
    const seen = new Set<string>()
    return graphCases().map((c) => {
      const first = !seen.has(c.type)
      seen.add(c.type)
      return graphRow(c, first)
    })
  },
  bodies: () => bodyCases().map((c) => ({ ...c, engine: engineBody(c) })),
  expansions: () => expansionCases().map((c) => ({ ...c, expansion: expansionOf(c) })),
  bodySchemas: () => Object.fromEntries(BODY_SCHEMA_TYPES.map((t) => [t, bodySchemaOf(t)])),
}

/** The fixture with its missing sections recorded; every recorded section kept as it is. Refused when none is missing. */
function recordMissing(): Fixture {
  const held = (existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {}) as Partial<Fixture>
  const missing = (Object.keys(SECTIONS) as Array<keyof Fixture>).filter((k) => held[k] === undefined)
  if (missing.length === 0) throw new Error(`${FIXTURE} already holds every section: each is recorded once, before the multicam work, and never re-recorded`)
  return { ...held, ...Object.fromEntries(missing.map((k) => [k, SECTIONS[k]()])) } as Fixture
}

const sameSet = (a: Iterable<string>, b: Iterable<string>) => expect([...new Set(a)].sort()).toEqual([...new Set(b)].sort())

describe("the use-case types keep their one-recording facts", () => {
  if (RECORD) {
    it("each tuned variant reads as something other than the defaults (a variant that resolves to them is a wasted row)", () => {
      for (const type of GRAPH_TYPES) {
        const d = usecaseDescriptor(type)
        for (const kind of GRAPH_PLANS[type].kinds) {
          const defaults = plain(d.resolveSettings({}, kind))
          for (const raw of GRAPH_PLANS[type].variants.slice(1)) {
            // An audio recording forces some settings (no framing, no captions): only the video read has to differ.
            if (kind === "video") expect(plain(d.resolveSettings(raw, kind)), `${type} ${JSON.stringify(raw)}`).not.toEqual(defaults)
          }
        }
        for (const raw of GRAPH_PLANS[type].variants) {
          for (const [k, v] of Object.entries(raw)) {
            // A value the resolver kept as given (never snapped or dropped), so the row varies what it says it does.
            // A list is kept as a set (Trailer's formats are delivered in a fixed order).
            const got = (d.resolveSettings(raw, "video") as Record<string, unknown>)[k]
            const asSet = (x: unknown) => (Array.isArray(x) ? [...x].sort() : x)
            if (v !== null) expect(plain(asSet(got)), `${type}.${k}`).toEqual(plain(asSet(v)))
          }
        }
      }
    })
    it("records the sections the fixture does not hold yet", () => {
      writeFileSync(FIXTURE, JSON.stringify(recordMissing(), null, 2) + "\n")
      expect(existsSync(FIXTURE)).toBe(true)
    })
    return
  }

  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture

  it("names only use-case types that exist, and covers each section's types", () => {
    for (const t of TYPES) expect(USE_CASE_NODE_TYPES as readonly string[]).toContain(t)
    sameSet(recorded.graphs.map((r) => r.type), GRAPH_TYPES)
    sameSet(recorded.bodies.map((r) => r.type), TYPES)
    sameSet(recorded.expansions.map((r) => r.type), TYPES)
    sameSet(Object.keys(recorded.bodySchemas), BODY_SCHEMA_TYPES)
    for (const t of GRAPH_TYPES) expect(recorded.graphs.filter((r) => r.type === t), t).toHaveLength(GRAPH_ROWS[t])
    for (const t of GRAPH_TYPES) expect(recorded.graphs.filter((r) => r.type === t && r.stored !== undefined), t).toHaveLength(1)
  })

  for (const [i, r] of recorded.graphs.entries()) {
    const { hash: _h, outputMap: _o, firstRun: _f, settings: _s, stored, ...c } = r
    it(`graph ${i} (${r.type}, ${r.kind}, ${r.durationSec ?? "no"} s${r.optional.length ? `, ${r.optional.join("+")} ${r.introCardSec ?? "no"} s` : ""}): same hash, outputMap, first run and settings`, () => {
      expect(graphRow(c, stored !== undefined)).toEqual(r)
    })
  }
  it("a stored snapshot recorded here still validates", () => {
    for (const r of recorded.graphs) if (r.stored !== undefined) expect(isStoredInlineGraph(r.stored), r.type).toBe(true)
  })

  for (const r of recorded.bodies) {
    it(`body (${r.name}): the engine sends the same bytes`, () => expect(engineBody(r)).toBe(r.engine))
  }

  for (const r of recorded.expansions) {
    it(`expansion (${r.name}): the same chain, fees and members`, () => expect(expansionOf(r)).toEqual(r.expansion))
  }

  for (const t of BODY_SCHEMA_TYPES) {
    it(`body schema (${t}): the route takes the same body`, () => expect(bodySchemaOf(t)).toEqual(recorded.bodySchemas[t]))
  }
})
