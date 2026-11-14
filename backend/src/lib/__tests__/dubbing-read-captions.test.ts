import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DubbingCaptionFormat } from "@nodaro/shared/media"
import type { DubJobRow } from "../dubbing-job-store.js"

const service = vi.hoisted(() => ({
  REGULAR_SOURCE_TRANSCRIPT: "source",
  readProjectDub: vi.fn(),
  readRegularDub: vi.fn(),
  readProjectSource: vi.fn(),
  readProjectLanguageLines: vi.fn(),
  readProjectSubtitles: vi.fn(),
  readRegularTranscript: vi.fn(),
  readRegularCaptions: vi.fn(),
}))
const store = vi.hoisted(() => ({ loadDubFamily: vi.fn() }))

vi.mock("@/providers/elevenlabs/dubbing-read.js", () => service)
vi.mock("@/lib/dubbing-job-store.js", () => ({ loadDubFamily: store.loadDubFamily }))
vi.mock("@/lib/voice-policy.js", () => ({ judgeUnnamedVoices: vi.fn() }))

import { DUBBING_PROBLEMS, type DubbingProblem } from "../dubbing-problems.js"
import { readDubbingCaptions } from "../dubbing-read-service.js"

const OWNER = "owner-1"
const FIRST = "00000000-0000-4000-8000-000000000001"
const ADDED = "00000000-0000-4000-8000-000000000002"

function job(id: string, providerTaskId: string | null, language: string, extra: Partial<DubJobRow> = {}): DubJobRow {
  return {
    id,
    status: "completed",
    providerTaskId,
    input: { type: "dubbing", targetLanguage: language, videoUrl: "https://cdn.example/source.mp4", probedDurationSec: 61 },
    createdAt: "2026-11-01T10:00:00.000Z",
    ...extra,
  }
}

/** The caller's job, and the jobs of the languages added to its dub. */
function holds(anchor: DubJobRow, members: readonly DubJobRow[] = []): void {
  store.loadDubFamily.mockResolvedValue({ kind: "ok", family: { familyId: anchor.id, anchor, members } })
}

const ok = <T>(value: T) => ({ kind: "ok" as const, value })
const gone = { kind: "gone" as const }
const processing = { kind: "processing" as const }
const unsupported = { kind: "unsupported" as const, code: "not_told" }

/** The ways the dubbing service says it has nothing to read. */
const NOTHING_TO_READ = [
  { told: "gone", refusal: gone },
  { told: "not told", refusal: unsupported },
]

type HeldLanguage = readonly [id: string, code: string, status?: string]

/** A project dub whose first job delivers the language `l1`. */
function projectDub(languages: readonly HeldLanguage[] = [["l1", "he"]]): void {
  holds(job(FIRST, "project:p1:l1", "he"))
  service.readProjectDub.mockResolvedValue(
    ok({
      status: "dubbed",
      sourceLanguage: "en",
      durationSec: 120,
      languages: languages.map(([id, code, status = "completed"]) => ({ id, code, status })),
    }),
  )
}

/** A regular dub asked for `language`, which the dubbing service holds under the code `held`. */
function regularDubOf(language = "es", members: readonly DubJobRow[] = [], held = language): void {
  holds(job(FIRST, "dub_1", language), members)
  service.readRegularDub.mockResolvedValue(ok({ status: "dubbed", sourceLanguage: "en", targetLanguages: [held], durationSec: 90 }))
}

const sourceLine = { id: "s1", speakerId: "sp1", start: 0, end: 2, text: "Hello" }
const shalom = { ...sourceLine, text: "Shalom", sourceText: "Hello" }

const SRT_HELLO = "1\n00:00:00,000 --> 00:00:02,000\nHello\n"
const VTT_HELLO = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n"
const SRT_SHALOM = "1\n00:00:00,000 --> 00:00:02,000\nShalom\n"
const VTT_SHALOM = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nShalom\n"
/** A captions file as a project language keeps it: numbered cues, each naming its speaker. */
const KEPT = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\n<v Dana>Shalom</v>\n"

const captionsOf = (language: string, format: DubbingCaptionFormat = "srt") =>
  readDubbingCaptions(OWNER, FIRST, { language, format })

const answer = (value: string) => ({ ok: true, value })
const refused = (problem: DubbingProblem) => ({ ok: false, problem })

/** Nothing was asked of the dubbing service for captions: not a file, not lines. */
function expectNoCaptionsRead(): void {
  expect(service.readRegularCaptions).not.toHaveBeenCalled()
  expect(service.readProjectSubtitles).not.toHaveBeenCalled()
  expect(service.readProjectLanguageLines).not.toHaveBeenCalled()
  expect(service.readProjectSource).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("readDubbingCaptions: the original speech", () => {
  it("refuses a job the caller does not have, and reads nothing", async () => {
    store.loadDubFamily.mockResolvedValue({ kind: "not_found" })

    expect(await captionsOf("source")).toEqual(refused(DUBBING_PROBLEMS.notFound))
    expect(store.loadDubFamily).toHaveBeenCalledWith(OWNER, FIRST)
    expectNoCaptionsRead()
  })

  it.each(["source", " Source ", "SOURCE"])("answers a regular dub's own captions of it, asked for as %j", async (asked) => {
    regularDubOf()
    service.readRegularCaptions.mockResolvedValue(ok(VTT_HELLO))

    expect(await captionsOf(asked, "vtt")).toEqual(answer(VTT_HELLO))
    expect(service.readRegularCaptions.mock.calls).toEqual([["dub_1", "source", "vtt"]])
  })

  it.each([
    ["srt", SRT_HELLO],
    ["vtt", VTT_HELLO],
  ] as const)("makes a project dub's %s captions from its source lines", async (format, text) => {
    projectDub()
    service.readProjectSource.mockResolvedValue(ok({ language: "en", lines: [sourceLine] }))

    expect(await captionsOf("source", format)).toEqual(answer(text))
    expect(service.readProjectSource.mock.calls).toEqual([["project:p1:l1"]])
    expect(service.readProjectSubtitles).not.toHaveBeenCalled()
  })
})

/** Where each engine's source captions are read from. */
const SOURCE_READS = [
  { engine: "regular", dub: () => regularDubOf(), read: service.readRegularCaptions },
  { engine: "project", dub: () => projectDub(), read: service.readProjectSource },
]

describe.each(SOURCE_READS)("readDubbingCaptions: the original speech of a $engine dub that cannot be read", ({ dub, read }) => {
  it("is told as not ready while it is still being made", async () => {
    dub()
    read.mockResolvedValue(processing)

    expect(await captionsOf("source")).toEqual(refused(DUBBING_PROBLEMS.notReady))
  })

  it.each(NOTHING_TO_READ)("has no captions when it is $told", async ({ refusal }) => {
    dub()
    read.mockResolvedValue(refusal)

    expect(await captionsOf("source")).toEqual(refused(DUBBING_PROBLEMS.captionsUnavailable))
  })

  it("answers a refusal, with the cause, when the dubbing service fails", async () => {
    const boom = new Error("socket hang up")
    dub()
    read.mockRejectedValue(boom)

    expect(await captionsOf("source")).toEqual({ ok: false, problem: DUBBING_PROBLEMS.readFailed, cause: boom })
  })
})

describe("readDubbingCaptions: a language with no captions to read", () => {
  it("refuses a language the dub does not have, and reads nothing", async () => {
    projectDub()

    expect(await captionsOf("fr")).toEqual(refused(DUBBING_PROBLEMS.languageNotFound))
    expectNoCaptionsRead()
  })

  it("tells a language the project is still making as such, and reads nothing", async () => {
    projectDub([["l1", "he"], ["l2", "es", "processing"]])

    expect(await captionsOf("es")).toEqual(refused(DUBBING_PROBLEMS.languageProcessing))
    expectNoCaptionsRead()
  })

  it("tells a language whose job is still running as such, and reads nothing", async () => {
    regularDubOf("es", [job(ADDED, null, "fr", { status: "processing" })])

    expect(await captionsOf("fr")).toEqual(refused(DUBBING_PROBLEMS.languageProcessing))
    expectNoCaptionsRead()
  })

  it("has no captions for a language that failed", async () => {
    projectDub([["l1", "he"], ["l3", "fr", "failed"]])

    expect(await captionsOf("fr")).toEqual(refused(DUBBING_PROBLEMS.captionsUnavailable))
    expectNoCaptionsRead()
  })

  it("has no captions for a language whose job kept no dub to read", async () => {
    regularDubOf("es", [job(ADDED, null, "fr")])

    expect(await captionsOf("fr")).toEqual(refused(DUBBING_PROBLEMS.captionsUnavailable))
    expectNoCaptionsRead()
  })
})

describe("readDubbingCaptions: a language of a regular dub", () => {
  it("answers the dub's own captions of it, as they are", async () => {
    regularDubOf()
    service.readRegularCaptions.mockResolvedValue(ok(SRT_HELLO))

    expect(await captionsOf("es")).toEqual(answer(SRT_HELLO))
    expect(service.readRegularCaptions.mock.calls).toEqual([["dub_1", "es", "srt"]])
  })

  it("asks again under the code the dub tells when the code its job was given is not known", async () => {
    regularDubOf("pt-BR", [], "pt")
    service.readRegularCaptions.mockImplementation(async (_dubbingId: string, code: string) =>
      code === "pt" ? ok(VTT_HELLO) : gone,
    )

    expect(await captionsOf("pt-br", "vtt")).toEqual(answer(VTT_HELLO))
    expect(service.readRegularCaptions.mock.calls).toEqual([
      ["dub_1", "pt-BR", "vtt"],
      ["dub_1", "pt", "vtt"],
    ])
  })

  it("tells captions still being made as such, and does not ask again", async () => {
    regularDubOf("pt-BR", [], "pt")
    service.readRegularCaptions.mockResolvedValue(processing)

    expect(await captionsOf("pt-BR")).toEqual(refused(DUBBING_PROBLEMS.languageProcessing))
    expect(service.readRegularCaptions).toHaveBeenCalledTimes(1)
  })

  it.each(NOTHING_TO_READ)("has no captions when they are $told", async ({ refusal }) => {
    regularDubOf()
    service.readRegularCaptions.mockResolvedValue(refusal)

    expect(await captionsOf("es")).toEqual(refused(DUBBING_PROBLEMS.captionsUnavailable))
    expect(service.readRegularCaptions).toHaveBeenCalledTimes(1)
  })

  it("answers a refusal, with the cause, when the dubbing service fails", async () => {
    const boom = new Error("socket hang up")
    regularDubOf()
    service.readRegularCaptions.mockRejectedValue(boom)

    expect(await captionsOf("es")).toEqual({ ok: false, problem: DUBBING_PROBLEMS.readFailed, cause: boom })
  })
})

describe("readDubbingCaptions: a language of a project dub", () => {
  /** The language keeps no captions file, so its lines are what is read. */
  function keepsNoFile(): void {
    service.readProjectSubtitles.mockResolvedValue({ kind: "unsupported", code: "no_subtitles" })
  }

  it.each([
    ["vtt", VTT_SHALOM],
    ["srt", SRT_SHALOM],
  ] as const)("answers the cues of the file the language keeps, written as %s", async (format, text) => {
    projectDub()
    service.readProjectSubtitles.mockResolvedValue(ok(KEPT))

    expect(await captionsOf("he", format)).toEqual(answer(text))
    expect(service.readProjectSubtitles.mock.calls).toEqual([["project:p1:l1", "l1"]])
    expect(service.readProjectLanguageLines).not.toHaveBeenCalled()
  })

  it("says the same cues in both formats, whatever else the kept file carries", async () => {
    projectDub()
    service.readProjectSubtitles.mockResolvedValue(
      ok(
        [
          "WEBVTT - kept by the service",
          "",
          "NOTE not a cue",
          "",
          "7",
          "00:00:00.000 --> 00:00:02.000 align:start",
          "<v Dana>Tom &amp; Dana</v>",
          "",
          "8",
          "00:00:02.500 --> 00:00:04.000",
          "<i>a &lt; b</i>",
          "",
        ].join("\n"),
      ),
    )

    expect(await captionsOf("he", "vtt")).toEqual(
      answer("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nTom &amp; Dana\n\n00:00:02.500 --> 00:00:04.000\na &lt; b\n"),
    )
    expect(await captionsOf("he", "srt")).toEqual(
      answer("1\n00:00:00,000 --> 00:00:02,000\nTom & Dana\n\n2\n00:00:02,500 --> 00:00:04,000\na < b\n"),
    )
    expect(service.readProjectLanguageLines).not.toHaveBeenCalled()
  })

  it.each([
    { told: "says nothing", keep: () => void service.readProjectSubtitles.mockResolvedValue(ok("WEBVTT\n")) },
    { told: "is not kept", keep: keepsNoFile },
    { told: "is gone", keep: () => void service.readProjectSubtitles.mockResolvedValue(gone) },
    { told: "cannot be fetched", keep: () => void service.readProjectSubtitles.mockRejectedValue(new Error("no file")) },
  ])("makes the captions from the language's lines when its file $told", async ({ keep }) => {
    projectDub()
    keep()
    service.readProjectLanguageLines.mockResolvedValue(ok([shalom]))

    expect(await captionsOf("he", "srt")).toEqual(answer(SRT_SHALOM))
    expect(await captionsOf("he", "vtt")).toEqual(answer(VTT_SHALOM))
    expect(service.readProjectLanguageLines).toHaveBeenCalledWith("project:p1:l1", "l1")
  })

  it("tells a captions file still being made as such, and does not read the lines", async () => {
    projectDub()
    service.readProjectSubtitles.mockResolvedValue(processing)

    expect(await captionsOf("he")).toEqual(refused(DUBBING_PROBLEMS.languageProcessing))
    expect(service.readProjectLanguageLines).not.toHaveBeenCalled()
  })

  it("tells lines still being made as such", async () => {
    projectDub()
    keepsNoFile()
    service.readProjectLanguageLines.mockResolvedValue(processing)

    expect(await captionsOf("he")).toEqual(refused(DUBBING_PROBLEMS.languageProcessing))
  })

  it.each(NOTHING_TO_READ)("has no captions when the lines are $told", async ({ refusal }) => {
    projectDub()
    keepsNoFile()
    service.readProjectLanguageLines.mockResolvedValue(refusal)

    expect(await captionsOf("he")).toEqual(refused(DUBBING_PROBLEMS.captionsUnavailable))
  })

  it("answers a refusal, with the cause, when the dubbing service fails to tell the lines", async () => {
    const boom = new Error("socket hang up")
    projectDub()
    keepsNoFile()
    service.readProjectLanguageLines.mockRejectedValue(boom)

    expect(await captionsOf("he")).toEqual({ ok: false, problem: DUBBING_PROBLEMS.readFailed, cause: boom })
  })

  it("reads a language the project holds that no job delivers", async () => {
    projectDub([["l1", "he"], ["l2", "es"]])
    service.readProjectSubtitles.mockResolvedValue(ok(KEPT))

    expect(await captionsOf("es")).toEqual(answer(SRT_SHALOM))
    expect(service.readProjectSubtitles.mock.calls).toEqual([["project:p1:l1", "l2"]])
  })

  it("reads a language that went stale", async () => {
    projectDub([["l1", "he", "stale"]])
    service.readProjectSubtitles.mockResolvedValue(ok(KEPT))

    expect(await captionsOf("he")).toEqual(answer(SRT_SHALOM))
  })

  it.each(["HEB", " He "])("finds the language asked for as %j", async (asked) => {
    projectDub()
    service.readProjectSubtitles.mockResolvedValue(ok(KEPT))

    expect(await captionsOf(asked)).toEqual(answer(SRT_SHALOM))
  })
})
