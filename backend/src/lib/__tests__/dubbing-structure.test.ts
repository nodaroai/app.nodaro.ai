import { describe, expect, it } from "vitest"
import type { AddLanguageTerms } from "../dubbing-add-terms.js"
import type { FamilyLanguage, ResolvedDubFamily } from "../dubbing-family.js"
import type { DubJobRow } from "../dubbing-job-store.js"
import { buildDubbingStructure, languageHasLines, type DubbingStructureParts } from "../dubbing-structure.js"

const FIRST = "00000000-0000-4000-8000-000000000001"
const ADDED = "00000000-0000-4000-8000-000000000002"

const job = (id: string, providerTaskId: string | null): DubJobRow => ({
  id,
  status: "completed",
  providerTaskId,
  input: { type: "dubbing", targetLanguage: "he" },
  createdAt: "2026-11-01T10:00:00.000Z",
})

const projectFamily = (languages: readonly FamilyLanguage[]): ResolvedDubFamily => ({
  familyId: FIRST,
  anchor: job(FIRST, "project:p1:l1"),
  engine: "project",
  durationSec: 120,
  sourceLanguage: "en",
  languages,
})

const regularFamily = (languages: readonly FamilyLanguage[]): ResolvedDubFamily => ({
  familyId: FIRST,
  anchor: job(FIRST, "dub_1"),
  engine: "regular",
  durationSec: 90,
  sourceLanguage: "en",
  languages,
})

const inProject = (code: string, languageId: string, extra: Partial<FamilyLanguage> = {}): FamilyLanguage => ({
  code,
  jobId: FIRST,
  status: "completed",
  ref: { kind: "project", taskId: `project:p1:${languageId}`, languageId },
  ...extra,
})

const inRegular = (code: string, dubbingId: string, extra: Partial<FamilyLanguage> = {}): FamilyLanguage => ({
  code,
  jobId: FIRST,
  status: "completed",
  ref: { kind: "regular", dubbingId, code },
  ...extra,
})

const terms = (blocked: AddLanguageTerms["blocked"] = null): AddLanguageTerms => ({
  blocked,
  price: { billableMinutes: 2, creditId: "elevenlabs-dubbing-v2:2u", creditIdByLanguage: {} },
})

const spoken = (speakerId: string | null, start: number, text: string) => ({ speakerId, start, end: start + 2, text })
const sourceLine = (id: string, speakerId: string | null, start: number, text: string) => ({ id, ...spoken(speakerId, start, text) })
const dubbedLine = (id: string, speakerId: string | null, start: number, text: string, sourceText: string | null) => ({
  ...sourceLine(id, speakerId, start, text),
  sourceText,
})

const parts = (given: Partial<DubbingStructureParts> & Pick<DubbingStructureParts, "family">): DubbingStructureParts => ({
  source: null,
  languages: [],
  terms: terms(),
  voicesAllowed: true,
  ...given,
})

describe("buildDubbingStructure: a project dub", () => {
  const hebrew = inProject("he", "l1")
  const source = {
    kind: "project" as const,
    language: "en",
    lines: [sourceLine("s1", "sp1", 0, "Hello"), sourceLine("s2", "sp2", 3, "Good morning")],
  }

  it("tells the dub by the job it is read through", () => {
    const structure = buildDubbingStructure(parts({ family: projectFamily([hebrew]) }))

    expect(structure.jobId).toBe(FIRST)
    expect(structure.durationSec).toBe(120)
  })

  it("keeps the source lines with the ids the service gives them", () => {
    const structure = buildDubbingStructure(parts({ family: projectFamily([hebrew]), source }))

    expect(structure.source).toEqual({
      language: "en",
      segments: [
        { id: "s1", speakerId: "sp1", start: 0, end: 2, text: "Hello" },
        { id: "s2", speakerId: "sp2", start: 3, end: 5, text: "Good morning" },
      ],
    })
  })

  it("pairs each line of a language with the source line of the same id", () => {
    const lines = { kind: "project" as const, lines: [dubbedLine("s1", "sp1", 0, "Shalom", "Hello"), dubbedLine("s2", "sp2", 3, "Boker tov", "Good morning")] }
    const structure = buildDubbingStructure(parts({ family: projectFamily([hebrew]), source, languages: [{ language: hebrew, lines }] }))

    expect(structure.languages).toEqual([
      {
        code: "he",
        jobId: FIRST,
        status: "completed",
        segments: [
          { id: "s1", speakerId: "sp1", start: 0, end: 2, sourceSegmentId: "s1", sourceText: "Hello", text: "Shalom" },
          { id: "s2", speakerId: "sp2", start: 3, end: 5, sourceSegmentId: "s2", sourceText: "Good morning", text: "Boker tov" },
        ],
      },
    ])
  })

  it("names no source line for a line the source does not hold, and keeps the text it was told", () => {
    const lines = { kind: "project" as const, lines: [dubbedLine("s9", "sp1", 0, "Shalom", "Hello there")] }
    const structure = buildDubbingStructure(parts({ family: projectFamily([hebrew]), source, languages: [{ language: hebrew, lines }] }))

    expect(structure.languages[0]?.segments).toEqual([
      { id: "s9", speakerId: "sp1", start: 0, end: 2, sourceSegmentId: null, sourceText: "Hello there", text: "Shalom" },
    ])
  })

  it("names no source line when the source was not read", () => {
    const lines = { kind: "project" as const, lines: [dubbedLine("s1", "sp1", 0, "Shalom", "Hello")] }
    const structure = buildDubbingStructure(parts({ family: projectFamily([hebrew]), source: null, languages: [{ language: hebrew, lines }] }))

    expect(structure.source).toBeNull()
    expect(structure.languages[0]?.segments[0]).toMatchObject({ id: "s1", sourceSegmentId: null, sourceText: "Hello" })
  })

  it("names no source line for a language held in another project, even when the ids look alike", () => {
    const apart: FamilyLanguage = { code: "he", jobId: ADDED, status: "completed", ref: { kind: "project", taskId: "project:p2:l7", languageId: "l7" } }
    const lines = { kind: "project" as const, lines: [dubbedLine("s1", "sp1", 0, "Shalom", "Hello")] }
    const structure = buildDubbingStructure(parts({ family: projectFamily([apart]), source, languages: [{ language: apart, lines }] }))

    expect(structure.languages[0]?.segments[0]).toMatchObject({ id: "s1", sourceSegmentId: null, sourceText: "Hello" })
  })

  it("falls back to the language the dub tells when the source lines tell none", () => {
    const structure = buildDubbingStructure(parts({ family: projectFamily([hebrew]), source: { ...source, language: null } }))

    expect(structure.source?.language).toBe("en")
  })

  it("lists a language no job delivers with no job", () => {
    const held = inProject("es", "l2", { jobId: null })
    const structure = buildDubbingStructure(parts({ family: projectFamily([hebrew, held]), languages: [{ language: hebrew, lines: null }, { language: held, lines: null }] }))

    expect(structure.languages.map(({ code, jobId }) => [code, jobId])).toEqual([
      ["he", FIRST],
      ["es", null],
    ])
  })
})

describe("buildDubbingStructure: a regular dub", () => {
  const spanish = inRegular("es", "dub_1")
  const source = { kind: "regular" as const, language: "en", lines: [spoken("sp1", 0, "Hello"), spoken(null, 3, "Good morning")] }

  it("numbers the source lines in the order told", () => {
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), source }))

    expect(structure.source).toEqual({
      language: "en",
      segments: [
        { id: "1", speakerId: "sp1", start: 0, end: 2, text: "Hello" },
        { id: "2", speakerId: null, start: 3, end: 5, text: "Good morning" },
      ],
    })
  })

  it("numbers the lines of a language and pairs none with the source", () => {
    const lines = { kind: "regular" as const, lines: [spoken("sp1", 0, "Hola"), spoken("sp1", 3, "Buenos dias")] }
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), source, languages: [{ language: spanish, lines }] }))

    expect(structure.languages[0]?.segments).toEqual([
      { id: "1", speakerId: "sp1", start: 0, end: 2, sourceSegmentId: null, sourceText: null, text: "Hola" },
      { id: "2", speakerId: "sp1", start: 3, end: 5, sourceSegmentId: null, sourceText: null, text: "Buenos dias" },
    ])
  })

  it("keeps the source with no lines as an empty source", () => {
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), source: { kind: "regular", language: null, lines: [] } }))

    expect(structure.source).toEqual({ language: "en", segments: [] })
  })

  it("keeps the languages in the family's order", () => {
    const french = inRegular("fr", "dub_2", { jobId: ADDED })
    const structure = buildDubbingStructure(
      parts({ family: regularFamily([spanish, french]), languages: [{ language: spanish, lines: null }, { language: french, lines: null }] }),
    )

    expect(structure.languages.map((language) => language.code)).toEqual(["es", "fr"])
    expect(structure.languages.map((language) => language.jobId)).toEqual([FIRST, ADDED])
  })
})

describe("buildDubbingStructure: lines that are not there", () => {
  const lines = { kind: "regular" as const, lines: [spoken("sp1", 0, "Hola")] }

  it("gives a language whose lines were not read no lines", () => {
    const spanish = inRegular("es", "dub_1")
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), languages: [{ language: spanish, lines: null }] }))

    expect(structure.languages).toEqual([{ code: "es", jobId: FIRST, status: "completed", segments: [] }])
  })

  it.each(["processing", "failed"] as const)("gives a %s language no lines, whatever was read", (status) => {
    const spanish = inRegular("es", "dub_1", { status })
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), languages: [{ language: spanish, lines }] }))

    expect(structure.languages).toEqual([{ code: "es", jobId: FIRST, status, segments: [] }])
  })

  it("keeps the lines of a language whose dub is out of date", () => {
    const spanish = inRegular("es", "dub_1", { status: "stale" })
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), languages: [{ language: spanish, lines }] }))

    expect(structure.languages[0]?.status).toBe("stale")
    expect(structure.languages[0]?.segments).toHaveLength(1)
  })

  it("reads lines of made languages only", () => {
    expect(languageHasLines("completed")).toBe(true)
    expect(languageHasLines("stale")).toBe(true)
    expect(languageHasLines("processing")).toBe(false)
    expect(languageHasLines("failed")).toBe(false)
  })
})

describe("buildDubbingStructure: the speakers", () => {
  const spanish = inRegular("es", "dub_1")
  const french = inRegular("fr", "dub_2", { jobId: ADDED })

  it("lists the speakers of the source in the order they first speak, with their line counts", () => {
    const source = {
      kind: "regular" as const,
      language: "en",
      lines: [spoken("sp2", 0, "a"), spoken("sp1", 3, "b"), spoken(null, 6, "c"), spoken("sp2", 9, "d")],
    }
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), source }))

    expect(structure.speakers).toEqual([
      { id: "sp2", name: null, voice: null, segmentCount: 2 },
      { id: "sp1", name: null, voice: null, segmentCount: 1 },
    ])
  })

  it("reads them from the source even when a language tells others", () => {
    const source = { kind: "regular" as const, language: "en", lines: [spoken("sp1", 0, "a")] }
    const lines = { kind: "regular" as const, lines: [spoken("sp7", 0, "x"), spoken("sp8", 3, "y")] }
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), source, languages: [{ language: spanish, lines }] }))

    expect(structure.speakers.map((speaker) => speaker.id)).toEqual(["sp1"])
  })

  it.each([
    ["was not read", null],
    ["has no lines", { kind: "regular" as const, language: "en", lines: [] }],
  ])("reads them from the first language that has lines when the source %s", (_case, source) => {
    const structure = buildDubbingStructure(
      parts({
        family: regularFamily([spanish, french]),
        source,
        languages: [
          { language: spanish, lines: null },
          { language: french, lines: { kind: "regular", lines: [spoken("sp3", 0, "x"), spoken("sp3", 3, "y")] } },
        ],
      }),
    )

    expect(structure.speakers).toEqual([{ id: "sp3", name: null, voice: null, segmentCount: 2 }])
  })

  it("lists none when no lines were read at all", () => {
    const structure = buildDubbingStructure(parts({ family: regularFamily([spanish]), languages: [{ language: spanish, lines: null }] }))

    expect(structure.speakers).toEqual([])
  })
})

describe("buildDubbingStructure: what can be done to the dub", () => {
  const family = regularFamily([inRegular("es", "dub_1")])

  it("offers captions and adding a language, and none of the edits", () => {
    expect(buildDubbingStructure(parts({ family })).capabilities).toEqual({
      editSegments: false,
      regenerate: false,
      setSpeakerVoice: false,
      render: false,
      addLanguage: true,
      captions: true,
    })
  })

  it.each(["no_source", "unknown_length", "too_long"] as const)("offers no added language to a dub blocked by %s", (blocked) => {
    expect(buildDubbingStructure(parts({ family, terms: terms(blocked) })).capabilities.addLanguage).toBe(false)
  })

  it("offers no added language where this deployment lets no dub speak", () => {
    const structure = buildDubbingStructure(parts({ family, voicesAllowed: false }))

    expect(structure.capabilities.addLanguage).toBe(false)
    expect(structure.capabilities.captions).toBe(true)
  })

  it("tells the price of an added language as it was worked out", () => {
    const priced: AddLanguageTerms = {
      blocked: null,
      price: { billableMinutes: 2, creditId: "elevenlabs-dubbing:2u", creditIdByLanguage: { he: "elevenlabs-dubbing-v2:2u" } },
    }
    const structure = buildDubbingStructure(parts({ family, terms: priced }))

    expect(structure.addLanguage).toEqual(priced.price)
    expect(structure.addLanguage).not.toBe(priced.price)
    expect(structure.addLanguage.creditIdByLanguage).not.toBe(priced.price.creditIdByLanguage)
  })
})
