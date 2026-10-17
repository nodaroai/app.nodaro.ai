// @test-watches backend/src/lib/__tests__/fixtures/tighten-episode-identity.json
/**
 * Tighten Episode is built, hashed and stored exactly as P1 shipped it. The
 * fixture was recorded on the code P1 merged (before the use-case registry):
 * a run that P1 code started — its wrapper, its stored snapshot — must still be
 * continued and Render-finalled after the registry lands, and the run identity
 * of a continuation is the stored hash.
 *
 * Each row holds its own inputs (the raw settings, the recording's kind, the
 * music, the probed length); compare mode rebuilds every row from those, so
 * the fixture does not lean on today's defaults. Never re-record it after the
 * refactor: a re-recording would take whatever the code then builds as truth.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import {
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  TIGHTEN_EPISODE_DEFAULTS,
  buildTightenEpisodeGraph,
  initialRunNodeIds,
  isStoredInlineGraph,
  resolveTightenEpisodeSettings,
  toStoredInlineGraph,
} from "@nodaro/render-rules"

const FIXTURE = join(__dirname, "fixtures", "tighten-episode-identity.json")

interface Case {
  readonly kind: "video" | "audio"
  readonly raw: Record<string, unknown>
  readonly music: boolean
  readonly durationSec: number | null
}
interface Row extends Case {
  readonly hash: string
  readonly outputMap: unknown
  readonly firstRun: string[] | null
  readonly stored?: unknown
}

/** Every setting off its default: the plan's style guide, instructions and tier, the captions' style, the mix's ducking. */
const TUNED = {
  captionStyle: "karaoke",
  planTier: "premium",
  instructions: "Cut the cross-talk.",
  styleGuide: "Keep the host's jokes; drop the ad reads.",
  musicDuckAmount: 40,
}

/** The inputs the fixture is recorded from. Read only when recording; compare mode rebuilds from the recorded inputs. */
function cases(): Case[] {
  const out: Case[] = []
  for (const kind of ["video", "audio"] as const)
    for (const output of ["video", "audio"] as const)
      for (const captions of [true, false])
        for (const reviewBeforeRender of [true, false])
          for (const music of [false, true])
            for (const framing of [null, { aspect: "9:16", layout: "stacked" }] as const)
              for (const tuned of [false, true]) {
                // A tuned row also carries a probed length; a plain one leaves it unknown.
                out.push({
                  kind,
                  raw: { ...TIGHTEN_EPISODE_DEFAULTS, output, captions, reviewBeforeRender, framing, ...(tuned ? TUNED : {}) },
                  music,
                  durationSec: tuned ? 3600 : null,
                })
              }
  // Every framing the panel can send, including the layouts Speaker View snaps at an aspect.
  for (const aspect of EDL_TARGET_ASPECTS)
    for (const layout of SPEAKER_VIEW_LAYOUT_SETTINGS)
      out.push({
        kind: "video",
        raw: { ...TIGHTEN_EPISODE_DEFAULTS, output: "video", captions: true, reviewBeforeRender: true, framing: { aspect, layout } },
        music: true,
        durationSec: null,
      })
  return out
}

function rowOf(c: Case, withStored: boolean): Row {
  const settings = resolveTightenEpisodeSettings(c.raw, c.kind)
  const graph = buildTightenEpisodeGraph(settings, {
    media: { url: `https://r2/ep.${c.kind === "audio" ? "m4a" : "mp4"}`, kind: c.kind, ...(c.durationSec ? { durationSec: c.durationSec } : {}) },
    ...(c.music ? { music: { url: "https://r2/bed.mp3" } } : {}),
  })
  const stored = toStoredInlineGraph(graph, settings)
  return {
    kind: c.kind, raw: c.raw, music: c.music, durationSec: c.durationSec,
    hash: stored.hash, outputMap: graph.outputMap, firstRun: initialRunNodeIds(graph),
    ...(withStored ? { stored } : {}),
  }
}

describe("Tighten Episode keeps its P1 identity", () => {
  if (process.env.WRITE_TIGHTEN_IDENTITY === "1") {
    it("records the fixture", () => {
      const rows = cases().map((c, i) => rowOf(c, i === 0))
      writeFileSync(FIXTURE, JSON.stringify(rows, null, 2) + "\n")
      expect(existsSync(FIXTURE)).toBe(true)
    })
    return
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Row[]

  it("covers every branch a user can reach", () => {
    expect(recorded.length).toBe(152)
    const framings = new Set(recorded.filter((r) => r.raw.framing).map((r) => JSON.stringify(r.raw.framing)))
    expect(framings.size).toBe(24)
    expect(recorded.some((r) => r.kind === "video" && r.raw.output === "audio" && r.music)).toBe(true)
    expect(recorded.some((r) => r.raw.styleGuide !== "" && r.raw.captions === true && r.music)).toBe(true)
  })
  for (const [i, r] of recorded.entries()) {
    it(`row ${i}: same hash, outputMap and first-run subset`, () => {
      const now = rowOf(r, false)
      expect(now.hash).toBe(r.hash)
      expect(now.outputMap).toEqual(r.outputMap)
      expect(now.firstRun).toEqual(r.firstRun)
    })
  }
  it("a snapshot P1 code stored still validates", () => {
    expect(isStoredInlineGraph(recorded[0]!.stored)).toBe(true)
  })
})
