/**
 * Whether a use-case node's failed attempt may be resumed: its stored settings
 * against what the node resolves to now (failed-attempt.ts). Compared setting
 * by setting, so a deploy that adds a setting does not make every older
 * attempt differ (and re-run, re-billing its paid steps), while a changed,
 * removed or non-default new setting still runs the node fresh.
 */
import { describe, expect, it } from "vitest"
import { SPEAKER_FRAMES_PRICED, USE_CASE_DESCRIPTORS, usecaseDescriptor, type UseCaseNodeType } from "@nodaro/render-rules"
import { attemptMediaKind, attemptRanWithInputs, settingsUnchanged } from "../failed-attempt.js"
import { freshRunInputs } from "../use-case-request.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"

const MEDIA = "https://r2/ep.mp4"

describe("settingsUnchanged", () => {
  const defaults = { a: 1, b: "x", added: false }

  it("the same settings, keys in another order: unchanged", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { b: "x", a: 1 }, defaults)).toBe(true)
  })

  it("a stored setting that holds another value now: changed", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { a: 2, b: "x" }, defaults)).toBe(false)
  })

  it("a setting added since the attempt, at its default: unchanged", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { a: 1, b: "x", added: false }, defaults)).toBe(true)
  })

  it("a setting added since the attempt, set away from its default: changed", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { a: 1, b: "x", added: true }, defaults)).toBe(false)
  })

  it("a setting the attempt stored that no longer exists: changed (what it made with it cannot be told)", () => {
    expect(settingsUnchanged({ a: 1, b: "x", gone: 3 }, { a: 1, b: "x" }, defaults)).toBe(false)
  })

  it("nested values are compared whole, key order ignored", () => {
    expect(settingsUnchanged({ f: { aspect: "9:16", layout: "grid" } }, { f: { layout: "grid", aspect: "9:16" } }, {})).toBe(true)
    expect(settingsUnchanged({ f: { aspect: "9:16", layout: "grid" } }, { f: { aspect: "9:16", layout: "single" } }, {})).toBe(false)
  })

  it("null is a value (a framing of None), undefined is absent", () => {
    expect(settingsUnchanged({ f: null }, { f: null }, {})).toBe(true)
    expect(settingsUnchanged({ f: null, u: undefined }, { f: null }, {})).toBe(true)
    expect(settingsUnchanged({ f: null }, { f: { aspect: "9:16", layout: "grid" } }, {})).toBe(false)
  })
})

describe("attemptRanWithInputs: settings across a change of the resolver's key set", () => {
  const type: UseCaseNodeType = "tighten-episode"
  const d = usecaseDescriptor(type)
  const resolved = d.resolveSettings({}, "video") as Record<string, unknown>
  const now = (data: Record<string, unknown> = {}) => ({ mediaUrls: [MEDIA], ...data })

  it("an attempt stored before a setting existed resumes while the node leaves it at its default", () => {
    // The attempt's wrapper as an older deploy wrote it: one setting fewer.
    const { musicDuckAmount: _added, ...older } = resolved
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: older }, "video", now())).toBe(true)
  })

  it("…and runs fresh once the node sets that setting away from its default", () => {
    const { musicDuckAmount: _added, ...older } = resolved
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: older }, "video", now({ musicDuckAmount: 20 }))).toBe(false)
  })

  it("an attempt that stored a setting the resolver no longer makes runs fresh", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: { ...resolved, retired: 1 } }, "video", now())).toBe(false)
  })

  it("an attempt with no stored settings runs fresh", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA }, "video", now())).toBe(false)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: null }, "video", now())).toBe(false)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: [] }, "video", now())).toBe(false)
  })

  it("the same settings resume; a changed one runs fresh", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: resolved }, "video", now())).toBe(true)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: resolved }, "video", now({ planTier: "premium" }))).toBe(false)
  })

  it("another recording runs fresh whatever the settings", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: "https://r2/other.mp4", settings: resolved }, "video", now())).toBe(false)
  })
})

/**
 * A run on several recordings or a Master audio (decided 2026-10-18): its
 * wrapper records every recording in order, the master and the run's kind;
 * the attempt resumes only when every one of them, and the Cameras settings
 * read for that shape, are the node's now.
 */
for (const type of ["tighten-episode", "episode-trailer", "clip-pack"] as const satisfies readonly UseCaseNodeType[]) describe(`attemptRanWithInputs (${type}): several recordings, a Master audio, the Cameras settings`, () => {
  const d = usecaseDescriptor(type)
  const A = "https://r2/a.mp4", B = "https://r2/b.mp4", C = "https://r2/c.mp4", M = "https://r2/m.wav"
  const ranOn = (mediaUrls: string[], cameras: Record<string, unknown>, master?: string) => {
    const shape = { recordings: mediaUrls.length, masterAudio: !!master }
    return {
      mediaUrl: mediaUrls[0],
      mediaUrls,
      ...(master ? { masterAudioUrl: master } : {}),
      mediaKind: "video",
      settings: d.resolveSettings({ cameras }, "video", shape),
    }
  }
  const ran = ranOn([A, B, C], { wide: 3 }, M)

  it("the same recordings, master and cameras: resumed", () => {
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B, C], masterAudioUrl: M, cameras: { wide: 3 } })).toBe(true)
  })
  it("the recordings in another order: fresh", () => {
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [B, A, C], masterAudioUrl: M, cameras: { wide: 3 } })).toBe(false)
  })
  it("a recording more or fewer: fresh", () => {
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B], masterAudioUrl: M, cameras: { wide: 3 } })).toBe(false)
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B, C, "https://r2/d.mp4"], masterAudioUrl: M, cameras: { wide: 3 } })).toBe(false)
  })
  it("another master, or none: fresh", () => {
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B, C], masterAudioUrl: "https://r2/other.wav", cameras: { wide: 3 } })).toBe(false)
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B, C], cameras: { wide: 3 } })).toBe(false)
  })
  it("another wide, already in sync, or an override of who is on which camera: fresh (the Cameras settings are read for the run's shape)", () => {
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B, C], masterAudioUrl: M, cameras: { wide: 2 } })).toBe(false)
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B, C], masterAudioUrl: M, cameras: { wide: 3, synced: true } })).toBe(false)
    expect(attemptRanWithInputs(type, ran, "video", { mediaUrls: [A, B, C], masterAudioUrl: M, cameras: { wide: 3, speakerCameras: { "1": 2 } } })).toBe(false)
  })
  it("a row from before several recordings (its mediaUrl alone) still resumes on that one recording", () => {
    const older = { mediaUrl: A, settings: d.resolveSettings({}, "video") }
    expect(attemptRanWithInputs(type, older, "video", { mediaUrls: [A] })).toBe(true)
    // …and not once the node reads a second recording.
    expect(attemptRanWithInputs(type, older, "video", { mediaUrls: [A, B] })).toBe(false)
  })
})

describe("attemptMediaKind", () => {
  const graph = (sourceType: string) => ({ nodeType: "tighten-episode", nodes: [{ id: "uc-source", type: sourceType }] }) as never
  it("a run on several recordings or a master is the kind its wrapper recorded (a graph that kept only its sound cannot tell)", () => {
    expect(attemptMediaKind("tighten-episode", graph("upload-audio"), { mediaKind: "video" })).toBe("video")
  })
  it("otherwise read off the stored source node, as before", () => {
    expect(attemptMediaKind("tighten-episode", graph("upload-audio"), { mediaUrl: MEDIA })).toBe("audio")
    expect(attemptMediaKind("tighten-episode", graph("upload-video"))).toBe("video")
    expect(attemptMediaKind("episode-chapters", graph("upload-video"), { mediaKind: "video" })).toBeNull()
  })
})

/**
 * The guard: every use-case type's resolver makes exactly these settings — on
 * one recording (PINNED_SETTING_KEYS) and, for a type that takes several, on
 * several recordings or a Master audio (PINNED_MULTICAM_SETTING_KEYS: the
 * Cameras settings are resolved only then, decided 2026-10-17). Its
 * `settingKeys` are the union of the two.
 *
 * A failed attempt stored before a setting existed is resumed while the node
 * holds that setting's DEFAULT (settingsUnchanged above). That is only right
 * when the default (for any values of the settings and inputs it reads) is the behaviour
 * the code had before the setting existed —
 * so a new setting, or a removed one, is a decision: make its default the old
 * behaviour (or accept that older attempts with it set run fresh), then add it
 * here and to the type's `settingKeys`.
 */
const PINNED_SETTING_KEYS: Readonly<Record<UseCaseNodeType, readonly string[]>> = {
  "tighten-episode": [
    "captionStyle",
    "captions",
    "framing",
    "instructions",
    "musicDuckAmount",
    "output",
    "planTier",
    "reviewBeforeRender",
    "styleGuide",
  ],
  "episode-chapters": ["instructions", "planTier", "styleGuide"],
  "episode-trailer": ["formats", "instructions", "planTier", "reviewBeforeRender", "styleGuide"],
  "clip-pack": [
    "captionStyle",
    "captions",
    "count",
    "framing",
    "instructions",
    "planTier",
    "reviewBeforeRender",
    "styleGuide",
    "targetDurationSec",
  ],
}

/** The settings a type that takes several recordings makes for several (or a Master audio): one recording's, plus the Cameras settings. */
const PINNED_MULTICAM_SETTING_KEYS: Readonly<Partial<Record<UseCaseNodeType, readonly string[]>>> = {
  "tighten-episode": [...PINNED_SETTING_KEYS["tighten-episode"], "cameras"],
  "episode-trailer": [...PINNED_SETTING_KEYS["episode-trailer"], "cameras"],
  "clip-pack": [...PINNED_SETTING_KEYS["clip-pack"], "cameras"],
}

/**
 * Settings a resolver makes only when they differ from the behaviour before
 * they existed (omitted otherwise, so a stored attempt's settings read as they
 * always did): each with the raw settings that make it appear. Tighten's
 * `framingSource` (decided 2026-10-17) appears only when a framed video
 * episode follows faces; absent is the even split, as before it existed.
 */
const PINNED_OMITTED_AT_DEFAULT: Readonly<Partial<Record<UseCaseNodeType, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>> = {
  "tighten-episode": { framingSource: { framing: { aspect: "9:16", layout: "stacked" }, framingSource: "tracking" } },
  // Clip Pack frames by default: following faces is the framing source alone.
  "clip-pack": { framingSource: { framingSource: "tracking" } },
}

describe("guard: the use-case resolvers' setting keys are pinned", () => {
  const types = Object.keys(USE_CASE_DESCRIPTORS) as UseCaseNodeType[]
  const changed = (type: string) =>
    `${type}'s settings changed. A failed attempt stored without a new setting is resumed while the node holds its default, ` +
    `so that default — for any values of the settings and inputs (recordings, master, music, intro card) it reads — must be the behaviour the code had before the setting existed. Decide that, then pin the new set here.`

  it("every use-case type is pinned (a new type is a decision too)", () => {
    expect(Object.keys(PINNED_SETTING_KEYS).sort()).toEqual([...types].sort())
  })
  it("exactly the types that take several recordings pin their multicam settings", () => {
    expect(Object.keys(PINNED_MULTICAM_SETTING_KEYS).sort()).toEqual(types.filter((t) => usecaseDescriptor(t).maxRecordings > 1).sort())
  })

  for (const type of types) {
    const d = usecaseDescriptor(type)
    const multicam = PINNED_MULTICAM_SETTING_KEYS[type]
    for (const kind of ["audio", "video"] as const) {
      it(`${type} (${kind} recording): its resolver makes exactly the pinned settings, and its settingKeys are every setting it makes`, () => {
        const keys = Object.keys(d.resolveSettings({}, kind)).sort()
        expect(keys, changed(type)).toEqual([...PINNED_SETTING_KEYS[type]].sort())
        // One recording resolves exactly as it did before any shape was passed.
        expect(Object.keys(d.resolveSettings({}, kind, { recordings: 1, masterAudio: false })).sort()).toEqual(keys)
        const omitted = PINNED_OMITTED_AT_DEFAULT[type] ?? {}
        expect([...d.settingKeys].sort()).toEqual([...(multicam ?? keys), ...Object.keys(omitted)].sort())
      })
    }
    for (const [key, raw] of Object.entries(PINNED_OMITTED_AT_DEFAULT[type] ?? {})) {
      it(`${type}: ${key} is made only away from the behaviour before it existed`, () => {
        expect(key in d.resolveSettings({}, "video"), changed(type)).toBe(false)
        expect(key in d.resolveSettings(raw, "video"), changed(type)).toBe(true)
      })
    }
    if (multicam) {
      for (const shape of [{ recordings: 2, masterAudio: false }, { recordings: 1, masterAudio: true }, { recordings: 6, masterAudio: false }]) {
        it(`${type} (${shape.recordings} recording(s)${shape.masterAudio ? " + Master audio" : ""}): its resolver makes exactly the pinned multicam settings`, () => {
          expect(Object.keys(d.resolveSettings({}, "video", shape)).sort(), changed(type)).toEqual([...multicam].sort())
        })
      }
    }
  }
})

/**
 * The framing source (decided 2026-10-17): an attempt stored before it existed
 * (or one that ran the even split) resumes while the node frames with the even
 * split; a node that now follows faces runs fresh (its graph has Speaker Frames).
 */
/** Each framed type's framed node data (Tighten frames when asked; Clip Pack frames by default). */
const FRAMED_DATA: ReadonlyArray<readonly [UseCaseNodeType, Readonly<Record<string, unknown>>]> = [
  ["tighten-episode", { output: "video", framing: { aspect: "9:16", layout: "stacked" } }],
  ["clip-pack", {}],
]
for (const [type, framedData] of FRAMED_DATA) describe(`attemptRanWithInputs (${type}): the framing source`, () => {
  const d = usecaseDescriptor(type)
  const stored = d.resolveSettings({ ...framedData }, "video") as Record<string, unknown>
  const now = (data: Record<string, unknown> = {}) => ({ mediaUrls: [MEDIA], ...framedData, ...data })
  it("a framed attempt that stored no framing source resumes against a node that sends none, or static", () => {
    expect("framingSource" in stored).toBe(false)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: stored }, "video", now())).toBe(true)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: stored }, "video", now({ framingSource: "static" }))).toBe(true)
  })
  it("…and runs fresh once the node follows faces", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: stored }, "video", now({ framingSource: "tracking" }))).toBe(false)
  })
  it("an attempt that followed faces resumes against tracking, and runs fresh against static", () => {
    const tracked = d.resolveSettings({ ...framedData, framingSource: "tracking" }, "video") as Record<string, unknown>
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: tracked }, "video", now({ framingSource: "tracking" }))).toBe(true)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: tracked }, "video", now({ framingSource: "static" }))).toBe(false)
  })

  // An `auto` node (the new node's default) is held to what its viewer's fresh run would send
  // (`freshRunInputs` → `usecaseFramingForViewer`, decided 2026-10-20): the resume match never reads
  // `auto` as tracking against an attempt that ran on the even split, so nobody pays again.
  describe("an auto node, held through the body its viewer's fresh run sends", () => {
    const node = { id: "t1", type, data: { label: d.label, fieldMappings: {}, ...framedData, framingSource: "auto" } } as unknown as SimpleNode
    const inputs = { useCaseMedia: [{ nodeId: "rec", url: MEDIA }] } as unknown as ResolvedInputs
    const fresh = (framesAvailable: boolean) => freshRunInputs(node, inputs, { multicam: false, framesAvailable })
    const evenSplit = d.resolveSettings({ ...framedData }, "video") as Record<string, unknown>
    const tracked = d.resolveSettings({ ...framedData, framingSource: "tracking" }, "video") as Record<string, unknown>
    it("a viewer without Speaker Frames resumes an attempt that ran on the even split", () => {
      expect(attemptRanWithInputs(type, { mediaUrls: [MEDIA], settings: evenSplit }, "video", fresh(false))).toBe(true)
    })
    it("a viewer with Speaker Frames resumes an attempt that followed faces, and runs fresh against one that did not (while it is priced)", () => {
      expect(attemptRanWithInputs(type, { mediaUrls: [MEDIA], settings: tracked }, "video", fresh(true))).toBe(SPEAKER_FRAMES_PRICED)
      expect(attemptRanWithInputs(type, { mediaUrls: [MEDIA], settings: evenSplit }, "video", fresh(true))).toBe(!SPEAKER_FRAMES_PRICED)
    })
  })
})
