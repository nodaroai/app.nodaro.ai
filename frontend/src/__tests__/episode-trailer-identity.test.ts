// @test-units-by-name freezes Trailer's composed facts across its unit conversion
// @test-watches frontend/src/__tests__/fixtures/episode-trailer-identity.json
/**
 * Trailer's facts as the editor composes them, frozen before Trailer becomes a
 * node unit: its definition, its add-node entry and family, its pips and the
 * wires the canvas accepts on them, the lists it belongs to, its label in
 * every locale, its canvas component and what a pick in its results gallery
 * writes. The conversion moves where these are written; it must not change one
 * of them.
 *
 * Only Trailer's own facts are recorded, plus its predecessor in each ordered
 * list (never a whole list): other nodes join those lists later, and this
 * fixture must survive that.
 *
 * The fixture is written once (`UNITS_RECORD_TRAILER_IDENTITY=1`), on the code
 * before the conversion, and a write is refused when it already exists. Never
 * re-record it after the conversion: a re-recording takes whatever the code
 * then builds as the truth.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it, expect } from "vitest"
import type { ReactElement } from "react"
import type { LocaleId } from "@nodaro/shared/i18n"
import { NODE_DEFINITIONS } from "@/types/nodes"
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

const FIXTURE = join(__dirname, "fixtures", "episode-trailer-identity.json")
const TYPE = "episode-trailer"
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

const INTO_SOURCES = [["upload-video", "video"], ["upload-audio", "audio"], ["upload-image", "image"], ["combine-videos", "video"]] as const
const TRAILER_INPUTS = ["media", "introCard"] as const
/** A list (a runtime-typed producer, its wire naming no pip) into the recording, and a text source into the intro card. */
const EXTRA_INTO = [["list", null, "media"], ["text-prompt", "prompt", "introCard"]] as const
const TRAILER_OUTPUTS = ["media", "json"] as const
/**
 * The consumers a Trailer pip is wired into: the planned pips as written, and
 * the pips Social Media Format (`media`) and Combine Videos (`in`) declare,
 * so the matrix also holds wires the canvas can really draw.
 */
const OUT_TARGETS = [
  ["social-media-format", "video"], ["json-process", "in"], ["combine-videos", "videos"],
  ["social-media-format", "media"], ["combine-videos", "in"],
] as const

/** One run that delivered two formats, the second picked. */
const TWO_FORMATS = {
  formats: ["9:16", "1:1"],
  generatedVideoUrl: "https://r2/a.mp4",
  generatedJson: { v: "plan" },
  generatedTranscript: { words: [] },
  generatedResults: [
    { url: "https://r2/a.mp4", format: "9:16", generatedJson: { v: "plan" }, generatedTranscript: { words: [] } },
    { url: "https://r2/b.mp4", format: "1:1", generatedJson: { v: "plan" }, generatedTranscript: { words: [] } },
  ],
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
    tabSupersetRows: Object.entries(TAB_SUPERSET).flatMap(([tab, fams]) =>
      Object.entries(fams).filter(([, types]) => (types as readonly string[]).includes(TYPE)).map(([fam]) => `${tab} ${fam}`),
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
      ...INTO_SOURCES.flatMap(([s, sh]) => TRAILER_INPUTS.map((h) => [`${s}.${sh} → ${TYPE}.${h}`, accepts(s, sh, TYPE, h)])),
      ...EXTRA_INTO.map(([s, sh, h]) => [`${s}.${sh ?? "-"} → ${TYPE}.${h}`, accepts(s, sh, TYPE, h)]),
    ]),
    connectionsOut: Object.fromEntries(TRAILER_OUTPUTS.flatMap((sh) => OUT_TARGETS.map(([t, h]) => [`${TYPE}.${sh} → ${t}.${h}`, accepts(TYPE, sh, t, h)]))),
    pick: {
      data: TWO_FORMATS,
      first: keepUndefined(resultsGalleryPickPatch(TYPE, TWO_FORMATS, "https://r2/a.mp4", 0)),
      second: keepUndefined(resultsGalleryPickPatch(TYPE, TWO_FORMATS, "https://r2/b.mp4", 1)),
    },
  }
}

type Facts = ReturnType<typeof facts>

describe("Trailer keeps its composed facts", () => {
  if (process.env.UNITS_RECORD_TRAILER_IDENTITY === "1") {
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

  it("the pick is recorded over the data it was made from", () => expect(now.pick.data).toEqual(recorded.pick.data))
  for (const key of Object.keys(recorded) as Array<keyof Facts>) {
    it(`${key} is unchanged`, () => expect(now[key]).toEqual(recorded[key]))
  }
})
