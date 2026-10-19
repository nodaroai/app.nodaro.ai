// @test-units-by-name freezes Clip Pack's composed facts across its unit conversion
// @test-watches frontend/src/__tests__/fixtures/clip-pack-identity.json
/**
 * Clip Pack's facts as the editor composes them, frozen before Clip Pack
 * becomes a node unit: its definition, its add-node entry and family, its pips
 * and the wires the canvas accepts on them, the lists it belongs to, its label
 * in every locale, its canvas component, what a pick in its results gallery
 * writes, what a run's shortfall lands on the node, and its audio lock (what an audio recording on its wire forces, and
 * what a video wired again gives back). The conversion moves where these are
 * written; it must not change one of them.
 *
 * Only Clip Pack's own facts are recorded, plus its predecessor in each
 * ordered list (never a whole list): other nodes join those lists later, and
 * this fixture must survive that.
 *
 * The fixture is written once (`UNITS_RECORD_CLIP_PACK_IDENTITY=1`), on the
 * code before the conversion, and a write is refused when it already exists.
 * Never re-record it after the conversion: a re-recording takes whatever the
 * code then builds as the truth.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it, expect } from "vitest"
import type { ReactElement } from "react"
import type { LocaleId } from "@nodaro/shared/i18n"
import { NODE_DEFINITIONS, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES, TAB_SUPERSET } from "@/lib/node-families"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { TARGET_HANDLE_ACCEPTS } from "@/lib/target-handle-registry"
import { EXECUTABLE_TYPES, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { JSON_PRODUCER_TYPES as SCRAPE_JSON_PRODUCER_TYPES } from "@/lib/generate-image-handles"
import { GENERATE_BUTTON_TYPES } from "@/components/editor/config-panel-node-sets"
import { getNodeTypeDisplayName } from "@/components/editor/config-panel-label"
import { nodeTypes } from "@/components/nodes"
import { localizeNodeLabel } from "@/lib/i18n/labels"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { resultsGalleryPickPatch } from "@/components/editor/config-panels/results-gallery-media"
import { usecaseFailedDeliveriesField, usecaseRunShortfall } from "@/lib/use-case-list-result"
import {
  SETTINGS_BEFORE_AUDIO,
  USE_CASE_AUDIO_LOCKS,
  usecaseAudioLockFailSafe,
  usecaseAudioLockGraph,
  usecaseAudioLockPatch,
  usecaseWiredMediaKind,
} from "@/lib/use-case-audio-lock"

const FIXTURE = join(__dirname, "fixtures", "clip-pack-identity.json")
const TYPE = "clip-pack"
/** English and the four locales with node label tables. */
const LOCALES: readonly LocaleId[] = ["en", "he", "ja", "ko", "pt-BR"]

/** The name a component is known by, React.memo / forwardRef / lazy unwrapped (as the composed-registry baseline printed it). */
function nameOf(v: unknown): string {
  if (typeof v === "function") return (v as { displayName?: string }).displayName || v.name || "(anonymous)"
  if (v && typeof v === "object") {
    const o = v as { displayName?: string; type?: unknown; render?: unknown }
    return o.displayName || nameOf(o.type) || nameOf(o.render) || "(object)"
  }
  return "(anonymous)"
}

/** A value as JSON keeps it: functions and undefined keys dropped. */
const plain = (v: unknown): unknown => (v === undefined ? "(undefined)" : JSON.parse(JSON.stringify(v)))

/** A value with every undefined kept as "(undefined)": in a patch, an undefined key clears a field. */
function keepUndefined(v: unknown): unknown {
  if (v === undefined) return "(undefined)"
  if (Array.isArray(v)) return v.map(keepUndefined)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keepUndefined(x)]))
  return v
}

/** The type listed just before `type` (null when it is first or absent). */
function predecessor(types: readonly string[], type: string): string | null {
  const i = types.indexOf(type)
  return i > 0 ? types[i - 1]! : null
}

/** Would the canvas accept a wire from `src`'s pip `srcPip` into `dst`'s pip `dstPip`? */
function accepts(src: string, srcPip: string | null, dst: string, dstPip: string): boolean {
  return isValidWorkflowConnection(
    { source: "src", target: "dst", sourceHandle: srcPip, targetHandle: dstPip },
    (id: string) => (id === "dst" ? dst : src),
  )
}

const INTO_SOURCES = [
  ["upload-video", "video"], ["upload-audio", "audio"], ["upload-image", "image"], ["combine-videos", "video"],
  // Runtime-typed producers (a use-case node's episode or delivery).
  ["tighten-episode", "media"], ["episode-trailer", "media"],
] as const
/** Clip Pack's one input pip, and a pip it does not declare. */
const CLIP_INPUTS = ["media", "introCard"] as const
/** A list (a runtime-typed producer, its wire naming no pip) and a text source into the recording. */
const EXTRA_INTO = [["list", null, "media"], ["text-prompt", "prompt", "media"]] as const
/**
 * The consumers the `clips` pip is wired into: audio-only (Trim Audio, Audio
 * FX), video and media ones. Wires from `clips` into a JSON-only input (JSON
 * Process, Apply EDL's `edl`) are deliberately not frozen: the validator
 * accepts them today only because it reads the node type, not the pip (the
 * same known bug, the reverse direction).
 */
const CLIPS_TARGETS = [
  ["trim-audio", "in"], ["audio-fx", "in"], ["combine-videos", "in"], ["add-captions", "in"],
  ["social-media-format", "media"],
] as const
/**
 * The consumers the `json` pip is wired into: only inputs that take JSON or
 * text from an ordinary JSON producer (Transcribe's `json`, Edit Plan's `edl`)
 * too. Wires from `json` into a media-only input (Trim Audio, Audio FX,
 * Combine Videos, Add Captions' `in`) are deliberately not frozen: the
 * validator accepts them today because it reads the node type, not the pip
 * (a known bug, fixed separately).
 */
const JSON_TARGETS = [
  ["social-media-format", "media"], ["json-process", "in"], ["apply-edl", "edl"], ["extract-field", "in"], ["edit-plan", "transcript"],
] as const
const OUT_WIRES = [
  ...CLIPS_TARGETS.map(([t, h]) => ["clips", t, h] as const),
  ...JSON_TARGETS.map(([t, h]) => ["json", t, h] as const),
]

/** One run that delivered two video clips, the second picked; only the first kept its plan and transcript. */
const TWO_CLIPS = {
  generatedVideoUrl: "https://r2/c0.mp4",
  generatedJson: { v: "plan" },
  generatedTranscript: { words: [] },
  generatedResults: [
    { url: "https://r2/c0.mp4", quality: "final", clipKey: "k0", title: "The pivot", thumbnailUrl: "https://r2/c0.png", generatedJson: { v: "plan" }, generatedTranscript: { words: [] } },
    { url: "https://r2/c1.mp4", quality: "final", clipKey: "k1", title: "The money", thumbnailUrl: "https://r2/c1.png", captionsFailed: true },
  ],
}
/** The same pack cut from an audio recording: two audio clips. */
const TWO_AUDIO_CLIPS = {
  generatedAudioUrl: "https://r2/c0.mp3",
  generatedJson: { v: "plan" },
  generatedResults: [
    { url: "https://r2/c0.mp3", quality: "final", clipKey: "k0", title: "The pivot", generatedJson: { v: "plan" } },
    { url: "https://r2/c1.mp3", quality: "final", clipKey: "k1", title: "The money" },
  ],
}

/** A run's output as the node reads its shortfall: delivered with failures, delivered whole, nothing delivered, and other types' counts beside its own. */
const CLIP_ROWS = [{ url: "https://r2/c0.mp4", clipKey: "k0" }, { url: "https://r2/c1.mp4", clipKey: "k1" }]
const SHORTFALL_OUTPUTS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["two clips delivered, two failed", { clips: CLIP_ROWS, failedClips: 2 }],
  ["two clips delivered, none failed", { clips: CLIP_ROWS }],
  ["no clip delivered, three failed", { clips: [], failedClips: 3 }],
  ["delivered, with captions and formats failures beside", { clips: CLIP_ROWS, failedClips: 1, failedCaptions: 1, failedFormats: ["1:1"] }],
  ["a failed count that is not a whole positive number", { clips: CLIP_ROWS, failedClips: 1.5 }],
]

const FORCED = USE_CASE_AUDIO_LOCKS[TYPE] ?? {}
const CUSTOM_FRAMING = { aspect: "16:9", layout: "side-by-side", switchType: "cut", emphasisStyle: "border" }
/** The node data the audio lock is asked about: the three wirings over each. */
const LOCK_DATA: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["custom framing and captions, no memory", { framing: CUSTOM_FRAMING, captions: true }],
  ["nothing set, no memory", {}],
  ["already forced, memory holds a custom framing", { framing: null, captions: false, [SETTINGS_BEFORE_AUDIO]: { framing: CUSTOM_FRAMING, captions: true } }],
  ["already forced, memory holds framing None", { framing: null, captions: false, [SETTINGS_BEFORE_AUDIO]: { framing: null, captions: true } }],
  ["already forced, memory never held a framing", { framing: null, captions: false, [SETTINGS_BEFORE_AUDIO]: { captions: true } }],
  ["forced values, no memory", { framing: null, captions: false }],
  // Half-forced shapes: an unset key is not its forced value, so the fail-safe still writes the pair.
  ["forced framing, captions never set", { framing: null }],
  ["forced captions, framing never set", { captions: false }],
]
const WIRINGS = ["audio", "video", undefined] as const

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
  ({ id: `${source}-${target}`, source, sourceHandle, target, targetHandle }) as WorkflowEdge

/** The clip pack's data once the store's lock holds over each write (the graph invariant, panel open or not). */
function lockGraphScenarios() {
  const clip = (data: Record<string, unknown>) => node("cp", TYPE, data)
  const audio = node("au", "upload-audio", {})
  const video = node("vi", "upload-video", {})
  const set = { framing: CUSTOM_FRAMING, captions: true, captionStyle: "bouncy" }
  const dataOf = (nodes: readonly WorkflowNode[], id: string) => keepUndefined(nodes.find((n) => n.id === id)?.data)

  // Upload Audio wired into the recording: locked, what was set remembered.
  const before = [audio, clip(set)]
  const drawn = usecaseAudioLockGraph(before, [], before, [edge("au", "audio", "cp", "media")])
  // The audio wire replaced by a video one: given back, the memory cleared.
  const swapped = usecaseAudioLockGraph(
    [...drawn, video], [edge("au", "audio", "cp", "media")],
    [...drawn, video], [edge("vi", "video", "cp", "media")],
  )
  // The audio wire removed: nothing wired, the lock stays as it is.
  const removed = usecaseAudioLockGraph(drawn, [edge("au", "audio", "cp", "media")], drawn, [])
  // Upload Audio → Tighten Episode → Clip Pack: the chain locks in one write.
  const tighten = node("te", "tighten-episode", { output: "video", captions: true })
  const chainBefore = [audio, tighten, clip(set)]
  const chainEdges = [edge("te", "media", "cp", "media")]
  const chain = usecaseAudioLockGraph(chainBefore, chainEdges, chainBefore, [...chainEdges, edge("au", "audio", "te", "media")])
  // An edit of a remembered setting while audio is wired: the memory takes it, the setting stays forced.
  const edited = usecaseAudioLockGraph(
    drawn, [edge("au", "audio", "cp", "media")],
    drawn.map((n) => (n.id === "cp" ? { ...n, data: { ...n.data, framing: { aspect: "1:1", layout: "grid" } } } as WorkflowNode : n)),
    [edge("au", "audio", "cp", "media")],
  )
  return {
    drawnAudio: dataOf(drawn, "cp"),
    swappedToVideo: dataOf(swapped, "cp"),
    audioRemoved: dataOf(removed, "cp"),
    chainTighten: dataOf(chain, "te"),
    chainClip: dataOf(chain, "cp"),
    editedWhileAudio: dataOf(edited, "cp"),
    wiredKinds: {
      audio: keepUndefined(usecaseWiredMediaKind("cp", before, [edge("au", "audio", "cp", "media")])),
      video: keepUndefined(usecaseWiredMediaKind("cp", [video, clip({})], [edge("vi", "video", "cp", "media")])),
      tightenAudio: keepUndefined(usecaseWiredMediaKind("cp", chain, [...chainEdges, edge("au", "audio", "te", "media")])),
      none: keepUndefined(usecaseWiredMediaKind("cp", before, [])),
    },
  }
}

function facts() {
  const definitions = NODE_DEFINITIONS.map((d) => d.type as string)
  const options = NODE_OPTIONS.map((o) => o.type as string)
  const option = NODE_OPTIONS.find((o) => o.type === TYPE)
  const family = NODE_FAMILIES.find((f) => (f.types as readonly string[]).includes(TYPE))
  const label = NODE_DEFINITIONS.find((d) => d.type === TYPE)?.label ?? "(no definition)"
  return {
    definition: plain(NODE_DEFINITIONS.find((d) => d.type === TYPE)),
    definitionPredecessor: predecessor(definitions, TYPE),
    option: option ? plain({ ...option, icon: nameOf((option.icon as ReactElement | undefined)?.type) }) : "(no option)",
    optionPredecessor: predecessor(options, TYPE),
    family: family ? { id: family.id, label: family.label, tab: family.tab, predecessor: predecessor(family.types, TYPE) } : "(no family)",
    // Each TAB_SUPERSET row that shows Clip Pack, with its predecessor inside that row.
    tabSupersetRows: Object.entries(TAB_SUPERSET).flatMap(([tab, fams]) =>
      Object.entries(fams)
        .filter(([, types]) => (types as readonly string[]).includes(TYPE))
        .map(([fam, types]) => ({ row: `${tab} ${fam}`, predecessor: predecessor(types as readonly string[], TYPE) })),
    ),
    handleOutputTypes: plain(HANDLE_OUTPUT_TYPES[TYPE]),
    // The predicates are closures; what they accept is frozen by the connection matrix below.
    targetHandles: (TARGET_HANDLE_ACCEPTS[TYPE] ?? []).map((e) => plain({ handleId: e.handleId, label: e.label })),
    executable: EXECUTABLE_TYPES.has(TYPE),
    feeCredits: plain(NODE_CREDIT_COSTS[`use-case-fee:${TYPE}`]),
    nodaroExclusive: NODARO_EXCLUSIVE_NODE_TYPES.has(TYPE),
    jsonProducer: JSON_PRODUCER_TYPES.has(TYPE),
    scrapeJsonProducer: SCRAPE_JSON_PRODUCER_TYPES.has(TYPE),
    generateButton: GENERATE_BUTTON_TYPES.has(TYPE),
    configPanelLabel: getNodeTypeDisplayName(TYPE),
    canvasComponent: `ƒ ${nameOf((nodeTypes as Record<string, unknown>)[TYPE])}`,
    localizedLabel: Object.fromEntries(LOCALES.map((l) => [l, localizeNodeLabel(label, l)])),
    connectionsIn: Object.fromEntries([
      ...INTO_SOURCES.flatMap(([s, sh]) => CLIP_INPUTS.map((h) => [`${s}.${sh} → ${TYPE}.${h}`, accepts(s, sh, TYPE, h)])),
      ...EXTRA_INTO.map(([s, sh, h]) => [`${s}.${sh ?? "-"} → ${TYPE}.${h}`, accepts(s, sh, TYPE, h)]),
    ]),
    connectionsOut: Object.fromEntries(OUT_WIRES.map(([sh, t, h]) => [`${TYPE}.${sh} → ${t}.${h}`, accepts(TYPE, sh, t, h)])),
    pick: {
      data: TWO_CLIPS,
      first: keepUndefined(resultsGalleryPickPatch(TYPE, TWO_CLIPS, "https://r2/c0.mp4", 0)),
      second: keepUndefined(resultsGalleryPickPatch(TYPE, TWO_CLIPS, "https://r2/c1.mp4", 1)),
    },
    pickAudio: {
      data: TWO_AUDIO_CLIPS,
      first: keepUndefined(resultsGalleryPickPatch(TYPE, TWO_AUDIO_CLIPS, "https://r2/c0.mp3", 0)),
      second: keepUndefined(resultsGalleryPickPatch(TYPE, TWO_AUDIO_CLIPS, "https://r2/c1.mp3", 1)),
    },
    // The node fields a run's shortfall lands on (the type's own only; cleared on a run that delivered nothing).
    shortfall: SHORTFALL_OUTPUTS.map(([name, output]) => ({
      name,
      output,
      onNode: keepUndefined(usecaseFailedDeliveriesField(TYPE, output)),
      asReported: keepUndefined(usecaseRunShortfall(output)),
    })),
    audioLock: {
      forced: keepUndefined(USE_CASE_AUDIO_LOCKS[TYPE]),
      patch: LOCK_DATA.map(([name, data]) => ({
        name,
        data: keepUndefined(data),
        byWiring: Object.fromEntries(WIRINGS.map((w) => [w ?? "(nothing wired)", keepUndefined(usecaseAudioLockPatch(w, data, FORCED))])),
      })),
      failSafe: LOCK_DATA.map(([name, data]) => ({
        name,
        byWiring: Object.fromEntries(WIRINGS.map((w) => [w ?? "(nothing wired)", keepUndefined(usecaseAudioLockFailSafe(w, data, FORCED))])),
      })),
      graph: lockGraphScenarios(),
    },
  }
}

type Facts = ReturnType<typeof facts>

describe("Clip Pack keeps its composed facts", () => {
  if (process.env.UNITS_RECORD_CLIP_PACK_IDENTITY === "1") {
    it("records the fixture", () => {
      if (existsSync(FIXTURE)) throw new Error(`${FIXTURE} already exists: it is recorded once, before the conversion, and never re-recorded`)
      mkdirSync(dirname(FIXTURE), { recursive: true })
      writeFileSync(FIXTURE, JSON.stringify(facts(), null, 2) + "\n")
      expect(existsSync(FIXTURE)).toBe(true)
    })
    return
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Facts
  const now = facts()

  it("the picks are recorded over the data they were made from", () => {
    expect(now.pick.data).toEqual(recorded.pick.data)
    expect(now.pickAudio.data).toEqual(recorded.pickAudio.data)
  })
  for (const key of Object.keys(recorded) as Array<keyof Facts>) {
    it(`${key} is unchanged`, () => expect(now[key]).toEqual(recorded[key]))
  }
})
