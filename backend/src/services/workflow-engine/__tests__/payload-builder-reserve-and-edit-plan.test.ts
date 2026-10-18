/**
 * buildPayload: credit reservation tiers and the edit-plan payload (LTX and
 * Seedance 2.5 credit ids, edit-plan offsets and reserve).
 *
 * Merged from 3 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 3 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { applyDefaultVideoSelection } from "@nodaro/shared/models"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { resolveVideoRequestNorm } from "../../../lib/video-request-norm.js"
import { editPlanModeRefusalMessage } from "../../../lib/private-plugins/edit-plan-mode-gate.js"

describe("payload-builder-ltx-credit-id.test.ts", () => {
  // Mirrors ltx-dispatch.test.ts's harness — read that file and match its
  // `buildCtx` construction and any module mocks it installs.
  const node = (data: Record<string, unknown>) => ({
    id: "n1",
    type: "generate-video",
    data: { provider: "ltx-2.3-pro", prompt: "a cat", ...data },
  })
  const ctx = { nodes: [], edges: [], nodeStates: {} }
  const build = (data: Record<string, unknown>, resolvedInputs: Record<string, unknown> = {}) =>
    buildPayload(node(data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

  describe("LTX reserves the resolution×duration tier it renders", () => {
    it("prices 4k / 10s as the 4k:10s composite, not the bare id", () => {
      expect(build({ resolution: "4k", duration: 10 }).modelIdentifier).toBe("ltx-2.3-pro:4k:10s")
    })

    it("prices the Fast variant's long durations", () => {
      expect(build({ provider: "ltx-2.3-fast", resolution: "1080p", duration: 20 }).modelIdentifier)
        .toBe("ltx-2.3-fast:1080p:20s")
    })

    it("falls back to the 1080p band for an unknown resolution (never cheaper than the bare id)", () => {
      expect(build({ resolution: "720p", duration: 6 }).modelIdentifier).toBe("ltx-2.3-pro:1080p:6s")
    })

    it("the reserved tier and the enqueued payload describe the same render", () => {
      const out = build({ resolution: "2k", duration: 8 })
      expect(out.modelIdentifier).toBe("ltx-2.3-pro:2k:8s")
      expect(out.payload.resolution).toBe("2k")
      expect(out.payload.duration).toBe(8)
    })
  })

  // Parity: the DAG lane's reservation must equal what the direct routes'
  // creditGuard closures reserve for the SAME node data — `/v1/text-to-video`
  // (text-to-video.ts:64-79, nodeType "text-to-video") for the t2v case, and
  // `/v1/generate-video` (generate-video.ts:462-478, nodeType "image-to-video")
  // for the i2v case; there is no standalone `image-to-video.ts` route file.
  // Reproduces each closure's exact call shape rather than importing it — it's
  // an inline arrow passed to creditGuard, not an exported symbol. sound/mode
  // are always undefined and hasVideoRef always false for LTX (the branch
  // ignores all three), so this is byte-for-byte the same computation the
  // route performs.
  //
  // R3: Task 9 added the canonicalisation this test used to defer. Both lanes now
  // run `resolveVideoRequestNorm` BEFORE the identifier, so an upper-cased "4K"
  // reaches the case-sensitive `LTX_DURATION_TIERS` lookup as "4k" and prices the
  // 4k band on BOTH sides instead of silently falling back to 1080p. Parity held
  // before (both sides fell back alike) and holds now (both sides canonicalise
  // alike) — what changed is that the fallback is no longer reached for a spelling
  // the user plainly meant. (The UI dropdown only ever emits lowercase — see
  // model-options.ts's VIDEO_RESOLUTION_OPTIONS — so "4K" reaches this code only
  // via a bypass of the picker: a hand-built API/webhook/import payload.)
  describe("LTX DAG reservation matches the direct-route reservation (parity)", () => {
    const routeIdentifier = (
      resolution: string | undefined,
      nodeType: "text-to-video" | "image-to-video" = "text-to-video",
    ) => {
      const sel = applyDefaultVideoSelection({ provider: "ltx-2.3-pro", duration: undefined as number | string | undefined })
      // Mirrors the routes' preHandler exactly: normalize first, then build the
      // identifier from the normalized values (text-to-video.ts / generate-video.ts).
      const norm = resolveVideoRequestNorm({ provider: sel.provider, resolution, duration: sel.duration })
      return buildVideoCreditModelIdentifier(
        sel.provider,
        norm.duration ?? sel.duration,
        undefined,
        nodeType,
        undefined,
        norm.resolution,
        false,
      )
    }

    const cases: Array<string | undefined> = ["4k", "4K", "1080p", undefined]

    it.each(cases)("t2v: route and DAG agree for resolution=%s", (resolution) => {
      const dagIdentifier = build({ resolution }).modelIdentifier
      expect(dagIdentifier).toBe(routeIdentifier(resolution))
    })

    it.each(cases)("i2v: route (generate-video.ts) and DAG agree for resolution=%s", (resolution) => {
      // Wiring a startFrame flips the DAG branch's `task` to "image_to_video",
      // which flips its buildVideoCreditModelIdentifier call to nodeType
      // "image-to-video" — mirroring /v1/generate-video, not /v1/text-to-video.
      const dagIdentifier = build({ resolution }, { startFrameUrl: "https://cdn.example/a.png" }).modelIdentifier
      expect(dagIdentifier).toBe(routeIdentifier(resolution, "image-to-video"))
    })

    it("canonicalises case before the identifier keys on it — '4K' now prices the 4k band on BOTH sides", () => {
      expect(routeIdentifier("4k")).toBe("ltx-2.3-pro:4k:6s")
      // Was "ltx-2.3-pro:1080p:6s" before Task 9: the uppercase key missed
      // LTX_DURATION_TIERS' lowercase lookup and fell back to the cheapest band,
      // so a 4K request rendered 4K (snapLtxInput's own fallback aside) while
      // billing 1080p. Now canonicalised once, upstream of every identifier site.
      expect(routeIdentifier("4K")).toBe("ltx-2.3-pro:4k:6s")
      expect(routeIdentifier("1080p")).toBe("ltx-2.3-pro:1080p:6s")
      expect(routeIdentifier(undefined)).toBe("ltx-2.3-pro:1080p:6s")
    })
  })

  /**
   * Seedance 2.5 in the DAG lane: a DELIBERATE reprice, pinned here so it cannot
   * happen again by accident.
   *
   * `video-ui-defaults.ts` fills `resolutions[0]` = "480p" for an untouched
   * seedance node, and that fill is what the worker has always been SENT. But the
   * identifier used to be built from raw `data.resolution` (undefined), which the
   * seedance branch prices at its declared PRICING_DEFAULT_RESOLUTION of 720p. So
   * the DAG reserved the 720p row (1260 cr) for a render it explicitly requested
   * at 480p (560 cr) — the user was charged 2.25× for the cheaper tier.
   *
   * Task 9's invariant is that the priced value IS the sent value, so the two now
   * agree at 480p — the tier actually rendered. `video-ui-defaults.ts` warns "do
   * not align the branches without repricing it deliberately"; this IS that
   * deliberate alignment, in the direction of what the provider is asked to make.
   *
   * The remaining question is a product one, not a correctness one: if seedance
   * nodes SHOULD render 720p, change `uiResolutionFill` to the declared default
   * and both numbers move to 720p together. Either way price and wire now match.
   */
  describe("seedance-2-5 DAG nodes price the tier they actually request", () => {
    const seedanceNode = (nodeType: string, data: Record<string, unknown>) => ({
      id: "n1",
      type: nodeType,
      data: { provider: "seedance-2-5", prompt: "a cat", duration: 8, ...data },
    })
    const buildSeedance = (
      data: Record<string, unknown> = {},
      resolvedInputs: Record<string, unknown> = {},
      nodeType = "generate-video",
    ) =>
      buildPayload(seedanceNode(nodeType, data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

    // All THREE video branches carry the same ui-fill, so all three had the same
    // price-vs-wire split. The unified branch is the one users hit today; the two
    // legacy branches still serve saved workflows, so pin every one.
    const BRANCHES: Array<[string, string, Record<string, unknown>]> = [
      ["unified (generate-video)", "generate-video", {}],
      ["legacy i2v (image-to-video)", "image-to-video", { imageUrl: "https://cdn.example/a.png" }],
      ["legacy t2v (text-to-video)", "text-to-video", {}],
    ]

    for (const [label, nodeType, resolvedInputs] of BRANCHES) {
      it(`${label}: an untouched node reserves the 480p row it sends, not the 720p row it does not`, () => {
        const out = buildSeedance({}, resolvedInputs, nodeType)
        expect(out.payload.resolution, label).toBe("480p")
        // Was "seedance-2-5:8s:720p" — priced 1260 cr against a 480p (560 cr) render.
        expect(out.modelIdentifier, label).toBe("seedance-2-5:8s:480p")
      })
    }

    it("an explicit resolution is priced and sent unchanged", () => {
      const out = buildSeedance({ resolution: "1080p" })
      expect(out.payload.resolution).toBe("1080p")
      expect(out.modelIdentifier).toBe("seedance-2-5:8s:1080p")
    })

    it("the ui aspect fill still survives normalization (R5)", () => {
      expect(buildSeedance().payload.aspectRatio).toBe("adaptive")
    })

    // Seedance Draft renders at 480p only: a node carrying `draft` with a stale
    // 720p/1080p (an agent, an import, a FieldMapping) must be PRICED and SENT at
    // 480p, and the payload must carry the flag the worker turns into input.draft.
    for (const [label, nodeType, resolvedInputs] of BRANCHES) {
      it(`${label}: draft forces the 480p row and rides the payload`, () => {
        const out = buildSeedance({ draft: true, resolution: "1080p" }, resolvedInputs, nodeType)
        expect(out.payload.resolution, label).toBe("480p")
        expect(out.payload.draft, label).toBe(true)
        expect(out.modelIdentifier, label).toBe("seedance-2-5:8s:480p")
      })
    }

    it("a model without draft mode ignores the flag (no draft key, resolution untouched)", () => {
      const out = buildSeedance({ provider: "seedance-2", draft: true, resolution: "720p" })
      expect(out.payload).not.toHaveProperty("draft")
      expect(out.payload.resolution).toBe("720p")
    })
  })
})

describe("payload-builder-edit-plan-offsets.test.ts", () => {
  // B4 (decided 2026-09-25): audio-sync's measured offsets reach edit-plan's
  // `sources[].offsetMs` HERE — before the reserve, so a plan that would render
  // out of sync fails before charging. buildPayload is pure (the reserve-test
  // harness): no mocks.

  const ctx = { nodes: [], edges: [], nodeStates: {} }
  const node = (data: Record<string, unknown> = {}) => ({
    id: "ep1",
    type: "edit-plan",
    data: { mode: "tighten", planTier: "standard", ...data },
  })
  const build = (resolvedInputs: Record<string, unknown>, data: Record<string, unknown> = {}) =>
    buildPayload(node(data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

  const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 800 }, { text: "bye", startMs: 59_000, endMs: 60_000 }] }
  const MIC = { nodeId: "mic", url: "https://cdn.example/mic.wav", kind: "audio" as const, label: "Zoom H6" }
  const CAM_A = { nodeId: "cam-a", url: "https://cdn.example/a.mp4", kind: "video" as const, label: "Camera A" }
  const CAM_B = { nodeId: "cam-b", url: "https://cdn.example/b.mp4", kind: "video" as const, label: "Wide" }
  const masterRole = { sourceConfig: { mic: { role: "master-audio" } } }
  const row = (sourceId: string, offsetMs: number, confidence = 0.9) => ({ sourceId, offsetMs, confidence, driftMsPerHour: 0 })
  /** The canvas json handle carries audio-sync's result stringified. */
  const sync = (...offsets: ReturnType<typeof row>[]) => JSON.stringify({ version: 1, reference: "mic", offsets, notes: [] })

  type Payload = { sources: Array<{ id: string; offsetMs?: number }>; transcript: { sourceId?: string } }
  const payloadOf = (out: ReturnType<typeof build>) => out.payload as unknown as Payload
  const offsetsOf = (out: ReturnType<typeof build>) => Object.fromEntries(payloadOf(out).sources.map((s) => [s.id, s.offsetMs]))

  describe("edit-plan payload — audio-sync offsets onto the sources (B4)", () => {
    it("writes each camera's measured offset onto its source; the master keeps its clock", () => {
      const out = build({
        transcript: JSON.stringify(transcript),
        editPlanSources: [MIC, CAM_A, CAM_B],
        editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000), row("cam-b", -1_500)),
      }, masterRole)
      expect(offsetsOf(out)).toEqual({ mic: undefined, "cam-a": 2_000, "cam-b": -1_500 })
      // The raw audio-sync result never rides the payload — only the offsets do.
      expect(out.payload).not.toHaveProperty("offsets")
    })

    it("a hand-set offset (the panel's sourceConfig) wins over the measured one", () => {
      const out = build({
        transcript,
        editPlanSources: [MIC, CAM_A],
        editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
      }, { sourceConfig: { mic: { role: "master-audio" }, "cam-a": { offsetMs: 1_950 } } })
      expect(offsetsOf(out)).toEqual({ mic: undefined, "cam-a": 1_950 })
    })

    it("a weak match fails before the reserve, naming the camera by its label", () => {
      expect(() => build({
        transcript,
        editPlanSources: [MIC, CAM_A],
        editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000, 0.31)),
      }, masterRole)).toThrow(/^edit-plan: audio-sync's match for "Camera A" is too weak to trust \(confidence 0.31; 0.5 needed\) — set its offset by hand$/)
    })

    it("a camera audio-sync did not measure fails before the reserve", () => {
      expect(() => build({
        transcript,
        editPlanSources: [MIC, CAM_A, CAM_B],
        editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
      }, masterRole)).toThrow(/"Wide" was not measured by audio-sync — wire it into audio-sync, or set its offset by hand/)
    })

    it("an offsets wire with no audio-sync result (null) fails rather than planning unsynced", () => {
      expect(() => build({ transcript, editPlanSources: [MIC, CAM_A], editPlanOffsets: null }, masterRole))
        .toThrow(/the offsets carry no Audio Sync result/)
    })

    it("no offsets wire → today's behaviour: sources as configured, no check beyond the master's own offset", () => {
      const out = build({ transcript, editPlanSources: [MIC, CAM_A] }, masterRole)
      expect(offsetsOf(out)).toEqual({ mic: undefined, "cam-a": undefined })
      expect(() => build({ transcript, editPlanSources: [MIC, CAM_A] }, { sourceConfig: { mic: { role: "master-audio", offsetMs: 40 } } }))
        .toThrow(/"Zoom H6" is the master \(the plan follows its clock\), so its offset must be 0, not 40 ms/)
    })

    it("a transcript made from an offset camera fails before the reserve (the cuts would land off by its offset)", () => {
      expect(() => build({
        transcript,
        editPlanSources: [MIC, CAM_A],
        editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
        editPlanTranscriptOrigin: "cam-a",
      }, masterRole)).toThrow(/the transcript was made from "Camera A", which is 2000 ms off the master "Zoom H6"/)
    })

    it("a transcript made from the master is stamped with its source id, for the plugin's own clock guard", () => {
      const out = build({
        transcript: JSON.stringify(transcript),
        editPlanSources: [MIC, CAM_A],
        editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
        editPlanTranscriptOrigin: "mic",
      }, masterRole)
      expect(payloadOf(out).transcript.sourceId).toBe("mic")
    })

    it("anchors on the first source when none is marked master — rebasing audio-sync's mic-referenced offsets onto it", () => {
      const out = build({
        transcript,
        editPlanSources: [CAM_A, MIC],
        editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
      })
      expect(offsetsOf(out)).toEqual({ "cam-a": undefined, mic: -2_000 })
    })
  })
})

describe("payload-builder-edit-plan-reserve.test.ts", () => {
  // Mirrors payload-builder-ltx-credit-id.test.ts's harness: buildPayload is a
  // pure function of (node, jobId, resolvedInputs, usageLogId, ctx) — no mocks.
  //
  // Regression: an orchestrated edit-plan run whose MASTER source is a
  // reference-audio / youtube (or direct-URL) node exposes NO duration on its
  // node data at reserve time (its length isn't known until the audio is
  // fetched, and its live orchestrator output is a bare URL). The reserve used to
  // bucket to the 180-minute CEILING — `edit-plan:tighten:standard:180m` (base
  // 720; at a 10% cost_markup_percent that rounds 720×1.1 = 792.0000000000001 up
  // to the 793 the user was charged — the only percent that produces it via the
  // IEEE-754 ceil) — instead of the 60m bucket a ~59-min episode belongs in
  // (base 240).
  //
  // THIS file pins the buildPayload FALLBACK beneath the probe-at-reserve: the
  // authoritative reserve basis is `computeEditPlanReserveId`'s ffprobe of the
  // master (see lib/__tests__/edit-plan-pricing.test.ts), but buildPayload cannot
  // ffprobe, so it reserves on the master source node's own duration when it has
  // one, else the transcript's own clock (a required input and the timing map of
  // that same master), else the ceiling. That transcript basis is what stands
  // when the reserve-path probe can't run (unprobeable/unreachable master).

  const ctx = { nodes: [], edges: [], nodeStates: {} }

  const node = (data: Record<string, unknown>) => ({
    id: "ep1",
    type: "edit-plan",
    data: { mode: "tighten", planTier: "standard", ...data },
  })

  const build = (data: Record<string, unknown>, resolvedInputs: Record<string, unknown>) =>
    buildPayload(node(data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

  // A 59.4-minute episode's transcript: last word ends at 3,564,000 ms.
  const transcript59m = {
    version: 1,
    words: [
      { text: "welcome", startMs: 0, endMs: 800 },
      { text: "goodbye", startMs: 3_563_000, endMs: 3_564_000 },
    ],
  }

  // The reference-audio source row as input-resolver builds it: nodeId + url +
  // kind, and CRITICALLY no `duration` key (the node exposes none).
  const urlSourceRow = { nodeId: "src-audio", url: "https://cdn.example/episode.m4a", kind: "audio" as const }

  describe("edit-plan orchestrated reserve — URL/reference-audio master buckets by transcript", () => {
    it("a ~59-min episode reserves the 60m bucket, not the 180m ceiling", () => {
      const out = build(
        {},
        { transcript: JSON.stringify(transcript59m), editPlanSources: [urlSourceRow] },
      )
      // Was `edit-plan:tighten:standard:180m` (base 720 → 793 charged). Now 60m.
      expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
      expect((out.payload as { reservedCreditId?: string }).reservedCreditId).toBe(
        "edit-plan:tighten:standard:60m",
      )
    })

    it("an inline (non-stringified) transcript object works too", () => {
      const out = build({}, { transcript: transcript59m, editPlanSources: [urlSourceRow] })
      expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
    })

    it("the source node's OWN duration wins over the transcript when present", () => {
      // upload-audio master with a known 20-min length → the 30m bucket, even
      // though the transcript would imply 60m — the media length is authoritative.
      const out = build(
        {},
        {
          transcript: JSON.stringify(transcript59m),
          editPlanSources: [{ ...urlSourceRow, duration: 20 * 60 }],
        },
      )
      expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:30m")
    })

    it("mode/tier still drive the composite (chapters + premium)", () => {
      const out = build(
        { mode: "chapters", planTier: "premium" },
        { transcript: JSON.stringify(transcript59m), editPlanSources: [urlSourceRow] },
      )
      expect(out.modelIdentifier).toBe("edit-plan:chapters:premium:60m")
    })

    it("an empty transcript falls to the ceiling — the safe over-reserve direction", () => {
      const out = build(
        {},
        { transcript: JSON.stringify({ version: 1, words: [] }), editPlanSources: [urlSourceRow] },
      )
      expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:180m")
    })
  })

  // The orchestrated path bypasses the /v1/edit-plan route's Zod (count 1..50), so
  // an unbounded node setting used to reach the planner — and fan out one paid
  // render per clip — unclamped. The frontend estimate prices at most 50.
  describe("edit-plan orchestrated payload — clip count is clamped like the request schema", () => {
    const clips = (count: unknown) =>
      (build({ mode: "clips", count }, { transcript: transcript59m, editPlanSources: [urlSourceRow] }).payload as { count?: number }).count

    it("passes an in-range count through", () => {
      expect(clips(5)).toBe(5)
    })
    it("clamps an absurd count to 50 and floors a fraction", () => {
      expect(clips(9000)).toBe(50)
      expect(clips(7.9)).toBe(7)
    })
    it("sends no count for a missing / non-positive / non-numeric one (the planner uses its default)", () => {
      expect(clips(undefined)).toBeUndefined()
      expect(clips(0)).toBeUndefined()
      expect(clips(-3)).toBeUndefined()
      expect(clips("12")).toBeUndefined()
    })
    it("never sends a count outside clips mode", () => {
      const out = build({ mode: "tighten", count: 5 }, { transcript: transcript59m, editPlanSources: [urlSourceRow] })
      expect((out.payload as { count?: number }).count).toBeUndefined()
    })
  })

  // Track D1: trailer mode reserves its own composite (priced like clips) and
  // carries the delivery aspect, but none of the clips-only levers.
  describe("edit-plan orchestrated payload — trailer mode", () => {
    const trailer = (data: Record<string, unknown>) =>
      build({ mode: "trailer", ...data }, { transcript: transcript59m, editPlanSources: [urlSourceRow] })

    it("reserves the trailer composite for the master's bucket", () => {
      const out = trailer({})
      expect(out.modelIdentifier).toBe("edit-plan:trailer:standard:60m")
      const payload = out.payload as { mode?: string; reservedCreditId?: string }
      expect(payload.mode).toBe("trailer")
      expect(payload.reservedCreditId).toBe("edit-plan:trailer:standard:60m")
    })

    it("passes the target aspect and drops the clips-only count and target length", () => {
      const payload = trailer({ count: 5, targetDurationSec: 30, targetAspect: "9:16" }).payload as Record<string, unknown>
      expect(payload.targetAspect).toBe("9:16")
      expect(payload.count).toBeUndefined()
      expect(payload.targetDurationSec).toBeUndefined()
    })
  })

  // Round 4 (decided 2026-10-06): an UNKNOWN mode fails the node before the
  // reservation, with the message every lane uses — never planned (and charged)
  // as tighten. The orchestrator loads no plugin, so a known but undeclared mode
  // (trailer on a plugin that predates it) is the worker gate's to refuse.
  describe("edit-plan orchestrated payload — unknown mode", () => {
    const withMode = (mode: unknown) => () =>
      build({ mode }, { transcript: transcript59m, editPlanSources: [urlSourceRow] })

    it("refuses an unknown mode with the shared message instead of reserving tighten", () => {
      expect(withMode("montage")).toThrow(editPlanModeRefusalMessage("montage"))
      expect(withMode("Clips")).toThrow(editPlanModeRefusalMessage("Clips"))
      expect(withMode(3)).toThrow(editPlanModeRefusalMessage("3"))
    })

    it("an absent mode is the node's default, tighten", () => {
      const out = withMode(undefined)()
      expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
      expect((out.payload as { mode?: string }).mode).toBe("tighten")
    })
  })

  // Per started minute (decided 2026-10-07): when the caller says the plugin
  // charges that way, a length RECORDED on the master reserves its started
  // minutes. A transcript basis keeps the step (review round F4): the last
  // word's end is a lower bound — trailing music and silence are not
  // transcribed — so its started minutes would sit under the file's real length,
  // and the plugin, which re-probes the file, refuses a reserve more than 3 s
  // short of it. The step absorbs that. The executor's own probe of the master
  // replaces either id with the exact started minutes when it succeeds.
  describe("edit-plan orchestrated reserve — per started minute", () => {
    // Speech ends at 44:12; the file itself may run on past 45:00.
    const transcript44m = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }, { text: "bye", startMs: 2_651_000, endMs: 2_652_000 }] }
    const buildWith = (perMinute: boolean | undefined, source: Record<string, unknown> = urlSourceRow) =>
      buildPayload(node({}) as never, "job-1", { transcript: JSON.stringify(transcript44m), editPlanSources: [source] } as never, undefined, {
        ...ctx,
        ...(perMinute === undefined ? {} : { editPlanPerMinute: perMinute }),
      } as never)

    it("reserves the 45 started minutes of a master whose 44.2-min length is recorded", () => {
      const out = buildWith(true, { ...urlSourceRow, duration: 44.2 * 60 })
      expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:45m")
      expect((out.payload as { reservedCreditId?: string }).reservedCreditId).toBe("edit-plan:tighten:standard:45m")
    })

    it("never reserves started minutes from the transcript's clock: the step, a 44.2-min transcript is :60m", () => {
      const out = buildWith(true)
      expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
      expect((out.payload as { reservedCreditId?: string }).reservedCreditId).toBe("edit-plan:tighten:standard:60m")
    })

    it("keeps the 60-minute step without the capability (absent or false)", () => {
      expect(buildWith(false).modelIdentifier).toBe("edit-plan:tighten:standard:60m")
      expect(buildWith(undefined).modelIdentifier).toBe("edit-plan:tighten:standard:60m")
      expect(buildWith(false, { ...urlSourceRow, duration: 44.2 * 60 }).modelIdentifier).toBe("edit-plan:tighten:standard:60m")
    })
  })
})
