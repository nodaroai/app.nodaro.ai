// @test-watches packages/shared/src/__tests__/fixtures/measured-input-quote-parity.json
// @test-units-by-name prices the node types its fixture names (video-sfx, video-mask, video-depth, pitch-tempo, dubbing, video-upscale, upload-video, upload-audio, generate-video, generate-video-pro, extend-video, resize-video, loop-video, text-to-speech)
/**
 * When what reaches a Video SFX, a Video Mask, a Video Depth, a Pitch & Tempo,
 * a Dubbing or a Video Upscale (Topaz, Nodaro) is made by another node — a generation,
 * an Extend Video, a step that re-runs — the server's workflow estimate quotes
 * the step at the figure the editor quotes: both read the one measured walk
 * (`measuredWireLengthSec`, @nodaro/render-rules) with the step's slack
 * (`MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC`). Read on the step's own line of the
 * estimate (its `onNode` tally) at a price table whose rows name their size —
 * a `…:<N>s` / `…:<N>m` row costs N, a Nodaro Video Upscale `…:per-4s` row 4,
 * a per-minute or per-unit row 1 — so the line IS the figure the fixture
 * names: the row's seconds, the minutes, the units, the billed seconds (0 for
 * a clip the run refuses). A whole run is the estimate with no run set (frozen nodes left out);
 * the step alone is a run of only `c`. The editor half is
 * the editor's lib tests (measured-input-quote-parity.test.ts), over the
 * same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { lipSyncAudioRateOf, lipSyncEstimateSeconds } from "@nodaro/shared/credits"
import { CreditsService, type ChargedPriceTable } from "../credits.js"

type Step = "videoSfx" | "videoMask" | "videoDepth" | "pitchTempo" | "dubbing" | "topaz" | "nodaroUpscale" | "lipSync"
/** A step's figure; `null` (Lip Sync only): a length nothing knows before the run — each estimate's own unknown figure. */
type Figures = Readonly<Partial<Record<Step, number | null>>>

interface ParityCase {
  readonly name: string
  readonly steps?: readonly Step[]
  readonly handles?: Readonly<Partial<Record<Step, string>>>
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target?: string; targetHandle: string }>
  readonly expected: { readonly whole: Figures; readonly alone: Figures }
  readonly partial?: { readonly runSet: readonly string[]; readonly expected: Figures }
}

const F = JSON.parse(
  readFileSync(join(__dirname, "../../../../../packages/shared/src/__tests__/fixtures/measured-input-quote-parity.json"), "utf8"),
) as { cases: ParityCase[] }

const STEPS: readonly Step[] = ["videoSfx", "videoMask", "videoDepth", "pitchTempo", "dubbing", "topaz", "nodaroUpscale"]

const STEP: Readonly<Record<Step, { type: string; data: Record<string, unknown>; input: string }>> = {
  videoSfx: { type: "video-sfx", data: {}, input: "video" },
  videoMask: { type: "video-mask", data: {}, input: "video" },
  videoDepth: { type: "video-depth", data: {}, input: "video" },
  pitchTempo: { type: "pitch-tempo", data: {}, input: "in" },
  dubbing: { type: "dubbing", data: { targetLanguage: "es" }, input: "video" },
  topaz: { type: "video-upscale", data: { targetResolution: "1080p" }, input: "video" },
  nodaroUpscale: { type: "video-upscale", data: { provider: "nodaro-video-upscale", targetResolution: "1080p" }, input: "video" },
  // A Lip Sync priced by the seconds of its audio (OmniHuman 2.0): named only by the cases that list it.
  lipSync: { type: "lip-sync", data: { provider: "omnihuman-2-0" }, input: "audio" },
}

/** Every row named by its size: `…:<N>s` / `…:<N>m` costs N; any other row (a per-minute or per-unit rate, an upstream node) 1, unmarked. */
const SIZED_ROWS: ChargedPriceTable = {
  base: (id) => {
    const m = /:(\d+)[sm]$/.exec(id) ?? /:per-(\d+)s$/.exec(id)
    return m ? Number(m[1]) : 1
  },
  charge: (_id, base) => base,
}

/** The step's own line of the workflow estimate, for a whole run (`runNodeIds` absent), a run of `c` alone, or the case's partial run. */
function stepLine(c: ParityCase, step: Step, run: "whole" | "alone" | "partial"): number | undefined {
  const nodes = [...c.nodes, { id: "c", type: STEP[step].type, data: STEP[step].data }]
  const handle = (h: string) => (h === "@input" ? c.handles?.[step] ?? STEP[step].input : h)
  const edges = c.edges.map((e) => ({ source: e.source, target: e.target ?? "c", targetHandle: handle(e.targetHandle) }))
  let line: number | undefined
  const runNodeIds = run === "alone" ? new Set(["c"]) : run === "partial" ? new Set(c.partial!.runSet) : undefined
  CreditsService.estimateWorkflowCreditsAt(SIZED_ROWS, nodes, edges, runNodeIds ? { runNodeIds } : undefined, (id, credits) => {
    if (id === "c") line = (line ?? 0) + credits
  })
  // A Nodaro Video Upscale of a clip past its limit is refused before anything is held: no estimate prices it.
  return step === "nodaroUpscale" ? line ?? 0 : line
}

const rows = F.cases.flatMap((c) => (c.steps ?? STEPS).map((step) => [`${c.name} — ${step}`, c, step] as const))

/** The server's figure for a fixture value: a Lip Sync of unknown length is quoted at the most a run takes (its 300 s). */
const want = (v: number | null | undefined): number | undefined => (v === null ? lipSyncEstimateSeconds(lipSyncAudioRateOf("omnihuman-2-0")!, undefined) : v)

describe("the server's workflow estimate of the measuring steps equals the editor's quote on what another node makes", () => {
  it.each(rows)("%s — a whole run", (_name, c, step) => {
    expect(stepLine(c, step, "whole")).toBe(want(c.expected.whole[step]))
  })

  it.each(rows)("%s — a run of the step alone", (_name, c, step) => {
    expect(stepLine(c, step, "alone")).toBe(want(c.expected.alone[step]))
  })

  it.each(rows.filter(([, c]) => c.partial))("%s — a partial run", (_name, c, step) => {
    expect(stepLine(c, step, "partial")).toBe(want(c.partial!.expected[step]))
  })
})
