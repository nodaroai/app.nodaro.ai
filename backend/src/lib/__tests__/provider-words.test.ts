/**
 * Who reads a failed job's provider words (`jobs.errorDetail` on the surface
 * profile) and the funnel that applies it (lib/provider-words.ts). Absent means
 * today's behaviour, the same objects and the same text; "admin" keeps the words
 * for admins, and any other value falls to "admin".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests, parseSurfaceProfile, surfaceJobErrorDetailReaders } from "../surface-profile.js"
import { renderSurfaceProfileForRuntimeConfig } from "../surface-profile-runtime-config.js"
import {
  jobRowNeedsRunRelation,
  jobRowProviderWords,
  jobRowProviderWordsFor,
  jobRowProviderWordsTo,
  runIdOf,
  webhookBodyNeedsRunRelation,
  nodeStatesCarryProviderWords,
  providerWordsShown,
  providerWordsShownTo,
  runStatesNeedReaderRelation,
  runStatesProviderWords,
  savedNodesProviderWords,
  webhookBodyProviderWords,
  withoutNodeStateProviderWords,
} from "../provider-words.js"
import { maskTrendRunError, TREND_RUN_FAILURE_MESSAGE } from "../public-job-data.js"

const WORDS = "Prompt rejected by upstream safety system (host: api.example.com)"

function setProfile(profile: unknown): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

beforeEach(() => {
  config.EDITION = "business"
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  config.EDITION = prevEdition
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
  vi.restoreAllMocks()
})

describe("jobs.errorDetail — parsing", () => {
  it("absent: no `jobs` key on the profile", () => {
    expect(parseSurfaceProfile(JSON.stringify({ brand: { productName: "Acme" } }))).not.toHaveProperty("jobs")
    expect(parseSurfaceProfile(JSON.stringify({ jobs: {} }))).not.toHaveProperty("jobs")
  })

  it("the two values are taken as written", () => {
    expect(parseSurfaceProfile(JSON.stringify({ jobs: { errorDetail: "owner" } })).jobs).toEqual({ errorDetail: "owner" })
    expect(parseSurfaceProfile(JSON.stringify({ jobs: { errorDetail: "admin" } })).jobs).toEqual({ errorDetail: "admin" })
  })

  it("any other value falls to the restrictive side, admin, with a warning", () => {
    for (const value of ["Owner", "ADMIN", "everyone", "", 42, true, null, ["owner"], { who: "owner" }]) {
      expect(parseSurfaceProfile(JSON.stringify({ jobs: { errorDetail: value } })).jobs, JSON.stringify(value)).toEqual({ errorDetail: "admin" })
    }
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("jobs.errorDetail"))
  })

  it("a `jobs` that is not an object falls to admin too", () => {
    for (const value of ["admin", "owner", 1, null, []]) {
      expect(parseSurfaceProfile(JSON.stringify({ jobs: value })).jobs, JSON.stringify(value)).toEqual({ errorDetail: "admin" })
    }
  })

  it("a bad value degrades alone: the profile's other keys stay", () => {
    const profile = parseSurfaceProfile(JSON.stringify({ nav: { hide: ["gallery"] }, imports: { links: false }, jobs: { errorDetail: "nobody" } }))
    expect(profile.nav.hide).toEqual(["gallery"])
    expect(profile.imports).toEqual({ links: false })
    expect(profile.jobs).toEqual({ errorDetail: "admin" })
  })
})

describe("surfaceJobErrorDetailReaders", () => {
  it("owner with no profile, and with a profile that leaves `jobs` out", () => {
    expect(surfaceJobErrorDetailReaders()).toBe("owner")
    setProfile({ brand: { productName: "Acme" } })
    expect(surfaceJobErrorDetailReaders()).toBe("owner")
  })

  it("what the profile says on business and cloud", () => {
    setProfile({ jobs: { errorDetail: "admin" } })
    expect(surfaceJobErrorDetailReaders()).toBe("admin")
    config.EDITION = "cloud"
    __resetSurfaceProfileCacheForTests()
    expect(surfaceJobErrorDetailReaders()).toBe("admin")
    setProfile({ jobs: { errorDetail: "owner" } })
    expect(surfaceJobErrorDetailReaders()).toBe("owner")
  })

  it("community ignores the profile, as every surface key", () => {
    config.EDITION = "community"
    setProfile({ jobs: { errorDetail: "admin" } })
    expect(surfaceJobErrorDetailReaders()).toBe("owner")
  })
})

describe("/config.js never carries the key", () => {
  it("a profile without `jobs` renders exactly as before: the whole profile, once", () => {
    config.EDITION = "cloud"
    setProfile({ nav: { hide: ["gallery"] }, imports: { links: false } })
    const rendered = renderSurfaceProfileForRuntimeConfig()
    expect(rendered).toBe(JSON.stringify(parseSurfaceProfile(process.env.NODARO_SURFACE_PROFILE)))
  })

  it("with `jobs` set, it is left out and everything else is what the profile without it renders", () => {
    config.EDITION = "cloud"
    setProfile({ nav: { hide: ["gallery"] }, imports: { links: false } })
    const without = renderSurfaceProfileForRuntimeConfig()
    setProfile({ nav: { hide: ["gallery"] }, imports: { links: false }, jobs: { errorDetail: "admin" } })
    const withJobs = renderSurfaceProfileForRuntimeConfig()
    expect(JSON.parse(withJobs)).not.toHaveProperty("jobs")
    expect(withJobs).not.toMatch(/errorDetail/)
    expect(withJobs).toBe(without)
  })
})

describe("the funnel", () => {
  const failed = { id: "j1", status: "failed", error_message: "Generation failed.", error_detail: WORDS, error_hint: null }

  it("the decision: every reader sees the words unless the deployment keeps them for admins", () => {
    expect(providerWordsShown(false)).toBe(true)
    expect(providerWordsShown(true)).toBe(true)
    setProfile({ jobs: { errorDetail: "admin" } })
    expect(providerWordsShown(false)).toBe(false)
    expect(providerWordsShown(true)).toBe(true)
  })

  it("a job row: the same object when shown; the same keys with error_detail null when withheld", () => {
    expect(jobRowProviderWords(failed, false)).toBe(failed)
    setProfile({ jobs: { errorDetail: "admin" } })
    const withheld = jobRowProviderWords(failed, false)
    expect(withheld).toEqual({ ...failed, error_detail: null })
    expect(Object.keys(withheld)).toEqual(Object.keys(failed))
    expect(failed.error_detail).toBe(WORDS)
    expect(jobRowProviderWords(failed, true)).toBe(failed)
  })

  it("a row with no words, or no column, is returned as it came under either setting", () => {
    setProfile({ jobs: { errorDetail: "admin" } })
    const noWords = { ...failed, error_detail: null }
    const noColumn = { id: "j2", status: "completed" }
    expect(jobRowProviderWords(noWords, false)).toBe(noWords)
    expect(jobRowProviderWords(noColumn, false)).toBe(noColumn)
  })

  it("maskTrendRunError applies it to every job, and a trend run keeps its own mask", () => {
    expect(maskTrendRunError(failed, false)).toBe(failed)
    setProfile({ jobs: { errorDetail: "admin" } })
    expect(maskTrendRunError(failed, false)).toEqual({ ...failed, error_detail: null })
    expect(maskTrendRunError(failed, true)).toBe(failed)
    const trend = { ...failed, input_data: { trend: "dance" } }
    expect(maskTrendRunError(trend, false)).toEqual({ ...trend, error_message: TREND_RUN_FAILURE_MESSAGE, error_detail: null })
    expect(maskTrendRunError(trend, true)).toBe(trend)
  })

  describe("a run's node states", () => {
    const states = {
      a: { status: "failed", error: "Generation failed.", errorDetail: WORDS, jobId: "j1" },
      b: { status: "completed", output: { imageUrl: "https://cdn.example.com/b.png" } },
      c: { status: "failed", error: "Timed out." },
    }

    const opener = { isAdmin: false, canRead: true }
    const stranger = { isAdmin: false, canRead: false }
    const admin = { isAdmin: true, canRead: false }

    it("the same object for a reader who can open the run's workflow, and for an admin", () => {
      expect(runStatesProviderWords(states, opener)).toBe(states)
      expect(runStatesProviderWords(states, admin)).toBe(states)
      setProfile({ jobs: { errorDetail: "admin" } })
      expect(runStatesProviderWords(states, admin)).toBe(states)
    })

    it("withheld from a reader who cannot open the workflow, whatever the setting, and from a non-admin under admin", () => {
      const without = { a: { status: "failed", error: "Generation failed.", jobId: "j1" }, b: states.b, c: states.c }
      expect(runStatesProviderWords(states, stranger)).toEqual(without)
      setProfile({ jobs: { errorDetail: "admin" } })
      const out = runStatesProviderWords(states, opener)
      expect(out).toEqual(without)
      expect("errorDetail" in out.a).toBe(false)
      expect(out.b).toBe(states.b)
      expect(states.a.errorDetail).toBe(WORDS)
    })

    it("no states and states with nothing to drop pass as they are", () => {
      expect(runStatesProviderWords(null, stranger)).toBeNull()
      expect(runStatesProviderWords(undefined, stranger)).toBeUndefined()
      const clean = { b: states.b, c: states.c }
      expect(runStatesProviderWords(clean, stranger)).toBe(clean)
    })

    it("a reader's relation is needed only when a state carries words a non-admin could be shown", () => {
      expect(nodeStatesCarryProviderWords(states)).toBe(true)
      expect(nodeStatesCarryProviderWords({ b: states.b, c: states.c })).toBe(false)
      expect(nodeStatesCarryProviderWords(null)).toBe(false)
      expect(runStatesNeedReaderRelation(states, false)).toBe(true)
      expect(runStatesNeedReaderRelation(states, true)).toBe(false)
      expect(runStatesNeedReaderRelation({ c: states.c }, false)).toBe(false)
      setProfile({ jobs: { errorDetail: "admin" } })
      expect(runStatesNeedReaderRelation(states, false)).toBe(false)
    })

    it("the runner's view drops them whatever the setting", () => {
      expect(withoutNodeStateProviderWords(states)).toEqual({ a: { status: "failed", error: "Generation failed.", jobId: "j1" }, b: states.b, c: states.c })
    })
  })

  it("the decision with a relation: an admin always; anyone else only for words that are theirs, where the deployment lets them", () => {
    expect(providerWordsShownTo({ isAdmin: false, canRead: true })).toBe(true)
    expect(providerWordsShownTo({ isAdmin: false, canRead: false })).toBe(false)
    expect(providerWordsShownTo({ isAdmin: true, canRead: false })).toBe(true)
    setProfile({ jobs: { errorDetail: "admin" } })
    expect(providerWordsShownTo({ isAdmin: false, canRead: true })).toBe(false)
    expect(providerWordsShownTo({ isAdmin: true, canRead: false })).toBe(true)
  })

  describe("a job row from a read that can return someone else's job", () => {
    const own = { ...failed, user_id: "me" }
    const theirs = { ...failed, user_id: "someone-else" }

    it("the owner's own row is the same object; someone else's has error_detail null, same keys", () => {
      expect(jobRowProviderWordsFor(own, { isAdmin: false, userId: "me" })).toBe(own)
      const out = jobRowProviderWordsFor(theirs, { isAdmin: false, userId: "me" })
      expect(out).toEqual({ ...theirs, error_detail: null })
      expect(Object.keys(out)).toEqual(Object.keys(theirs))
    })

    it("an admin reads anyone's; a row without the owner column never carries them; a row without words is as it came", () => {
      expect(jobRowProviderWordsFor(theirs, { isAdmin: true, userId: "me" })).toBe(theirs)
      expect(jobRowProviderWordsFor(failed, { isAdmin: false, userId: "me" })).toEqual({ ...failed, error_detail: null })
      const noWords = { ...theirs, error_detail: null }
      expect(jobRowProviderWordsFor(noWords, { isAdmin: false, userId: "me" })).toBe(noWords)
    })

    it("under admin, the owner's own row loses them too", () => {
      setProfile({ jobs: { errorDetail: "admin" } })
      expect(jobRowProviderWordsFor(own, { isAdmin: false, userId: "me" })).toEqual({ ...own, error_detail: null })
    })
  })

  describe("a workflow's saved nodes, as a share page serves them", () => {
    const nodes = [
      { id: "n1", type: "generate-image", data: { label: "Image", executionStatus: "failed", errorMessage: "Generation failed.", errorDetail: WORDS } },
      { id: "n2", type: "text-prompt", data: { label: "Prompt", text: "a cat" } },
    ]

    it("the same array for the creator and an admin", () => {
      expect(savedNodesProviderWords(nodes, { isAdmin: false, canRead: true })).toBe(nodes)
      expect(savedNodesProviderWords(nodes, { isAdmin: true, canRead: false })).toBe(nodes)
    })

    it("anyone else: each node's data without errorDetail, everything else as it was", () => {
      const out = savedNodesProviderWords(nodes, { isAdmin: false, canRead: false })
      expect(out).toEqual([
        { id: "n1", type: "generate-image", data: { label: "Image", executionStatus: "failed", errorMessage: "Generation failed." } },
        nodes[1],
      ])
      expect(out[1]).toBe(nodes[1])
      expect(nodes[0]!.data.errorDetail).toBe(WORDS)
    })

    it("nodes with nothing to drop, and a value that is not a node list, pass as they are; under admin the creator loses them", () => {
      const clean = [nodes[1]]
      expect(savedNodesProviderWords(clean, { isAdmin: false, canRead: false })).toBe(clean)
      expect(savedNodesProviderWords(null, { isAdmin: false, canRead: false })).toBeNull()
      setProfile({ jobs: { errorDetail: "admin" } })
      expect(savedNodesProviderWords(nodes, { isAdmin: false, canRead: true })[0]).not.toHaveProperty("data.errorDetail")
    })
  })

  describe("a recorded webhook body", () => {
    const event = { id: "d1", type: "job.failed", createdAt: "2026-11-11T10:00:00.000Z", data: { job: { id: "j1", status: "failed", error_message: "Generation failed.", error_detail: WORDS, credits: 10 } } }
    const body = JSON.stringify(event)

    it("byte for byte when shown", () => {
      expect(webhookBodyProviderWords(body)).toBe(body)
    })

    it("withheld: the job's error_detail null, every other byte as it was", () => {
      setProfile({ jobs: { errorDetail: "admin" } })
      const out = webhookBodyProviderWords(body)
      expect(out).toBe(JSON.stringify({ ...event, data: { job: { ...event.data.job, error_detail: null } } }))
    })

    it("a body with nothing to withhold is the same text: no words, a ping, not an event", () => {
      setProfile({ jobs: { errorDetail: "admin" } })
      const noWords = JSON.stringify({ ...event, data: { job: { ...event.data.job, error_detail: null } } })
      const ping = JSON.stringify({ id: "d2", type: "ping", createdAt: event.createdAt, data: { webhookId: "w1" } })
      for (const text of [noWords, ping, "not json", "[]"]) expect(webhookBodyProviderWords(text)).toBe(text)
    })

    it("of a run's job its owner cannot open: error_detail null whatever the setting; the same text when there is nothing to withhold", () => {
      expect(webhookBodyProviderWords(body, false)).toBe(JSON.stringify({ ...event, data: { job: { ...event.data.job, error_detail: null } } }))
      expect(webhookBodyProviderWords(body, true)).toBe(body)
      const ping = JSON.stringify({ id: "d2", type: "ping", createdAt: event.createdAt, data: { webhookId: "w1" } })
      for (const text of [ping, "not json"]) expect(webhookBodyProviderWords(text, false)).toBe(text)
    })

    it("asks for the run only for a body whose job carries words, where an owner may read them", () => {
      expect(webhookBodyNeedsRunRelation(body)).toBe(true)
      expect(webhookBodyNeedsRunRelation(JSON.stringify({ ...event, data: { job: { ...event.data.job, error_detail: null } } }))).toBe(false)
      expect(webhookBodyNeedsRunRelation(null)).toBe(false)
      expect(webhookBodyNeedsRunRelation("not json")).toBe(false)
      setProfile({ jobs: { errorDetail: "admin" } })
      expect(webhookBodyNeedsRunRelation(body)).toBe(false)
    })
  })

  describe("a run's job (decided 2026-11-11)", () => {
    const ofRun = { ...failed, workflow_execution_id: "run-1" }

    it("a reader who may read: the same object; one who may not: error_detail null, same keys; an admin: the same object", () => {
      expect(jobRowProviderWordsTo(ofRun, { isAdmin: false, canRead: true })).toBe(ofRun)
      const out = jobRowProviderWordsTo(ofRun, { isAdmin: false, canRead: false })
      expect(out).toEqual({ ...ofRun, error_detail: null })
      expect(Object.keys(out)).toEqual(Object.keys(ofRun))
      expect(jobRowProviderWordsTo(ofRun, { isAdmin: true, canRead: false })).toBe(ofRun)
    })

    it("asks for the run only for a run's job with words, a reader who is not an admin, and a deployment that shows words to owners", () => {
      expect(runIdOf(ofRun)).toBe("run-1")
      expect(runIdOf(failed)).toBeNull()
      expect(runIdOf({ ...failed, workflow_execution_id: "" })).toBeNull()
      expect(jobRowNeedsRunRelation(ofRun, false)).toBe(true)
      expect(jobRowNeedsRunRelation(ofRun, true)).toBe(false)
      expect(jobRowNeedsRunRelation({ ...ofRun, error_detail: null }, false)).toBe(false)
      expect(jobRowNeedsRunRelation({ ...ofRun, workflow_execution_id: null }, false)).toBe(false)
      setProfile({ jobs: { errorDetail: "admin" } })
      expect(jobRowNeedsRunRelation(ofRun, false)).toBe(false)
    })
  })
})
