/**
 * What a published app's runner sees of a run (`appRunViewStates`) never
 * carries a failed node's provider words (`errorDetail`): they can quote the
 * creator's prompt. That holds whatever the deployment's `jobs.errorDetail`
 * setting says (lib/provider-words.ts) — with no setting, and with the words
 * kept for admins — since a runner is never an admin reader.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests, surfaceJobErrorDetailReaders } from "../surface-profile.js"
import { appRunViewStates } from "../app-run-states.js"

const WORDS = "provider said: the prompt 'a red fox at dawn' was flagged"

const failedWithWords = () => ({ status: "failed", error: "Generation failed", errorDetail: WORDS, jobId: "j1" })
const failedWithoutWords = () => ({ status: "failed", error: "Generation failed", jobId: "j1" })
const completed = () => ({ status: "completed", output: { imageUrl: "https://cdn.example/x.png" }, jobId: "j2" })

const SETTINGS = [
  ["with no setting", undefined, "owner"],
  ["with the words kept for admins", { jobs: { errorDetail: "admin" } }, "admin"],
  ["with the words shown to owners", { jobs: { errorDetail: "owner" } }, "owner"],
] as const

describe("appRunViewStates — a runner never gets the provider's words", () => {
  const prevEdition = config.EDITION
  const prevProfile = process.env.NODARO_SURFACE_PROFILE

  beforeEach(() => {
    config.EDITION = "business"
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  afterEach(() => {
    config.EDITION = prevEdition
    if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = prevProfile
    __resetSurfaceProfileCacheForTests()
  })

  function setProfile(profile: unknown): void {
    if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
  }

  describe.each(SETTINGS)("%s", (_label, profile, readers) => {
    beforeEach(() => setProfile(profile))

    it("the setting is in force", () => {
      expect(surfaceJobErrorDetailReaders()).toBe(readers)
    })

    it("drops them from the run's states and leaves every other field and node as it was", () => {
      const base = { n1: failedWithWords(), n2: completed() }
      const view = appRunViewStates(base, [], null) as Record<string, Record<string, unknown>>
      expect(view.n1).not.toHaveProperty("errorDetail")
      expect(view.n1).toEqual(failedWithoutWords())
      expect(view.n2).toEqual(completed())
      // The run's own states are never changed.
      expect(base.n1.errorDetail).toBe(WORDS)
    })

    it("drops them from a final's states and from the runner's edits too", () => {
      const view = appRunViewStates(
        { n1: completed() },
        [{ id: "f", status: "completed", nodeStates: { n1: { ...completed(), errorDetail: "final words" } } }],
        { n1: { errorDetail: "edited words", output: { note: "kept" } } },
      ) as Record<string, Record<string, unknown>>
      expect(view.n1).not.toHaveProperty("errorDetail")
      expect((view.n1.output as Record<string, unknown>).note).toBe("kept")
    })

    it("returns states with nothing to drop as the same object", () => {
      const base = { n1: { status: "failed", error: "Generation failed", jobId: "j1" }, n2: completed() }
      expect(appRunViewStates(base, [], null)).toBe(base)
    })

    it("a view with no states stays null", () => {
      expect(appRunViewStates(null, [], null)).toBeNull()
    })
  })
})
