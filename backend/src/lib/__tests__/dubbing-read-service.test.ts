import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"
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
const voices = vi.hoisted(() => ({ judge: vi.fn() }))

vi.mock("@/providers/elevenlabs/dubbing-read.js", () => service)
vi.mock("@/lib/dubbing-job-store.js", () => ({ loadDubFamily: store.loadDubFamily }))
vi.mock("@/lib/voice-policy.js", () => ({ judgeUnnamedVoices: voices.judge }))

import { DUBBING_PROBLEMS, dubbingAnswer } from "../dubbing-problems.js"
import { readDubbingStructure, withDubFamily } from "../dubbing-read-service.js"

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

/** Every way the dubbing service refuses a read. */
const REFUSALS = [
  { told: "gone", refusal: gone },
  { told: "not told", refusal: unsupported },
  { told: "still being made", refusal: processing },
]

type HeldLanguage = readonly [id: string, code: string, status?: string]

const project = (languages: readonly HeldLanguage[]) =>
  ok({
    status: "dubbed",
    sourceLanguage: "en",
    durationSec: 120,
    languages: languages.map(([id, code, status = "completed"]) => ({ id, code, status })),
  })

const regularDub = (targetLanguages: readonly string[] = ["es"], durationSec = 90) =>
  ok({ status: "dubbed", sourceLanguage: "en", targetLanguages, durationSec })

/** A project dub whose first job delivers the language `l1`. */
function projectDub(languages: readonly HeldLanguage[] = [["l1", "he"]], members: readonly DubJobRow[] = []): void {
  holds(job(FIRST, "project:p1:l1", "he"), members)
  service.readProjectDub.mockResolvedValue(project(languages))
}

function regularDubOf(language = "es", members: readonly DubJobRow[] = []): void {
  holds(job(FIRST, "dub_1", language), members)
  service.readRegularDub.mockResolvedValue(regularDub([language]))
}

const sourceLine = { id: "s1", speakerId: "sp1", start: 0, end: 2, text: "Hello" }
const dubbed = (text: string) => ({ ...sourceLine, text, sourceText: "Hello" })

/** A project's lines: one source line, and one line per language, saying the text given for it or its own id. */
function projectLines(byLanguage: Readonly<Record<string, string>> = { l1: "Shalom" }): void {
  service.readProjectSource.mockResolvedValue(ok({ language: "en", lines: [sourceLine] }))
  service.readProjectLanguageLines.mockImplementation(async (_taskId: string, languageId: string) =>
    ok([dubbed(byLanguage[languageId] ?? languageId)]),
  )
}

const spoken = (speakerId: string, start: number, text: string) => ({ speakerId, start, end: start + 2, text })

/** What a regular dub tells per language asked; a language not listed is gone. */
function regularTranscripts(byLanguage: Readonly<Record<string, unknown>> = {}): void {
  const told: Readonly<Record<string, unknown>> = {
    source: ok({ language: "en", lines: [spoken("sp1", 0, "Hello"), spoken("sp2", 2, "World")] }),
    es: ok({ language: "es", lines: [spoken("sp1", 0, "Hola"), spoken("sp2", 2, "Mundo")] }),
    ...byLanguage,
  }
  service.readRegularTranscript.mockImplementation(async (_dubbingId: string, language: string) => told[language] ?? gone)
}

async function structureOf() {
  const outcome = await readDubbingStructure(OWNER, FIRST)
  if (!outcome.ok) throw new Error(`refused: ${outcome.problem.code}`)
  return outcome.value
}

/** The calls a read got, whatever their order. */
const callsOf = (read: Mock): string[] => read.mock.calls.map((args) => args.join(" ")).sort()

const capabilities = (addLanguage: boolean) => ({
  editSegments: false,
  regenerate: false,
  setSpeakerVoice: false,
  render: false,
  addLanguage,
  captions: true,
})

const ONE_SPEAKER = [{ id: "sp1", name: null, voice: null, segmentCount: 1 }]

// The fixture job measured 61 seconds: two started minutes.
const PROJECT_PRICE = { billableMinutes: 2, creditId: "elevenlabs-dubbing-v2:2u", creditIdByLanguage: {} }
const REGULAR_PRICE = {
  billableMinutes: 2,
  creditId: "elevenlabs-dubbing:2u",
  creditIdByLanguage: { he: "elevenlabs-dubbing-v2:2u", heb: "elevenlabs-dubbing-v2:2u" },
}

beforeEach(() => {
  vi.resetAllMocks()
  voices.judge.mockReturnValue({ allowed: true })
})

describe("withDubFamily", () => {
  const read = vi.fn()

  it("refuses a job the caller does not have, and reads nothing", async () => {
    store.loadDubFamily.mockResolvedValue({ kind: "not_found" })

    expect(await withDubFamily(OWNER, FIRST, read)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.notFound })
    expect(store.loadDubFamily).toHaveBeenCalledWith(OWNER, FIRST)
    expect(read).not.toHaveBeenCalled()
    expect(service.readRegularDub).not.toHaveBeenCalled()
    expect(service.readProjectDub).not.toHaveBeenCalled()
  })

  it("refuses a job that is not a dub", async () => {
    store.loadDubFamily.mockResolvedValue({ kind: "not_a_dubbing_job" })

    expect(await withDubFamily(OWNER, FIRST, read)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.notADub })
    expect(read).not.toHaveBeenCalled()
  })

  it("answers the refusal of a dub that cannot be read now", async () => {
    holds(job(FIRST, null, "es", { status: "processing" }))

    expect(await withDubFamily(OWNER, FIRST, read)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.notReady })
    expect(read).not.toHaveBeenCalled()
    expect(service.readRegularDub).not.toHaveBeenCalled()
  })

  it("hands the family of a dub that is made to the read", async () => {
    regularDubOf()

    expect(await withDubFamily(OWNER, FIRST, async (family) => dubbingAnswer(family.engine))).toEqual({
      ok: true,
      value: "regular",
    })
  })

  it("answers a refusal, with the cause, when the dubbing service fails while the dub is found", async () => {
    const boom = new Error("socket hang up")
    holds(job(FIRST, "dub_1", "es"))
    service.readRegularDub.mockRejectedValue(boom)

    expect(await withDubFamily(OWNER, FIRST, read)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.readFailed, cause: boom })
    expect(read).not.toHaveBeenCalled()
  })

  it("answers the same refusal when the dubbing service fails later, while the lines are read", async () => {
    const boom = new Error("socket hang up")
    projectDub()
    projectLines()
    service.readProjectSource.mockRejectedValue(boom)

    expect(await readDubbingStructure(OWNER, FIRST)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.readFailed, cause: boom })
  })

  it("throws a failure of ours while the job is looked up", async () => {
    store.loadDubFamily.mockRejectedValue(new Error("db down"))

    await expect(withDubFamily(OWNER, FIRST, read)).rejects.toThrow("db down")
  })

  it("throws a failure of ours inside the read", async () => {
    regularDubOf()
    read.mockRejectedValue(new Error("ours"))

    await expect(withDubFamily(OWNER, FIRST, read)).rejects.toThrow("ours")
  })
})

describe("readDubbingStructure: a project dub", () => {
  it("refuses a job the caller does not have", async () => {
    store.loadDubFamily.mockResolvedValue({ kind: "not_found" })

    expect(await readDubbingStructure(OWNER, FIRST)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.notFound })
  })

  it("tells the source, every language the project holds, the speakers and the price of one more language", async () => {
    projectDub([["l1", "he"], ["l2", "es"]])
    projectLines({ l1: "Shalom", l2: "Hola" })
    const segment = (text: string) => ({ ...sourceLine, sourceSegmentId: "s1", sourceText: "Hello", text })

    expect(await structureOf()).toEqual({
      jobId: FIRST,
      durationSec: 120,
      source: { language: "en", segments: [sourceLine] },
      languages: [
        { code: "he", jobId: FIRST, status: "completed", segments: [segment("Shalom")] },
        { code: "es", jobId: null, status: "completed", segments: [segment("Hola")] },
      ],
      speakers: ONE_SPEAKER,
      capabilities: capabilities(true),
      addLanguage: PROJECT_PRICE,
    })
    expect(callsOf(service.readProjectSource)).toEqual(["project:p1:l1"])
    expect(callsOf(service.readProjectLanguageLines)).toEqual(["project:p1:l1 l1", "project:p1:l1 l2"])
  })

  it("reads the lines only of the languages that are made", async () => {
    projectDub([["l1", "he"], ["l2", "es", "processing"], ["l3", "fr", "failed"], ["l4", "de", "stale"]])
    projectLines()

    const { languages } = await structureOf()

    expect(callsOf(service.readProjectLanguageLines)).toEqual(["project:p1:l1 l1", "project:p1:l1 l4"])
    expect(languages.map(({ code, status, segments }) => [code, status, segments.length])).toEqual([
      ["he", "completed", 1],
      ["es", "processing", 0],
      ["fr", "failed", 0],
      ["de", "stale", 1],
    ])
  })

  it.each(REFUSALS)("tells no source when it is $told, and the speakers by the first language that has lines", async ({ refusal }) => {
    projectDub()
    projectLines()
    service.readProjectSource.mockResolvedValue(refusal)

    const structure = await structureOf()

    expect(structure.source).toBeNull()
    expect(structure.languages.map((language) => language.segments)).toEqual([
      [{ ...sourceLine, sourceSegmentId: null, sourceText: "Hello", text: "Shalom" }],
    ])
    expect(structure.speakers).toEqual(ONE_SPEAKER)
  })

  it.each(REFUSALS)("lists a language whose lines are $told with no lines, and tells the speakers by the source", async ({ refusal }) => {
    projectDub()
    projectLines()
    service.readProjectLanguageLines.mockResolvedValue(refusal)

    const structure = await structureOf()

    expect(structure.languages).toEqual([{ code: "he", jobId: FIRST, status: "completed", segments: [] }])
    expect(structure.speakers).toEqual(ONE_SPEAKER)
  })

  it("cannot be added to where no dub may speak, and still tells the price", async () => {
    projectDub()
    projectLines()
    voices.judge.mockReturnValue({ allowed: false, reason: "gender_unknown" })

    const structure = await structureOf()

    expect(structure.capabilities).toEqual(capabilities(false))
    expect(structure.addLanguage).toEqual(PROJECT_PRICE)
  })

  it("reads at most four languages at once, and keeps their order", async () => {
    projectDub([["l1", "he"], ["l2", "es"], ["l3", "fr"], ["l4", "de"], ["l5", "it"], ["l6", "pt"]])
    projectLines()
    let reading = 0
    let most = 0
    service.readProjectLanguageLines.mockImplementation(async (_taskId: string, languageId: string) => {
      reading += 1
      most = Math.max(most, reading)
      await new Promise((resolve) => setTimeout(resolve, 5))
      reading -= 1
      return ok([dubbed(languageId)])
    })

    const { languages } = await structureOf()

    expect(most).toBe(4)
    expect(languages.map((language) => language.code)).toEqual(["he", "es", "fr", "de", "it", "pt"])
    expect(languages.map((language) => language.segments.map((segment) => segment.text))).toEqual([
      ["l1"],
      ["l2"],
      ["l3"],
      ["l4"],
      ["l5"],
      ["l6"],
    ])
  })
})

describe("readDubbingStructure: a regular dub", () => {
  it("tells the source and the language, numbering the lines the service gives no ids", async () => {
    regularDubOf()
    regularTranscripts()
    const unpaired = { sourceSegmentId: null, sourceText: null }

    expect(await structureOf()).toEqual({
      jobId: FIRST,
      durationSec: 90,
      source: {
        language: "en",
        segments: [
          { id: "1", speakerId: "sp1", start: 0, end: 2, text: "Hello" },
          { id: "2", speakerId: "sp2", start: 2, end: 4, text: "World" },
        ],
      },
      languages: [
        {
          code: "es",
          jobId: FIRST,
          status: "completed",
          segments: [
            { id: "1", speakerId: "sp1", start: 0, end: 2, ...unpaired, text: "Hola" },
            { id: "2", speakerId: "sp2", start: 2, end: 4, ...unpaired, text: "Mundo" },
          ],
        },
      ],
      speakers: [
        { id: "sp1", name: null, voice: null, segmentCount: 1 },
        { id: "sp2", name: null, voice: null, segmentCount: 1 },
      ],
      capabilities: capabilities(true),
      addLanguage: REGULAR_PRICE,
    })
    expect(callsOf(service.readRegularTranscript)).toEqual(["dub_1 es", "dub_1 source"])
  })

  it("lists a language still being made, and does not read it", async () => {
    regularDubOf("es", [job(ADDED, null, "fr", { status: "processing" })])
    regularTranscripts()

    const { languages } = await structureOf()

    expect(languages.map((language) => language.code)).toEqual(["es", "fr"])
    expect(languages.at(-1)).toEqual({ code: "fr", jobId: ADDED, status: "processing", segments: [] })
    expect(callsOf(service.readRegularTranscript)).toEqual(["dub_1 es", "dub_1 source"])
  })

  it("reads a language under the code the dub tells when the code asked for is not known", async () => {
    holds(job(FIRST, "dub_1", "pt-BR"))
    service.readRegularDub.mockResolvedValue(regularDub(["pt"]))
    regularTranscripts({ pt: ok({ language: "pt", lines: [spoken("sp1", 0, "Ola")] }) })

    const { languages } = await structureOf()

    expect(callsOf(service.readRegularTranscript)).toEqual(["dub_1 pt", "dub_1 pt-BR", "dub_1 source"])
    expect(languages.map(({ code, segments }) => [code, segments.map((segment) => segment.text)])).toEqual([["pt-BR", ["Ola"]]])
  })

  it("does not try another code for a language the service is still making", async () => {
    holds(job(FIRST, "dub_1", "pt-BR"))
    service.readRegularDub.mockResolvedValue(regularDub(["pt"]))
    regularTranscripts({ "pt-BR": processing })

    const { languages } = await structureOf()

    expect(languages).toEqual([{ code: "pt-BR", jobId: FIRST, status: "completed", segments: [] }])
    expect(callsOf(service.readRegularTranscript)).toEqual(["dub_1 pt-BR", "dub_1 source"])
    expect(service.readRegularDub).toHaveBeenCalledTimes(1)
  })

  it("does not ask twice for the code the dub itself tells", async () => {
    regularDubOf()
    regularTranscripts({ es: gone })

    const { languages } = await structureOf()

    expect(languages).toEqual([{ code: "es", jobId: FIRST, status: "completed", segments: [] }])
    expect(callsOf(service.readRegularTranscript)).toEqual(["dub_1 es", "dub_1 source"])
  })

  it("does not guess a code for a language whose dub cannot be read", async () => {
    holds(job(FIRST, "dub_1", "es"), [job(ADDED, "dub_2", "pt-BR")])
    service.readRegularDub.mockImplementation(async (dubbingId: string) => (dubbingId === "dub_1" ? regularDub() : gone))
    regularTranscripts()

    const { languages } = await structureOf()

    expect(languages.at(-1)).toEqual({ code: "pt-BR", jobId: ADDED, status: "completed", segments: [] })
    expect(callsOf(service.readRegularTranscript)).toEqual(["dub_1 es", "dub_1 source", "dub_2 pt-BR"])
  })

  it("tells no source when the service does not tell it, and the speakers by the language", async () => {
    regularDubOf()
    regularTranscripts({ source: gone })

    const structure = await structureOf()

    expect(structure.source).toBeNull()
    expect(structure.languages.map((language) => language.segments.map((segment) => segment.text))).toEqual([["Hola", "Mundo"]])
    expect(structure.speakers.map((speaker) => speaker.id)).toEqual(["sp1", "sp2"])
  })

  it("cannot be added to when the dub kept no source to dub again", async () => {
    holds(job(FIRST, "dub_1", "es", { input: { type: "dubbing", targetLanguage: "es" } }))
    service.readRegularDub.mockResolvedValue(regularDub())
    regularTranscripts()

    expect((await structureOf()).capabilities).toEqual(capabilities(false))
  })

  it("prices one more language by the length the service tells when the job kept none", async () => {
    holds(job(FIRST, "dub_1", "es", { input: { type: "dubbing", targetLanguage: "es", videoUrl: "https://cdn.example/source.mp4" } }))
    service.readRegularDub.mockResolvedValue(regularDub(["es"], 190))
    regularTranscripts()

    expect((await structureOf()).addLanguage).toMatchObject({ billableMinutes: 4, creditId: "elevenlabs-dubbing:4u" })
  })
})
