/**
 * Speaker View v3 in the app (P3.9): the face tracks a render reads, and what
 * the app checks of them before a run.
 *
 *  - Labels (P3-18, P3-21 (a), P3-4 "Labels and the name space"; round 3,
 *    decided 2026-10-09): the app's labels override the stored file's by track
 *    id — the current rename map first, then the manual corrections on the
 *    Speaker Frames node, then the read-time region match (an unattributed
 *    track whose median centre lies inside exactly ONE drawn region of its
 *    camera). Default thirds never label.
 *  - Motion (P3-10): `static` | `glide`, `glide` when tracks are wired and
 *    nothing is set; never sent without tracks.
 *  - Staleness by coverage (P3-20 (a); its split decided 2026-10-09): the
 *    plugin's no-coverage refusal mirrored, and the app's own check that each
 *    camera's file and offset are the ones Speaker Frames sampled, read from the
 *    Speaker Frames job's inputs.
 *  - Coverage notes (§4): under 60 % of a slot's on-screen time sampled.
 */
import { describe, expect, it } from "vitest"
import {
  SPEAKER_VIEW_TRACKED_DEFAULT_MOTION,
  SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE,
  defaultSpeakerRegions,
  drawnSpeakerRegions,
  findSpeakerViewIssues,
  labelSpeakerViewTracks,
  normalizeSpeakerViewData,
  resolveSpeakerViewTracksForRun,
  speakerFramesJobIdOfTracksUrl,
  speakerFramesSampledSources,
  speakerRegionKey,
  speakerTrackAssignmentFor,
  speakerTrackAssignmentsOf,
  speakerTrackCentres,
  speakerViewRenderBasis,
  speakerViewTrackedBasis,
  speakerViewTrackedRuleInput,
  speakerViewTrackedWire,
  speakerViewTracksAtRest,
  speakerViewTracksNeedBody,
  speakerViewFollowedTrackCameras,
  speakerViewTracksProvenanceIssues,
} from "@nodaro/render-rules"
import type { Edl, SpeakerTrackSet, SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"

const SHA = "a".repeat(64)
const MIC = { id: "mic", url: "https://x/mic.wav", kind: "audio" as const, role: "master-audio" as const }
const WIDE = { id: "wide", url: "https://x/wide.mp4", kind: "video" as const, speakers: ["Host", "Guest"] }
const CAM_B = { id: "camB", url: "https://x/camB.mp4", kind: "video" as const, offsetMs: 4_000 }

const edl = (over: Partial<Edl> = {}): Edl =>
  ({
    version: 1,
    clock: "master",
    sources: [MIC, WIDE, CAM_B],
    segments: [
      { id: "s0", inMs: 0, outMs: 10_000, video: "wide", speaker: "Host", audio: "mic" },
      { id: "s1", inMs: 10_000, outMs: 20_000, video: "wide", speaker: "Guest", audio: "mic" },
      { id: "s2", inMs: 20_000, outMs: 30_000, video: "camB", speaker: "Host", audio: "mic" },
    ],
    ...over,
  }) as Edl

const descriptor = (over: Partial<SpeakerTrackSetDescriptor> = {}): SpeakerTrackSetDescriptor => ({
  version: 1,
  sampleFps: 2,
  detector: { id: "yunet" },
  url: "https://media.example/users/u1/speaker-tracks/11111111-2222-3333-4444-555555555555.json",
  sha256: SHA,
  bytes: 1_000,
  sources: [
    {
      sourceId: "wide",
      clock: "source",
      frame: { w: 1920, h: 1080 },
      sampledSpans: [{ startMs: 0, endMs: 22_000 }],
      tracks: [
        { id: "wide/t1", speaker: "SPEAKER_00", attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: "SPEAKER_00" }, boxCount: 40 },
        { id: "wide/t2", boxCount: 40 },
      ],
    },
    {
      sourceId: "camB",
      clock: "source",
      frame: { w: 1920, h: 1080 },
      sampledSpans: [{ startMs: 14_000, endMs: 28_000 }],
      tracks: [{ id: "camB/t1", speaker: "Host", attribution: { method: "source-map", confidence: 1 }, boxCount: 20 }],
    },
  ],
  ...over,
})

const box = (ms: number, cx: number, cy = 0.4) => ({ ms, x: cx - 0.05, y: cy - 0.1, w: 0.1, h: 0.2 })
const body = (): SpeakerTrackSet => ({
  version: 1,
  sampleFps: 2,
  detector: { id: "yunet" },
  sources: [
    {
      sourceId: "wide",
      clock: "source",
      frame: { w: 1920, h: 1080 },
      sampledSpans: [{ startMs: 0, endMs: 22_000 }],
      tracks: [
        { id: "wide/t1", boxes: [box(0, 0.25), box(500, 0.26), box(1000, 0.9)] },
        { id: "wide/t2", boxes: [box(0, 0.7), box(500, 0.72), box(1000, 0.71)] },
      ],
    },
  ],
})

const RENAMED = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Host" }], speakerNames: { SPEAKER_00: "Host", SPEAKER_01: "Guest" } }
const LEFT = { source: "wide", speaker: "Host", region: { x: 0, y: 0, w: 0.5, h: 1 } }
const RIGHT = { source: "wide", speaker: "Guest", region: { x: 0.5, y: 0, w: 0.5, h: 1 } }

const speakerOf = (d: SpeakerTrackSetDescriptor, id: string) => d.sources.flatMap((s) => s.tracks).find((t) => t.id === id)

describe("labelSpeakerViewTracks (the app's labels, by track id)", () => {
  it("re-maps an attributed track through the current rename map, keeping its raw label", () => {
    const { descriptor: d } = labelSpeakerViewTracks(descriptor(), { transcript: RENAMED })
    expect(speakerOf(d, "wide/t1")).toMatchObject({ speaker: "Host", attribution: { method: "mouth-motion", rawSpeaker: "SPEAKER_00" } })
  })

  it("reads the map from a transcript given as its JSON string", () => {
    const { descriptor: d } = labelSpeakerViewTracks(descriptor(), { transcript: JSON.stringify(RENAMED) })
    expect(speakerOf(d, "wide/t1")?.speaker).toBe("Host")
  })

  it("lets a manual correction win over the rename map, and clears a track set to nobody", () => {
    const { descriptor: d } = labelSpeakerViewTracks(descriptor(), {
      transcript: RENAMED,
      trackAssignments: [{ trackId: "wide/t1", speaker: "Guest" }, { trackId: "camB/t1", speaker: null }],
    })
    expect(speakerOf(d, "wide/t1")).toMatchObject({ speaker: "Guest", attribution: { method: "manual" } })
    expect(speakerOf(d, "camB/t1")?.speaker).toBeUndefined()
  })

  it("lists a correction whose track a re-run no longer has (never drops it silently)", () => {
    const out = labelSpeakerViewTracks(descriptor(), { trackAssignments: [{ trackId: "wide/t9", speaker: "Host" }] })
    expect(out.unmatched).toEqual([{ trackId: "wide/t9", speaker: "Host" }])
  })

  it("labels an unattributed track by the ONE drawn region its median centre lies in (P3-21 (a))", () => {
    const centres = speakerTrackCentres(body())
    const out = labelSpeakerViewTracks(descriptor(), { drawnRegions: [LEFT, RIGHT], centres })
    expect(speakerOf(out.descriptor, "wide/t2")).toMatchObject({ speaker: "Guest", attribution: { method: "region" } })
    expect(out.regionLabelled).toEqual([{ trackId: "wide/t2", source: "wide", speaker: "Guest" }])
    // An attributed track is never relabelled by a region.
    expect(speakerOf(out.descriptor, "wide/t1")?.speaker).toBe("SPEAKER_00")
  })

  it("abstains when the centre lies in two drawn regions, or in none", () => {
    const centres = speakerTrackCentres(body())
    const overlapping = { source: "wide", speaker: "Host", region: { x: 0.4, y: 0, w: 0.6, h: 1 } }
    expect(speakerOf(labelSpeakerViewTracks(descriptor(), { drawnRegions: [overlapping, RIGHT], centres }).descriptor, "wide/t2")?.speaker).toBeUndefined()
    expect(speakerOf(labelSpeakerViewTracks(descriptor(), { drawnRegions: [LEFT], centres }).descriptor, "wide/t2")?.speaker).toBeUndefined()
  })

  it("never region-labels a track the person cleared", () => {
    const centres = speakerTrackCentres(body())
    const out = labelSpeakerViewTracks(descriptor(), { drawnRegions: [LEFT, RIGHT], centres, trackAssignments: [{ trackId: "wide/t2", speaker: null }] })
    expect(speakerOf(out.descriptor, "wide/t2")?.speaker).toBeUndefined()
  })

  it("matches a region only on its own camera", () => {
    const centres = speakerTrackCentres(body())
    const elsewhere = { source: "camB", speaker: "Guest", region: { x: 0.5, y: 0, w: 0.5, h: 1 } }
    expect(speakerOf(labelSpeakerViewTracks(descriptor(), { drawnRegions: [elsewhere], centres }).descriptor, "wide/t2")?.speaker).toBeUndefined()
  })

  it("never mutates what it is given", () => {
    const d = descriptor()
    const before = JSON.stringify(d)
    labelSpeakerViewTracks(d, { transcript: RENAMED, trackAssignments: [{ trackId: "wide/t2", speaker: "Host" }] })
    expect(JSON.stringify(d)).toBe(before)
  })
})

describe("speakerTrackCentres", () => {
  it("is the median box centre per track (one outlier does not move it)", () => {
    const c = speakerTrackCentres(body())
    expect(c.get("wide/t1")!.x).toBeCloseTo(0.26)
    expect(c.get("wide/t2")!.x).toBeCloseTo(0.71)
    expect(c.get("wide/t1")!.y).toBeCloseTo(0.4)
  })
})

describe("drawnSpeakerRegions (default thirds never label)", () => {
  it("drops the rows the region editor saved as untouched defaults", () => {
    expect(drawnSpeakerRegions([LEFT, RIGHT], [speakerRegionKey("wide", "Guest")])).toEqual([LEFT])
  })
  it("counts every row as drawn when no default is marked (an API or MCP write)", () => {
    expect(drawnSpeakerRegions([LEFT, RIGHT], undefined)).toEqual([LEFT, RIGHT])
  })
  it("ignores rows that are not regions", () => {
    expect(drawnSpeakerRegions([LEFT, { source: "wide" }, null], [])).toEqual([LEFT])
  })
})

// Decided 2026-10-10: new saves carry the editor's marker; for older rows and
// API/MCP-written rows, a box exactly equal to the default thirds also counts
// as a default. A default never labels a track.
describe("drawnSpeakerRegions: a box exactly on the default thirds is a default, marked or not", () => {
  const thirds = (aspect: number, frame = 16 / 9) =>
    defaultSpeakerRegions(["Host", "Guest"], aspect, frame).map((d) => ({ source: "wide", speaker: d.speaker, region: d.region }))

  it("counts unmarked rows equal to the default thirds (an older save, an API or MCP write) as defaults", () => {
    expect(drawnSpeakerRegions(thirds(9 / 16), undefined, descriptor())).toEqual([])
    expect(drawnSpeakerRegions(thirds(4 / 5), undefined, descriptor())).toEqual([])
    expect(drawnSpeakerRegions(thirds(1), undefined, descriptor())).toEqual([])
  })

  it("keeps a moved row drawn while its untouched neighbour stays a default", () => {
    const [host, guest] = thirds(9 / 16)
    const moved = { ...guest!, region: { ...guest!.region, x: 0.62 } }
    expect(drawnSpeakerRegions([host, moved], undefined, descriptor())).toEqual([moved])
  })

  // Review round (F1): only the WIDTH may drift (the proxy's even-rounded frame);
  // the box must sit exactly on its third for that width. An arrow-key nudge or
  // a one-sided edge drag of a single camera pixel is a box the person set.
  it("keeps a default nudged by 1, 2 or 3 camera pixels drawn (the editor saves it unmarked)", () => {
    const round4 = (v: number) => Math.round(v * 1e4) / 1e4
    for (const canvas of [9 / 16, 4 / 5, 1]) {
      const [host, guest] = thirds(canvas)
      for (const px of [1, 2, 3, -1]) {
        const nudged = { ...guest!, region: { ...guest!.region, x: round4(guest!.region.x + px / 1920) } }
        expect(drawnSpeakerRegions([host, nudged], undefined, descriptor())).toEqual([nudged])
      }
    }
  })

  it("keeps a default whose left or right edge moved one camera pixel drawn", () => {
    const round4 = (v: number) => Math.round(v * 1e4) / 1e4
    const [host, guest] = thirds(9 / 16)
    const g = guest!.region
    const left = { ...guest!, region: { ...g, x: round4(g.x - 1 / 1920), w: round4(g.w + 1 / 1920) } }
    const right = { ...guest!, region: { ...g, w: round4(g.w + 1 / 1920) } }
    expect(drawnSpeakerRegions([host, left], undefined, descriptor())).toEqual([left])
    expect(drawnSpeakerRegions([host, right], undefined, descriptor())).toEqual([right])
  })

  it("keeps hand-drawn halves drawn: they are no canvas's default on this camera", () => {
    expect(drawnSpeakerRegions([LEFT, RIGHT], undefined, descriptor())).toEqual([LEFT, RIGHT])
  })

  it("reads the camera's own frame: the same box is a default on one camera and drawn on another", () => {
    const portrait = descriptor({ sources: [{ ...descriptor().sources[0]!, frame: { w: 1080, h: 1920 } }] })
    expect(drawnSpeakerRegions(thirds(9 / 16), undefined, portrait)).toEqual(thirds(9 / 16))
  })

  it("matches the proxy's even-rounded frame (an odd aspect drifts by a rounding)", () => {
    const rows = thirds(9 / 16, 4 / 3)
    const proxy = descriptor({ sources: [{ ...descriptor().sources[0]!, frame: { w: 720, h: 540 } }] })
    expect(drawnSpeakerRegions(rows, undefined, proxy)).toEqual([])
    const odd = defaultSpeakerRegions(["Host", "Guest"], 9 / 16, 1080 / 1920).map((d) => ({ source: "wide", speaker: d.speaker, region: d.region }))
    const oddProxy = descriptor({ sources: [{ ...descriptor().sources[0]!, frame: { w: 304, h: 540 } }] })
    expect(drawnSpeakerRegions(odd, undefined, oddProxy)).toEqual([])
  })

  it("never judges a camera the tracks have no row for, nor a lone row on its camera (one speaker gets no default box)", () => {
    const onCamB = thirds(9 / 16).map((r) => ({ ...r, source: "mic-cam" }))
    expect(drawnSpeakerRegions(onCamB, undefined, descriptor())).toEqual(onCamB)
    const [host] = thirds(9 / 16)
    expect(drawnSpeakerRegions([host], undefined, descriptor())).toEqual([host])
    expect(drawnSpeakerRegions(thirds(9 / 16), undefined)).toEqual(thirds(9 / 16))
  })

  it("never fetches the body nor labels a track for unmarked default thirds, and the basis agrees at rest and on a run", async () => {
    let fetched = 0
    const deps = { loadFramesJob: async () => null, readTrackBody: async () => { fetched++; return body() } }
    const input = { tracks: descriptor(), data: { speakerRegions: thirds(9 / 16) } }
    const run = await resolveSpeakerViewTracksForRun(input, deps)
    expect(fetched).toBe(0)
    expect(run!.basis!.drawn).toEqual([])
    expect(speakerViewTracksAtRest(input)!.basis).toEqual(run!.basis)
  })
})

describe("speakerViewTracksNeedBody", () => {
  it("is true only when an unattributed, uncorrected track sits on a camera with a drawn region", () => {
    expect(speakerViewTracksNeedBody(descriptor(), [LEFT])).toBe(true)
    expect(speakerViewTracksNeedBody(descriptor(), [])).toBe(false)
    expect(speakerViewTracksNeedBody(descriptor(), [{ ...LEFT, source: "camB" }])).toBe(false)
    expect(speakerViewTracksNeedBody(descriptor(), [LEFT], [{ trackId: "wide/t2", speaker: "Guest" }])).toBe(false)
  })
})

describe("speakerViewTrackedWire (P3-10)", () => {
  it("sends nothing without tracks, whatever motion the node holds", () => {
    expect(speakerViewTrackedWire(undefined, "glide")).toEqual({})
  })
  it("defaults to glide when tracks are wired and nothing is set", () => {
    expect(SPEAKER_VIEW_TRACKED_DEFAULT_MOTION).toBe("glide")
    expect(speakerViewTrackedWire(descriptor(), undefined)).toEqual({ tracks: descriptor(), motion: "glide" })
  })
  it("keeps a chosen motion, and passes an unknown one through for the rule to refuse", () => {
    expect(speakerViewTrackedWire(descriptor(), "static").motion).toBe("static")
    expect(speakerViewTrackedWire(descriptor(), "zoomy").motion).toBe("zoomy")
  })
})

describe("the render basis", () => {
  const settings = { layout: "auto" }
  it("is unchanged for a render without tracks", () => {
    expect(speakerViewRenderBasis(settings, edl())).toBe(speakerViewRenderBasis(settings, edl(), undefined))
  })
  it("changes with the motion, the labels and the drawn regions, never with the region labels the body yields", () => {
    const base = speakerViewTrackedBasis(descriptor(), "glide", [LEFT])
    const a = speakerViewRenderBasis(settings, edl(), base)
    expect(speakerViewRenderBasis(settings, edl(), speakerViewTrackedBasis(descriptor(), "static", [LEFT]))).not.toBe(a)
    expect(speakerViewRenderBasis(settings, edl(), speakerViewTrackedBasis(descriptor(), "glide", [LEFT, RIGHT]))).not.toBe(a)
    const relabelled = labelSpeakerViewTracks(descriptor(), { trackAssignments: [{ trackId: "wide/t2", speaker: "Guest" }] }).descriptor
    expect(speakerViewRenderBasis(settings, edl(), speakerViewTrackedBasis(relabelled, "glide", [LEFT]))).not.toBe(a)
    expect(speakerViewRenderBasis(settings, edl(), speakerViewTrackedBasis(descriptor(), "glide", [LEFT]))).toBe(a)
  })
})

describe("the Speaker Frames job behind the tracks (P3-20)", () => {
  it("reads the job id from the stored track file's key", () => {
    expect(speakerFramesJobIdOfTracksUrl(descriptor().url)).toBe("11111111-2222-3333-4444-555555555555")
    expect(speakerFramesJobIdOfTracksUrl("https://x/speaker-tracks/abc.json?sig=1")).toBe("abc")
    expect(speakerFramesJobIdOfTracksUrl("https://x/videos/abc.json")).toBeUndefined()
    expect(speakerFramesJobIdOfTracksUrl(42)).toBeUndefined()
    // A malformed escape names no job (never a thrown URIError, which would fail the route or the run instead of refusing).
    expect(speakerFramesJobIdOfTracksUrl("https://x/speaker-tracks/%E0%A4%A.json")).toBeUndefined()
  })

  it("lists the cameras the job sampled with their file and offset — one edit, a pack, or a bare video", () => {
    expect(speakerFramesSampledSources({ edl: edl() })).toEqual([
      { id: "mic", url: MIC.url, offsetMs: 0 },
      { id: "wide", url: WIDE.url, offsetMs: 0 },
      { id: "camB", url: CAM_B.url, offsetMs: 4_000 },
    ])
    expect(speakerFramesSampledSources({ edl: [edl(), edl()] })?.length).toBe(3)
    expect(speakerFramesSampledSources({ edl: JSON.stringify(edl()) })?.length).toBe(3)
    expect(speakerFramesSampledSources({ videoUrl: "https://x/v.mp4" })).toEqual([{ id: "video", url: "https://x/v.mp4", offsetMs: 0 }])
    expect(speakerFramesSampledSources({})).toBeUndefined()
  })

  it("passes when every tracked camera is the file and offset Speaker Frames sampled", () => {
    expect(speakerViewTracksProvenanceIssues(edl(), descriptor(), speakerFramesSampledSources({ edl: edl() })!, new Set(["wide", "camB"]))).toEqual([])
  })

  it("refuses a camera whose file changed since Speaker Frames ran", () => {
    const moved = edl({ sources: [MIC, { ...WIDE, url: "https://x/wide-v2.mp4" }, CAM_B] })
    expect(speakerViewTracksProvenanceIssues(moved, descriptor(), speakerFramesSampledSources({ edl: edl() })!, new Set(["wide", "camB"]))).toEqual([
      `Face tracks for "wide" were made from a different file — re-run Speaker Frames on this edit.`,
    ])
  })

  it("refuses a camera whose offset changed since Speaker Frames ran", () => {
    const shifted = edl({ sources: [MIC, WIDE, { ...CAM_B, offsetMs: 4_500 }] })
    expect(speakerViewTracksProvenanceIssues(shifted, descriptor(), speakerFramesSampledSources({ edl: edl() })!, new Set(["wide", "camB"]))).toEqual([
      `Face tracks for "camB" were made with the camera at offset 4000 ms; it is now at 4500 ms — re-run Speaker Frames on this edit.`,
    ])
  })

  it("refuses tracks with no Speaker Frames run of this account behind them", () => {
    expect(speakerViewTracksProvenanceIssues(edl(), descriptor(), null, new Set())).toEqual([
      "These face tracks are not from a Speaker Frames run on this account — wire Speaker Frames' Face tracks output into Speaker View.",
    ])
  })
})

describe("findSpeakerViewIssues with tracks", () => {
  const run = (over: { tracks?: unknown; motion?: unknown; speakerRegions?: unknown; edl?: Edl; provenance?: Parameters<typeof findSpeakerViewIssues>[0]["tracksProvenance"] }) =>
    findSpeakerViewIssues({
      edl: over.edl ?? edl(),
      settings: { ...(over.tracks !== undefined ? { tracks: over.tracks } : {}), ...(over.motion !== undefined ? { motion: over.motion } : {}), ...(over.speakerRegions ? { speakerRegions: over.speakerRegions } : {}) },
      ...(over.provenance !== undefined ? { tracksProvenance: over.provenance } : {}),
    })
  const renamed = () => labelSpeakerViewTracks(descriptor(), { transcript: RENAMED }).descriptor

  it("passes well-formed tracks in the edit's name space", () => {
    const v = run({ tracks: renamed(), motion: "glide" })
    expect(v.issues).toEqual([])
    expect(v.ok).toBe(true)
  })

  it("refuses a motion it does not draw, as the plugin does (unsupported_setting)", () => {
    const v = run({ tracks: renamed(), motion: "bounce" })
    expect(v.issues[0]).toMatchObject({ code: "setting", refusal: "unsupported_setting", message: 'motion "bounce" is not "static" or "glide".' })
  })

  it("never reads motion without tracks (v1 exactly)", () => {
    expect(run({ motion: "bounce" }).ok).toBe(true)
  })

  it("refuses a box body sent inline", () => {
    const v = run({ tracks: body() })
    expect(v.issues[0]).toMatchObject({ code: "tracks", refusal: "invalid_tracks", message: "`tracks` must be Speaker Frames' output descriptor (url, sha256, bytes) — the box body is never sent inline." })
  })

  it("refuses tracks that are not one descriptor", () => {
    expect(run({ tracks: [descriptor()] }).issues[0]).toMatchObject({ code: "tracks", message: "`tracks` must be one face-track descriptor (Speaker Frames' output)." })
  })

  it("refuses tracks labelled in another name space (§4), naming both", () => {
    const v = run({ tracks: descriptor({ sources: [{ ...descriptor().sources[0]!, tracks: [{ id: "wide/t1", speaker: "SPEAKER_00", boxCount: 2 }] }] }) })
    expect(v.issues[0]?.code).toBe("tracks")
    expect(v.issues[0]?.message).toContain('the tracks are labelled "SPEAKER_00" and the edit uses "Guest", "Host"')
  })

  it("refuses a followed camera the tracks have a row for but never sampled where the edit reads it", () => {
    const bare = descriptor({ sources: [{ ...descriptor().sources[1]!, sampledSpans: [{ startMs: 60_000, endMs: 70_000 }] }] })
    const v = run({ tracks: bare })
    expect(v.issues[0]).toMatchObject({ code: "tracks", refusal: "invalid_tracks", message: 'Face tracks don\'t cover "camB" — re-run Speaker Frames on this edit.' })
  })

  it("never refuses a camera the tracks have no row for (unticked in Speaker Frames)", () => {
    const wideOnly = labelSpeakerViewTracks(descriptor({ sources: [descriptor().sources[0]!] }), { transcript: RENAMED }).descriptor
    expect(run({ tracks: wideOnly }).ok).toBe(true)
  })

  it("never refuses a slot pinned by its own region", () => {
    const pinned = edl({
      segments: [
        { id: "s0", inMs: 0, outMs: 10_000, video: "wide", speaker: "Host", audio: "mic" },
        { id: "s2", inMs: 20_000, outMs: 30_000, video: "camB", speaker: "Host", audio: "mic", region: { x: 0, y: 0, w: 0.5, h: 1 } },
      ] as Edl["segments"],
    })
    const bare = labelSpeakerViewTracks(descriptor({ sources: [descriptor().sources[0]!, { ...descriptor().sources[1]!, sampledSpans: [{ startMs: 60_000, endMs: 70_000 }] }] }), { transcript: RENAMED }).descriptor
    expect(run({ edl: pinned, tracks: bare }).ok).toBe(true)
  })

  it("notes a slot whose on-screen time is under 60 % sampled", () => {
    const v = run({ tracks: renamed() })
    // camB is read at source 16–26 s; sampled 14–28 s → 100 %. wide's Guest turn is read at 10–20 s, sampled to 22 s → 100 %.
    expect(v.notes.filter((n) => n.includes("tracked"))).toEqual([])
    const thin = labelSpeakerViewTracks(descriptor({ sources: [{ ...descriptor().sources[0]!, sampledSpans: [{ startMs: 0, endMs: 4_000 }] }, descriptor().sources[1]!] }), { transcript: RENAMED }).descriptor
    expect(run({ tracks: thin }).notes).toEqual(
      expect.arrayContaining([`"Host" on "wide": tracked 40 % — the rest uses the static framing`, `"Guest" on "wide": tracked 0 % — the rest uses the static framing`]),
    )
  })

  it("adds the app's own P3-20 check after the plugin's: a changed file refuses", () => {
    const v = run({ tracks: renamed(), provenance: { sources: [{ id: "wide", url: "https://x/old.mp4", offsetMs: 0 }, { id: "camB", url: CAM_B.url, offsetMs: 4_000 }] } })
    expect(v.issues).toEqual([{ code: "tracks", refusal: "invalid_tracks", message: `Face tracks for "wide" were made from a different file — re-run Speaker Frames on this edit.` }])
  })

  it("refuses when no Speaker Frames run is behind the tracks (provenance null)", () => {
    expect(run({ tracks: renamed(), provenance: null }).issues[0]?.code).toBe("tracks")
  })
})

describe("one funnel: the tracks a run sends (resolveSpeakerViewTracksForRun)", () => {
  const JOB_ID = "11111111-2222-3333-4444-555555555555"
  const framesJob = { input_data: { edl: edl() }, output_data: { json: descriptor() } }
  const deps = (over: Partial<Parameters<typeof resolveSpeakerViewTracksForRun>[1]> = {}) => {
    const calls = { load: [] as string[], body: 0 }
    return {
      calls,
      deps: {
        loadFramesJob: async (id: string) => { calls.load.push(id); return id === JOB_ID ? framesJob : null },
        readTrackBody: async () => { calls.body++; return body() },
        ...over,
      },
    }
  }

  it("is undefined when nothing is wired", async () => {
    expect(await resolveSpeakerViewTracksForRun({ tracks: undefined, data: {} }, deps().deps)).toBeUndefined()
    expect(await resolveSpeakerViewTracksForRun({ tracks: "", data: { motion: "glide" } }, deps().deps)).toBeUndefined()
  })

  it("labels by the rename map and the corrections, and finds the job's sources by the file's key", async () => {
    const d = deps()
    const out = await resolveSpeakerViewTracksForRun({ tracks: JSON.stringify(descriptor()), transcript: RENAMED, trackAssignments: [{ trackId: "camB/t1", speaker: null }], data: { motion: "static" } }, d.deps)
    const sent = out!.tracks as SpeakerTrackSetDescriptor
    expect(speakerOf(sent, "wide/t1")?.speaker).toBe("Host")
    expect(speakerOf(sent, "camB/t1")?.speaker).toBeUndefined()
    expect(out!.motion).toBe("static")
    expect(out!.provenance).toEqual({ sources: speakerFramesSampledSources({ edl: edl() }) })
    expect(d.calls).toEqual({ load: [JOB_ID], body: 0 })
  })

  it("fetches the body only when a drawn region can label a track, and labels it", async () => {
    const d = deps()
    const out = await resolveSpeakerViewTracksForRun({ tracks: descriptor(), data: { speakerRegions: [LEFT, RIGHT] } }, d.deps)
    expect(d.calls.body).toBe(1)
    expect(speakerOf(out!.tracks as SpeakerTrackSetDescriptor, "wide/t2")?.speaker).toBe("Guest")
    expect(out!.notes).toContain('track "wide/t2" on "wide": labelled "Guest" by its drawn region')
  })

  it("never fetches the body for default thirds, which never label", async () => {
    const d = deps()
    const keys = [speakerRegionKey("wide", "Host"), speakerRegionKey("wide", "Guest")]
    const out = await resolveSpeakerViewTracksForRun({ tracks: descriptor(), data: { speakerRegions: [LEFT, RIGHT], defaultRegionKeys: keys } }, d.deps)
    expect(d.calls.body).toBe(0)
    expect(speakerOf(out!.tracks as SpeakerTrackSetDescriptor, "wide/t2")?.speaker).toBeUndefined()
  })

  it("gives no provenance (a refusal) when no job of this account made this very file", async () => {
    expect((await resolveSpeakerViewTracksForRun({ tracks: descriptor({ url: "https://x/elsewhere/t.json" }), data: {} }, deps().deps))!.provenance).toBeNull()
    expect((await resolveSpeakerViewTracksForRun({ tracks: descriptor({ sha256: "b".repeat(64) }), data: {} }, deps().deps))!.provenance).toBeNull()
    const other = deps({ loadFramesJob: async () => null })
    expect((await resolveSpeakerViewTracksForRun({ tracks: descriptor(), data: {} }, other.deps))!.provenance).toBeNull()
  })

  it("passes a value that is no descriptor through as given, for the rule to refuse by name", async () => {
    const out = await resolveSpeakerViewTracksForRun({ tracks: [descriptor()], data: {} }, deps().deps)
    expect(out).toEqual({ tracks: [descriptor()], motion: undefined, notes: [] })
  })

  it("has the same render basis at rest (the badge, the review) as on a run", async () => {
    const input = { tracks: descriptor(), transcript: RENAMED, data: { motion: "glide", speakerRegions: [LEFT, RIGHT] } }
    const run = await resolveSpeakerViewTracksForRun(input, deps().deps)
    expect(speakerViewTracksAtRest(input)!.basis).toEqual(run!.basis)
  })
})

describe("the normalizer and motion", () => {
  it("drops an unknown motion and keeps a known one, tracks or not", () => {
    expect(normalizeSpeakerViewData({ motion: "bounce" }).data).toEqual({})
    expect(normalizeSpeakerViewData({ motion: "static" }).data).toEqual({ motion: "static" })
  })
})

describe("a correction follows a later rename (P3-4: trackAssignments keyed by track id, the speaker resolved through the current rename map)", () => {
  const ALICE = { ...RENAMED, speakerNames: { SPEAKER_00: "Alice", SPEAKER_01: "Guest" } }

  it("saves the raw label beside the name a person picked", () => {
    expect(speakerTrackAssignmentFor("wide/t2", "Host", RENAMED)).toEqual({ trackId: "wide/t2", speaker: "Host", rawSpeaker: "SPEAKER_00" })
    expect(speakerTrackAssignmentFor("wide/t2", "Host", JSON.stringify(RENAMED))).toEqual({ trackId: "wide/t2", speaker: "Host", rawSpeaker: "SPEAKER_00" })
  })

  it("takes a name no rename map renames as its own raw label", () => {
    expect(speakerTrackAssignmentFor("wide/t2", "SPEAKER_02", RENAMED)).toEqual({ trackId: "wide/t2", speaker: "SPEAKER_02", rawSpeaker: "SPEAKER_02" })
    expect(speakerTrackAssignmentFor("wide/t2", "SPEAKER_00", undefined)).toEqual({ trackId: "wide/t2", speaker: "SPEAKER_00", rawSpeaker: "SPEAKER_00" })
  })

  it("records no raw label when two raw labels share the name (it cannot know which)", () => {
    const merged = { ...RENAMED, speakerNames: { SPEAKER_00: "Host", SPEAKER_02: "Host" } }
    expect(speakerTrackAssignmentFor("wide/t2", "Host", merged)).toEqual({ trackId: "wide/t2", speaker: "Host" })
  })

  it("never gives Nobody a raw label", () => {
    expect(speakerTrackAssignmentFor("wide/t2", null, RENAMED)).toEqual({ trackId: "wide/t2", speaker: null })
  })

  it("keeps the raw label when the corrections are read back", () => {
    expect(speakerTrackAssignmentsOf([{ trackId: "wide/t2", speaker: "Host", rawSpeaker: "SPEAKER_00" }, { trackId: "x", speaker: "Guest", rawSpeaker: 3 }])).toEqual([
      { trackId: "wide/t2", speaker: "Host", rawSpeaker: "SPEAKER_00" },
      { trackId: "x", speaker: "Guest" },
    ])
  })

  it("re-maps a correction when its speaker is renamed after it was made", () => {
    const correction = speakerTrackAssignmentFor("wide/t2", "Host", RENAMED)
    const { descriptor: d } = labelSpeakerViewTracks(descriptor(), { transcript: ALICE, trackAssignments: [correction] })
    expect(speakerOf(d, "wide/t2")).toMatchObject({ speaker: "Alice", attribution: { method: "manual" } })
    // The auto-labelled track follows the same rename, so the two agree.
    expect(speakerOf(d, "wide/t1")?.speaker).toBe("Alice")
  })

  it("leaves the renamed correction inside the edit's name space (no warning, no orphan)", () => {
    const correction = speakerTrackAssignmentFor("wide/t2", "Host", RENAMED)
    const tracks = labelSpeakerViewTracks(descriptor({ sources: [descriptor().sources[0]!] }), { transcript: ALICE, trackAssignments: [correction] }).descriptor
    const renamedEdl = edl({
      sources: [MIC, { ...WIDE, speakers: ["Alice", "Guest"] }, CAM_B],
      segments: [
        { id: "s0", inMs: 0, outMs: 10_000, video: "wide", speaker: "Alice", audio: "mic" },
        { id: "s1", inMs: 10_000, outMs: 20_000, video: "wide", speaker: "Guest", audio: "mic" },
      ] as Edl["segments"],
    })
    const v = findSpeakerViewIssues({ edl: renamedEdl, settings: { tracks } })
    expect(v.issues).toEqual([])
    expect(v.notes.filter((n) => n.includes("Host"))).toEqual([])
  })

  it("keeps a correction saved without a raw label (before this) as it was written", () => {
    const { descriptor: d } = labelSpeakerViewTracks(descriptor(), { transcript: ALICE, trackAssignments: [{ trackId: "wide/t2", speaker: "Host" }] })
    expect(speakerOf(d, "wide/t2")?.speaker).toBe("Host")
  })

  it("lists an unmatched correction under the name it resolves to today", () => {
    const out = labelSpeakerViewTracks(descriptor(), { transcript: ALICE, trackAssignments: [{ trackId: "wide/t9", speaker: "Host", rawSpeaker: "SPEAKER_00" }] })
    expect(out.unmatched).toEqual([{ trackId: "wide/t9", speaker: "Alice", rawSpeaker: "SPEAKER_00" }])
  })
})

describe("tracks wired, but Speaker Frames has no output (§5: never a silent v1 render)", () => {
  it("is v1 exactly when nothing is wired", () => {
    expect(speakerViewTracksAtRest({ tracks: undefined, data: {} })).toBeUndefined()
    expect(speakerViewTracksAtRest({ tracks: undefined, wired: false, data: {} })).toBeUndefined()
  })

  it("is marked unproduced when the wire holds nothing", async () => {
    for (const tracks of [undefined, null, ""]) {
      expect(speakerViewTracksAtRest({ tracks, wired: true, data: { motion: "glide" } })).toEqual({ tracks: undefined, motion: "glide", notes: [], unproduced: true })
      expect(await resolveSpeakerViewTracksForRun({ tracks, wired: true, data: {} }, { loadFramesJob: async () => null, readTrackBody: async () => body() })).toMatchObject({ unproduced: true })
    }
  })

  it("is refused by the rule before anything is reserved, in the rule's own words", () => {
    const rule = speakerViewTrackedRuleInput(speakerViewTracksAtRest({ tracks: "", wired: true, data: {} }))
    expect(rule.wire).toEqual({})
    const v = findSpeakerViewIssues({ edl: edl(), settings: { ...rule.wire }, ...rule.rule })
    expect(v.ok).toBe(false)
    expect(v.issues).toEqual([{ code: "tracks", refusal: "invalid_tracks", message: SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE }])
  })

  it("adds nothing to the rule for a render without tracks", () => {
    expect(speakerViewTrackedRuleInput(undefined)).toEqual({ wire: {}, rule: {} })
  })

  it("carries the descriptor, the motion and the provenance of a tracked run", async () => {
    const framesJob = { input_data: { edl: edl() }, output_data: { json: descriptor() } }
    const tracked = await resolveSpeakerViewTracksForRun({ tracks: descriptor(), wired: true, data: { motion: "static" } }, { loadFramesJob: async () => framesJob, readTrackBody: async () => body() })
    const rule = speakerViewTrackedRuleInput(tracked)
    expect(rule.wire).toEqual({ tracks: tracked!.tracks, motion: "static" })
    expect(rule.rule).toEqual({ tracksProvenance: { sources: speakerFramesSampledSources({ edl: edl() }) } })
  })
})

describe("motion as the normalizer keeps it (the run sends what the panel shows)", () => {
  it("drops an unknown motion, so a tracked run glides — at rest and on a run", async () => {
    const atRest = speakerViewTracksAtRest({ tracks: descriptor(), data: { motion: "bounce" } })
    expect(atRest!.motion).toBeUndefined()
    expect(speakerViewTrackedWire(atRest!.tracks, atRest!.motion).motion).toBe("glide")
    const run = await resolveSpeakerViewTracksForRun({ tracks: descriptor(), data: { motion: "bounce" } }, { loadFramesJob: async () => null, readTrackBody: async () => body() })
    expect(run!.motion).toBeUndefined()
    expect(run!.basis).toEqual(speakerViewTracksAtRest({ tracks: descriptor(), data: {} })!.basis)
  })

  it("keeps a known motion", () => {
    expect(speakerViewTracksAtRest({ tracks: descriptor(), data: { motion: "static" } })!.motion).toBe("static")
  })
})

describe("P3-20's file-and-offset check reads only the cameras a non-pinned slot follows", () => {
  const wideOnly = edl({
    segments: [
      { id: "s0", inMs: 0, outMs: 10_000, video: "wide", speaker: "Host", audio: "mic" },
      { id: "s1", inMs: 10_000, outMs: 20_000, video: "wide", speaker: "Guest", audio: "mic" },
    ] as Edl["segments"],
  })
  const tracks = () => labelSpeakerViewTracks(descriptor(), { transcript: RENAMED }).descriptor

  it("never refuses a camera the edit lists but no segment shows", () => {
    const sampled = { sources: [{ id: "wide", url: WIDE.url, offsetMs: 0 }, { id: "camB", url: CAM_B.url, offsetMs: 9_999 }] }
    expect(findSpeakerViewIssues({ edl: wideOnly, settings: { tracks: tracks() }, tracksProvenance: sampled }).issues).toEqual([])
  })

  it("still refuses a camera the render reads", () => {
    const sampled = { sources: [{ id: "wide", url: "https://x/old.mp4", offsetMs: 0 }, { id: "camB", url: CAM_B.url, offsetMs: 4_000 }] }
    expect(findSpeakerViewIssues({ edl: wideOnly, settings: { tracks: tracks() }, tracksProvenance: sampled }).issues[0]?.message).toBe(
      `Face tracks for "wide" were made from a different file — re-run Speaker Frames on this edit.`,
    )
  })

  // Decided 2026-10-10: the check covers only cameras a non-pinned slot
  // follows, the same scope as the no-coverage refusal.
  it("never refuses a camera that only region-pinned slots show (its tracks are not used)", () => {
    const pinned = edl({
      segments: [
        { id: "s0", inMs: 0, outMs: 10_000, video: "wide", speaker: "Host", audio: "mic" },
        { id: "s2", inMs: 20_000, outMs: 30_000, video: "camB", speaker: "Host", audio: "mic", region: { x: 0, y: 0, w: 0.5, h: 1 } },
      ] as Edl["segments"],
    })
    const camBMoved = { sources: [{ id: "wide", url: WIDE.url, offsetMs: 0 }, { id: "camB", url: CAM_B.url, offsetMs: 9_999 }] }
    expect(findSpeakerViewIssues({ edl: pinned, settings: { tracks: tracks() }, tracksProvenance: camBMoved }).issues).toEqual([])
    const wideMoved = { sources: [{ id: "wide", url: "https://x/old.mp4", offsetMs: 0 }, { id: "camB", url: CAM_B.url, offsetMs: 9_999 }] }
    expect(findSpeakerViewIssues({ edl: pinned, settings: { tracks: tracks() }, tracksProvenance: wideMoved }).issues[0]?.message).toBe(
      `Face tracks for "wide" were made from a different file — re-run Speaker Frames on this edit.`,
    )
  })

  it("names the followed cameras for a caller that checks outside the rule (the self-host route)", () => {
    const pinned = edl({
      segments: [
        { id: "s0", inMs: 0, outMs: 10_000, video: "wide", speaker: "Host", audio: "mic" },
        { id: "s2", inMs: 20_000, outMs: 30_000, video: "camB", speaker: "Host", audio: "mic", region: { x: 0, y: 0, w: 0.5, h: 1 } },
      ] as Edl["segments"],
    })
    expect([...speakerViewFollowedTrackCameras({ edl: pinned, settings: { tracks: tracks() } })!]).toEqual(["wide"])
    expect([...speakerViewFollowedTrackCameras({ edl: edl(), settings: { tracks: tracks() } })!].sort()).toEqual(["camB", "wide"])
    expect(speakerViewFollowedTrackCameras({ edl: "not an edit", settings: { tracks: tracks() } })).toBeUndefined()
  })

  it("the bare check reads only the cameras it is given (none for an edit that cannot be laid out)", () => {
    const sampled = [{ id: "wide", url: WIDE.url, offsetMs: 0 }, { id: "camB", url: "https://x/other.mp4", offsetMs: 4_000 }]
    expect(speakerViewTracksProvenanceIssues(edl(), descriptor(), sampled, new Set(["wide"]))).toEqual([])
    expect(speakerViewTracksProvenanceIssues(edl(), descriptor(), sampled, new Set(["wide", "camB"])).length).toBe(1)
    expect(speakerViewTracksProvenanceIssues(edl(), descriptor(), sampled, new Set())).toEqual([])
  })
})
