import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DubFamily, DubJobRow } from "../dubbing-job-store.js"

const service = vi.hoisted(() => ({ readProjectDub: vi.fn(), readRegularDub: vi.fn() }))

vi.mock("@/providers/elevenlabs/dubbing-read.js", () => service)

import { DubbingServiceError, askService, dubEngineOf, resolveDubFamily } from "../dubbing-family.js"
import { DUBBING_PROBLEMS } from "../dubbing-problems.js"

const FIRST = "00000000-0000-4000-8000-000000000001"
const ADDED = "00000000-0000-4000-8000-000000000002"
const THIRD = "00000000-0000-4000-8000-000000000003"
const GONE_ROOT = "00000000-0000-4000-8000-000000000009"

const job = (id: string, providerTaskId: string | null, language: string, extra: Partial<DubJobRow> = {}): DubJobRow => ({
  id,
  status: "completed",
  providerTaskId,
  input: { type: "dubbing", targetLanguage: language },
  createdAt: "2026-11-01T10:00:00.000Z",
  ...extra,
})

const family = (anchor: DubJobRow, members: DubJobRow[] = [], familyId: string = anchor.id): DubFamily => ({ familyId, anchor, members })

const ok = <T>(value: T) => ({ kind: "ok" as const, value })

type HeldLanguage = readonly [id: string, code: string, status?: string]

const project = (languages: readonly HeldLanguage[]) =>
  ok({
    status: "dubbed",
    sourceLanguage: "en",
    durationSec: 120,
    languages: languages.map(([id, code, status = "completed"]) => ({ id, code, status })),
  })

const regular = () => ok({ status: "dubbed", sourceLanguage: "en", targetLanguages: ["es"], durationSec: 90 })

const inProject = (languageId: string) => ({ kind: "project", taskId: expect.any(String), languageId })

async function languagesOf(asked: DubFamily) {
  const outcome = await resolveDubFamily(asked)
  if (!outcome.ok) throw new Error(`refused: ${outcome.problem.code}`)
  return outcome.value.languages
}

beforeEach(() => {
  service.readProjectDub.mockReset()
  service.readRegularDub.mockReset()
  service.readRegularDub.mockResolvedValue(regular())
})

describe("dubEngineOf", () => {
  it("tells the engine by the id the job kept", () => {
    expect(dubEngineOf({ providerTaskId: "project:p1:l1" })).toBe("project")
    expect(dubEngineOf({ providerTaskId: "project:p1" })).toBe("project")
    expect(dubEngineOf({ providerTaskId: "dub_1" })).toBe("regular")
  })

  it("tells none for a job that kept no id", () => {
    expect(dubEngineOf({ providerTaskId: null })).toBeNull()
    expect(dubEngineOf({ providerTaskId: "" })).toBeNull()
  })
})

describe("askService", () => {
  it("answers what the read answered", async () => {
    await expect(askService(async () => 7)).resolves.toBe(7)
  })

  it("marks a failed read as the service's failure and keeps its reason", async () => {
    const reason = new Error("socket hang up")

    const failure = await askService(async () => Promise.reject(reason)).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(DubbingServiceError)
    expect((failure as DubbingServiceError).reason).toBe(reason)
  })
})

describe("resolveDubFamily: a dub that cannot be read", () => {
  it.each(["pending", "queued", "processing", "pending_review", "something_new"])("is not ready while its job is %s", async (status) => {
    const outcome = await resolveDubFamily(family(job(FIRST, "dub_1", "es", { status })))

    expect(outcome).toEqual({ ok: false, problem: DUBBING_PROBLEMS.notReady })
    expect(service.readRegularDub).not.toHaveBeenCalled()
  })

  it.each(["failed", "cancelled"])("has nothing to read when its job %s", async (status) => {
    const outcome = await resolveDubFamily(family(job(FIRST, "project:p1", "he", { status })))

    expect(outcome).toEqual({ ok: false, problem: DUBBING_PROBLEMS.failed })
    expect(service.readProjectDub).not.toHaveBeenCalled()
  })

  it.each([null, ""])("is unavailable when its finished job kept no id (%j)", async (providerTaskId) => {
    const outcome = await resolveDubFamily(family(job(FIRST, providerTaskId, "es")))

    expect(outcome).toEqual({ ok: false, problem: DUBBING_PROBLEMS.unavailable })
    expect(service.readRegularDub).not.toHaveBeenCalled()
    expect(service.readProjectDub).not.toHaveBeenCalled()
  })

  it.each([
    ["regular", "dub_1", "readRegularDub"],
    ["project", "project:p1", "readProjectDub"],
  ] as const)("answers what the service says of a %s dub it no longer tells", async (_engine, taskId, read) => {
    const asked = family(job(FIRST, taskId, "es"))

    service[read].mockResolvedValue({ kind: "gone" })
    expect(await resolveDubFamily(asked)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.unavailable })

    service[read].mockResolvedValue({ kind: "processing" })
    expect(await resolveDubFamily(asked)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.notReady })

    service[read].mockResolvedValue({ kind: "unsupported", code: "not_dubbable" })
    const refused = await resolveDubFamily(asked)
    expect(refused).toMatchObject({ ok: false, problem: DUBBING_PROBLEMS.readFailed })
    expect(refused.ok ? "" : String(refused.cause)).toContain("not_dubbable")
  })

  it.each([
    ["regular", "dub_1", "readRegularDub"],
    ["project", "project:p1", "readProjectDub"],
  ] as const)("throws the service's failure when a %s dub cannot be asked", async (_engine, taskId, read) => {
    service[read].mockRejectedValue(new Error("boom"))

    await expect(resolveDubFamily(family(job(FIRST, taskId, "es")))).rejects.toBeInstanceOf(DubbingServiceError)
  })
})

describe("resolveDubFamily: a regular dub", () => {
  it("tells the dub and its one language", async () => {
    const anchor = job(FIRST, "dub_1", "es")

    const outcome = await resolveDubFamily(family(anchor))

    expect(outcome).toEqual({
      ok: true,
      value: {
        familyId: FIRST,
        anchor,
        engine: "regular",
        durationSec: 90,
        sourceLanguage: "en",
        languages: [{ code: "es", jobId: FIRST, status: "completed", ref: { kind: "regular", dubbingId: "dub_1", code: "es" } }],
      },
    })
    expect(service.readRegularDub).toHaveBeenCalledExactlyOnceWith("dub_1")
  })

  it("lists each added language by its own job, in the order they were added", async () => {
    const languages = await languagesOf(
      family(job(FIRST, "dub_1", "es"), [
        job(ADDED, "dub_2", "fr"),
        job(THIRD, null, "de", { status: "processing" }),
        job(GONE_ROOT, "dub_4", "it", { status: "failed" }),
      ]),
    )

    expect(languages).toEqual([
      { code: "es", jobId: FIRST, status: "completed", ref: { kind: "regular", dubbingId: "dub_1", code: "es" } },
      { code: "fr", jobId: ADDED, status: "completed", ref: { kind: "regular", dubbingId: "dub_2", code: "fr" } },
      { code: "de", jobId: THIRD, status: "processing", ref: null },
      { code: "it", jobId: GONE_ROOT, status: "failed", ref: null },
    ])
    // An added language is a dub of its own: only the first one is asked about here.
    expect(service.readRegularDub).toHaveBeenCalledTimes(1)
    expect(service.readProjectDub).not.toHaveBeenCalled()
  })

  it("keeps the code as it was asked for, without the spaces around it", async () => {
    const languages = await languagesOf(family(job(FIRST, "dub_1", " pt-BR ")))

    expect(languages).toEqual([
      { code: "pt-BR", jobId: FIRST, status: "completed", ref: { kind: "regular", dubbingId: "dub_1", code: "pt-BR" } },
    ])
  })

  it("reads an added language that was made as a project from that project", async () => {
    service.readProjectDub.mockResolvedValue(project([["l1", "he", "stale"]]))

    const languages = await languagesOf(family(job(FIRST, "dub_1", "es"), [job(ADDED, "project:p7", "he")]))

    expect(languages[1]).toEqual({ code: "he", jobId: ADDED, status: "stale", ref: { kind: "project", taskId: "project:p7", languageId: "l1" } })
    expect(service.readProjectDub).toHaveBeenCalledExactlyOnceWith("project:p7")
  })

  it("lists a finished language it can no longer find, with nowhere to read it from", async () => {
    service.readProjectDub.mockResolvedValue({ kind: "gone" })

    const languages = await languagesOf(
      family(job(FIRST, "dub_1", "es"), [job(ADDED, "project:p7", "he"), job(THIRD, null, "fr")]),
    )

    expect(languages.slice(1)).toEqual([
      { code: "he", jobId: ADDED, status: "completed", ref: null },
      { code: "fr", jobId: THIRD, status: "completed", ref: null },
    ])
  })

  it("lists no language the service holds without a job: each regular dub is one job's", async () => {
    const languages = await languagesOf(family(job(FIRST, "dub_1", "es"), [job(ADDED, "dub_2", "fr", { status: "failed" })]))

    expect(languages.map((language) => language.jobId)).toEqual([FIRST, ADDED])
  })

  it("throws the service's failure when an added language's project cannot be asked", async () => {
    service.readProjectDub.mockRejectedValue(new Error("boom"))

    await expect(resolveDubFamily(family(job(FIRST, "dub_1", "es"), [job(ADDED, "project:p7", "he")]))).rejects.toBeInstanceOf(
      DubbingServiceError,
    )
  })
})

describe("resolveDubFamily: one entry per language", () => {
  it("prefers the language that was made over an earlier try that failed, at the earlier place", async () => {
    const languages = await languagesOf(
      family(job(FIRST, "dub_1", "es"), [
        job(ADDED, null, "fr", { status: "failed" }),
        job(THIRD, "dub_3", "de"),
        job(GONE_ROOT, "dub_4", "FR"),
      ]),
    )

    expect(languages.map(({ code, jobId, status }) => [code, jobId, status])).toEqual([
      ["es", FIRST, "completed"],
      ["FR", GONE_ROOT, "completed"],
      ["de", THIRD, "completed"],
    ])
  })

  it("prefers the newest of two jobs that are equally far along", async () => {
    const languages = await languagesOf(
      family(job(FIRST, "dub_1", "es"), [
        job(ADDED, "dub_2", "fr", { createdAt: "2026-11-02T10:00:00.000Z" }),
        job(THIRD, "dub_3", "fr", { createdAt: "2026-11-03T10:00:00.000Z" }),
      ]),
    )

    expect(languages.map(({ code, jobId }) => [code, jobId])).toEqual([
      ["es", FIRST],
      ["fr", THIRD],
    ])
  })

  it("prefers a language being made over one that failed", async () => {
    const languages = await languagesOf(
      family(job(FIRST, "dub_1", "es"), [
        job(ADDED, null, "fr", { status: "processing", createdAt: "2026-11-02T10:00:00.000Z" }),
        job(THIRD, null, "fr", { status: "failed", createdAt: "2026-11-03T10:00:00.000Z" }),
      ]),
    )

    expect(languages[1]).toEqual({ code: "fr", jobId: ADDED, status: "processing", ref: null })
  })

  it("reads both codes of the project engine's language as one language", async () => {
    service.readProjectDub.mockResolvedValue(project([["l1", "he"]]))

    const languages = await languagesOf(
      family(job(FIRST, "dub_1", "es"), [job(ADDED, null, "heb", { status: "failed" }), job(THIRD, "project:p7", "he")]),
    )

    expect(languages.map(({ code, jobId }) => [code, jobId])).toEqual([
      ["es", FIRST],
      ["he", THIRD],
    ])
  })
})

describe("resolveDubFamily: a project dub", () => {
  it("tells the dub and reads its project once, however many jobs live in it", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "en"],
        ["l3", "fr", "stale"],
      ]),
    )
    const anchor = job(FIRST, "project:p1", "he")

    const outcome = await resolveDubFamily(family(anchor, [job(ADDED, "project:p1:l2", "en"), job(THIRD, "project:p1:l3", "fr")]))

    expect(outcome).toEqual({
      ok: true,
      value: {
        familyId: FIRST,
        anchor,
        engine: "project",
        durationSec: 120,
        sourceLanguage: "en",
        languages: [
          { code: "he", jobId: FIRST, status: "completed", ref: { kind: "project", taskId: "project:p1", languageId: "l1" } },
          { code: "en", jobId: ADDED, status: "completed", ref: { kind: "project", taskId: "project:p1:l2", languageId: "l2" } },
          { code: "fr", jobId: THIRD, status: "stale", ref: { kind: "project", taskId: "project:p1:l3", languageId: "l3" } },
        ],
      },
    })
    expect(service.readProjectDub).toHaveBeenCalledTimes(1)
    expect(service.readRegularDub).not.toHaveBeenCalled()
  })

  it("lists a language the project holds and no job delivers, after the delivered ones", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "fr", "queued"],
        ["l3", "de"],
        ["l4", "it", "failed"],
        ["l5", "ja", "stale"],
        ["l6", "ko", "a_new_state"],
        ["l7", "en"],
      ]),
    )

    const languages = await languagesOf(family(job(FIRST, "project:p1", "he"), [job(ADDED, "project:p1:l7", "en")]))

    expect(languages).toEqual([
      { code: "he", jobId: FIRST, status: "completed", ref: inProject("l1") },
      { code: "en", jobId: ADDED, status: "completed", ref: inProject("l7") },
      { code: "fr", jobId: null, status: "processing", ref: inProject("l2") },
      { code: "de", jobId: null, status: "completed", ref: inProject("l3") },
      { code: "it", jobId: null, status: "failed", ref: inProject("l4") },
      { code: "ja", jobId: null, status: "stale", ref: inProject("l5") },
      { code: "ko", jobId: null, status: "processing", ref: inProject("l6") },
    ])
  })

  it("lists the first language with no job when the first job is gone", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "en"],
      ]),
    )
    const anchor = job(ADDED, "project:p1:l2", "en", { input: { type: "dubbing", targetLanguage: "en", sourceDubJobId: GONE_ROOT } })

    const outcome = await resolveDubFamily(family(anchor, [], GONE_ROOT))

    expect(outcome).toMatchObject({ ok: true, value: { familyId: GONE_ROOT, anchor, engine: "project" } })
    expect(outcome.ok ? outcome.value.languages : []).toEqual([
      { code: "en", jobId: ADDED, status: "completed", ref: inProject("l2") },
      { code: "he", jobId: null, status: "completed", ref: inProject("l1") },
    ])
  })

  it("counts a language as delivered by the job that is still making it", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "fr", "processing"],
      ]),
    )

    const languages = await languagesOf(
      family(job(FIRST, "project:p1", "he"), [job(ADDED, "project:p1:l2", "fr", { status: "processing" })]),
    )

    expect(languages).toEqual([
      { code: "he", jobId: FIRST, status: "completed", ref: inProject("l1") },
      { code: "fr", jobId: ADDED, status: "processing", ref: null },
    ])
  })

  it("counts a language as delivered by a job that has not reached the service yet", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "fr", "queued"],
      ]),
    )
    const adding = job(ADDED, null, "fr", { status: "queued" })

    const languages = await languagesOf(family(job(FIRST, "project:p1", "he"), [adding]))

    expect(languages[1]).toEqual({ code: "fr", jobId: ADDED, status: "processing", ref: null })
    expect(languages).toHaveLength(2)
  })

  it("counts a language as delivered by the job made to take it over, whatever code that job asked for", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "pt"],
      ]),
    )
    const takingOver = job(ADDED, null, "pt-BR", {
      status: "processing",
      input: { type: "dubbing", targetLanguage: "pt-BR", projectTaskId: "project:p1", adoptLanguageId: "l2" },
    })

    const languages = await languagesOf(family(job(FIRST, "project:p1", "he"), [takingOver]))

    expect(languages).toEqual([
      { code: "he", jobId: FIRST, status: "completed", ref: inProject("l1") },
      { code: "pt-BR", jobId: ADDED, status: "processing", ref: null },
    ])
  })

  it("does not count a take-over of another project's language", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "pt"],
      ]),
    )
    const elsewhere = job(ADDED, null, "de", {
      status: "processing",
      input: { type: "dubbing", targetLanguage: "de", projectTaskId: "project:p9", adoptLanguageId: "l2" },
    })

    const languages = await languagesOf(family(job(FIRST, "project:p1", "he"), [elsewhere]))

    expect(languages.map(({ code, jobId }) => [code, jobId])).toEqual([
      ["he", FIRST],
      ["de", ADDED],
      ["pt", null],
    ])
  })

  it("frees the language of a job that failed, so it can be delivered again", async () => {
    service.readProjectDub.mockResolvedValue(
      project([
        ["l1", "he"],
        ["l2", "fr"],
        ["l3", "de", "failed"],
      ]),
    )

    const languages = await languagesOf(
      family(job(FIRST, "project:p1", "he"), [
        job(ADDED, "project:p1:l2", "FR", { status: "failed" }),
        job(THIRD, "project:p1:l3", "de", { status: "failed" }),
      ]),
    )

    expect(languages).toEqual([
      { code: "he", jobId: FIRST, status: "completed", ref: inProject("l1") },
      // The project made it although the job failed: it is there to be delivered, under the project's own code.
      { code: "fr", jobId: null, status: "completed", ref: inProject("l2") },
      // Failed on both sides: the job that failed is the one to show.
      { code: "de", jobId: THIRD, status: "failed", ref: null },
    ])
  })

  it("lists a finished job's language with nowhere to read it from when the project no longer holds it", async () => {
    service.readProjectDub.mockResolvedValue(project([["l1", "he"]]))

    const languages = await languagesOf(family(job(FIRST, "project:p1", "he"), [job(ADDED, "project:p1:l404", "en")]))

    expect(languages).toEqual([
      { code: "he", jobId: FIRST, status: "completed", ref: inProject("l1") },
      { code: "en", jobId: ADDED, status: "completed", ref: null },
    ])
  })

  it("reads a job of another project from that project, and lists only its own project's spare languages", async () => {
    service.readProjectDub.mockImplementation(async (taskId: string) =>
      taskId.startsWith("project:p1")
        ? project([
            ["l1", "he"],
            ["l2", "fr"],
          ])
        : project([
            ["x1", "he"],
            ["x2", "ja"],
          ]),
    )

    const languages = await languagesOf(family(job(FIRST, "project:p1", "he"), [job(ADDED, "project:p2:x2", "ja")]))

    expect(languages).toEqual([
      { code: "he", jobId: FIRST, status: "completed", ref: { kind: "project", taskId: "project:p1", languageId: "l1" } },
      { code: "ja", jobId: ADDED, status: "completed", ref: { kind: "project", taskId: "project:p2:x2", languageId: "x2" } },
      { code: "fr", jobId: null, status: "completed", ref: { kind: "project", taskId: "project:p1", languageId: "l2" } },
    ])
    expect(service.readProjectDub).toHaveBeenCalledTimes(2)
  })

  it("falls back to the project's own code when the job asked for none", async () => {
    service.readProjectDub.mockResolvedValue(project([["l1", "he"]]))

    const languages = await languagesOf(family(job(FIRST, "project:p1", "  ")))

    expect(languages).toEqual([{ code: "he", jobId: FIRST, status: "completed", ref: inProject("l1") }])
  })
})
