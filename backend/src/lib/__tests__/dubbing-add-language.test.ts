import { describe, expect, it } from "vitest"
import type { DubbingLanguageStatus } from "@nodaro/shared/media"
import { planAddLanguage } from "../dubbing-add-language.js"
import type { FamilyLanguage, ResolvedDubFamily } from "../dubbing-family.js"
import { DUBBING_PROBLEMS } from "../dubbing-problems.js"

const FAMILY = "00000000-0000-4000-8000-0000000000aa"
const UPLOAD = "https://cdn.example/source.mp4"

function family(over: Partial<ResolvedDubFamily> & { readonly input?: Record<string, unknown>; readonly taskId?: string | null }): ResolvedDubFamily {
  const engine = over.engine ?? "project"
  const taskId = over.taskId === undefined ? (engine === "project" ? "project:p1" : "dub_1") : over.taskId
  return {
    familyId: FAMILY,
    anchor: {
      id: FAMILY,
      status: "completed",
      providerTaskId: taskId,
      input: over.input ?? { type: "dubbing", targetLanguage: "he", videoUrl: UPLOAD, probedDurationSec: 61 },
      createdAt: "2026-11-01T00:00:00Z",
    },
    engine,
    durationSec: over.durationSec === undefined ? 61 : over.durationSec,
    sourceLanguage: "en",
    languages: over.languages ?? [],
  }
}

const language = (code: string, status: DubbingLanguageStatus, jobId: string | null, languageId = `l_${code}`): FamilyLanguage => ({
  code,
  jobId,
  status,
  ref: { kind: "project", taskId: "project:p1", languageId },
})

const planOf = (outcome: ReturnType<typeof planAddLanguage>) => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.problem.code}`)
  return outcome.value
}

describe("planAddLanguage: a project dub", () => {
  it("takes the language into the project, for the dub's own length, from the upload it was made from", () => {
    expect(planOf(planAddLanguage(family({}), { targetLanguage: "es" }))).toEqual({
      engine: "project",
      familyId: FAMILY,
      targetLanguage: "es",
      seconds: 61,
      projectTaskId: "project:p1",
      adoptLanguageId: null,
      upload: { videoUrl: UPLOAD },
    })
  })

  it("delivers a language the project holds and no job delivers, instead of making it again", () => {
    const languages = [language("he", "completed", FAMILY), language("ES", "completed", null, "l_held")]
    expect(planOf(planAddLanguage(family({ languages }), { targetLanguage: "es" }))).toMatchObject({ adoptLanguageId: "l_held" })
  })

  it("takes the job id the dub began with, whichever of its jobs was asked for", () => {
    expect(planOf(planAddLanguage(family({}), { targetLanguage: "es" })).familyId).toBe(FAMILY)
  })

  it("delivers an audio dub's language as audio", () => {
    const input = { type: "dubbing", targetLanguage: "he", audioUrl: "https://cdn.example/a.mp3", probedDurationSec: 61 }
    expect(planOf(planAddLanguage(family({ input }), { targetLanguage: "es" }))).toMatchObject({ upload: { audioUrl: "https://cdn.example/a.mp3" } })
  })
})

describe("planAddLanguage: a language the dub has", () => {
  it("refuses one a job delivers, whatever its case", () => {
    const languages = [language("he", "completed", FAMILY), language("es", "completed", "00000000-0000-4000-8000-0000000000bb")]
    const outcome = planAddLanguage(family({ languages }), { targetLanguage: "ES" })
    expect(outcome).toEqual({ ok: false, problem: DUBBING_PROBLEMS.languageExists })
  })

  it("refuses one a job is still making", () => {
    const languages = [language("es", "processing", "00000000-0000-4000-8000-0000000000bb")]
    expect(planAddLanguage(family({ languages }), { targetLanguage: "es" })).toEqual({ ok: false, problem: DUBBING_PROBLEMS.languageExists })
  })

  it("refuses one the project holds whose lines changed after its media was made: there is no media to deliver", () => {
    const languages = [language("he", "completed", FAMILY), language("es", "stale", null, "l_stale")]
    expect(planAddLanguage(family({ languages }), { targetLanguage: "es" })).toEqual({ ok: false, problem: DUBBING_PROBLEMS.languageExists })
  })

  it("delivers one the project is still making that no job delivers", () => {
    const languages = [language("he", "completed", FAMILY), language("es", "processing", null, "l_making")]
    expect(planOf(planAddLanguage(family({ languages }), { targetLanguage: "es" }))).toMatchObject({ adoptLanguageId: "l_making" })
  })

  it("makes one that failed again, as a new language", () => {
    const languages = [language("es", "failed", "00000000-0000-4000-8000-0000000000bb")]
    expect(planOf(planAddLanguage(family({ languages }), { targetLanguage: "es" }))).toMatchObject({ engine: "project", adoptLanguageId: null })
  })
})

describe("planAddLanguage: a regular dub", () => {
  const input = {
    type: "dubbing",
    targetLanguage: "fr",
    sourceUrl: "https://video.example/watch?v=1",
    sourceLanguage: "en",
    numSpeakers: 2,
    startTime: 5,
    endTime: 65,
    watermark: false,
    disableVoiceCloning: null,
    probedDurationSec: 60,
    reservedCeiling: true,
    confirmationId: "00000000-0000-4000-8000-0000000000cc",
    userId: "00000000-0000-4000-8000-0000000000dd",
  }

  it("is a dub of the same source with the same settings into the new language, with the confirmation it is given", () => {
    const confirmationId = "00000000-0000-4000-8000-0000000000ee"
    expect(planOf(planAddLanguage(family({ engine: "regular", input }), { targetLanguage: "de", confirmationId }))).toEqual({
      engine: "regular",
      familyId: FAMILY,
      createBody: {
        sourceUrl: "https://video.example/watch?v=1",
        sourceLanguage: "en",
        numSpeakers: 2,
        startTime: 5,
        endTime: 65,
        watermark: false,
        targetLanguage: "de",
        confirmationId,
      },
    })
  })

  it("never takes the first dub's confirmation, length or account", () => {
    const plan = planOf(planAddLanguage(family({ engine: "regular", input }), { targetLanguage: "de" }))
    if (plan.engine !== "regular") throw new Error("not a regular plan")
    for (const key of ["confirmationId", "probedDurationSec", "reservedCeiling", "userId", "type", "disableVoiceCloning"]) {
      expect(plan.createBody).not.toHaveProperty(key)
    }
  })
})

describe("planAddLanguage: the one source a dub was made from", () => {
  const link = "https://video.example/watch?v=1"

  it("is the link when a workflow kept a wired upload beside it", () => {
    const input = { type: "dubbing", targetLanguage: "fr", sourceUrl: link, videoUrl: UPLOAD, audioUrl: "https://cdn.example/a.mp3" }
    const plan = planOf(planAddLanguage(family({ engine: "regular", input }), { targetLanguage: "de" }))
    expect(plan).toMatchObject({ engine: "regular", createBody: { sourceUrl: link, targetLanguage: "de" } })
    if (plan.engine !== "regular") throw new Error("not a regular plan")
    expect(plan.createBody).not.toHaveProperty("videoUrl")
    expect(plan.createBody).not.toHaveProperty("audioUrl")
  })

  it("is the video when both uploads were kept", () => {
    const input = { type: "dubbing", targetLanguage: "fr", videoUrl: UPLOAD, audioUrl: "https://cdn.example/a.mp3" }
    const plan = planOf(planAddLanguage(family({ engine: "regular", input }), { targetLanguage: "de" }))
    if (plan.engine !== "regular") throw new Error("not a regular plan")
    expect(plan.createBody).toEqual({ videoUrl: UPLOAD, targetLanguage: "de" })
  })

  it("is the audio when no other source was kept", () => {
    const input = { type: "dubbing", targetLanguage: "fr", audioUrl: "https://cdn.example/a.mp3" }
    const plan = planOf(planAddLanguage(family({ engine: "regular", input }), { targetLanguage: "de" }))
    if (plan.engine !== "regular") throw new Error("not a regular plan")
    expect(plan.createBody).toEqual({ audioUrl: "https://cdn.example/a.mp3", targetLanguage: "de" })
  })
})

describe("planAddLanguage: a dub a language cannot be added to", () => {
  it("refuses a dub whose source is no longer on record", () => {
    const outcome = planAddLanguage(family({ input: { type: "dubbing", targetLanguage: "he", probedDurationSec: 61 } }), { targetLanguage: "es" })
    expect(outcome).toEqual({ ok: false, problem: DUBBING_PROBLEMS.unreadableSource })
  })

  it("refuses a project dub whose length is not known", () => {
    const outcome = planAddLanguage(family({ input: { type: "dubbing", targetLanguage: "he", videoUrl: UPLOAD }, durationSec: null }), { targetLanguage: "es" })
    expect(outcome).toEqual({ ok: false, problem: DUBBING_PROBLEMS.unreadableSource })
  })

  it("refuses a dub past what a dub may cover", () => {
    const outcome = planAddLanguage(family({ input: { type: "dubbing", targetLanguage: "he", videoUrl: UPLOAD }, durationSec: 1801 }), { targetLanguage: "es" })
    expect(outcome).toEqual({ ok: false, problem: DUBBING_PROBLEMS.tooLong })
  })
})
