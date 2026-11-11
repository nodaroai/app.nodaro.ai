/**
 * Which jobs a person may read by id (`lib/public-job-read.ts`): their own, and
 * anyone's public completed one — unless the deployment does not allow public
 * work (`outputs.allowPublic: false`), where only their own. With the switch on
 * the filter is byte for byte what every caller sent before.
 */
import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  isCloud: () => true,
  isBusiness: () => false,
}))

import { jobReadableBy, readableJobsFilter } from "../public-job-read.js"
import { favoritableJobFilter } from "../gallery-favorites.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

const ME = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => setProfile(null))

const PUBLIC_DONE = { user_id: OTHER, is_public: true, status: "completed" }

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("with public outputs allowed: %s", (_label, profile) => {
  it("the filter is the caller's own job or any public completed one, as before", () => {
    setProfile(profile)
    expect(readableJobsFilter(ME)).toBe(`user_id.eq.${ME},and(is_public.eq.true,status.eq.completed)`)
    expect(favoritableJobFilter(ME)).toBe(readableJobsFilter(ME))
  })

  it("someone else's public completed job is readable; a private or unfinished one is not", () => {
    setProfile(profile)
    expect(jobReadableBy(PUBLIC_DONE, ME)).toBe(true)
    expect(jobReadableBy({ ...PUBLIC_DONE, is_public: false }, ME)).toBe(false)
    expect(jobReadableBy({ ...PUBLIC_DONE, status: "processing" }, ME)).toBe(false)
    expect(jobReadableBy({ user_id: ME, is_public: false, status: "failed" }, ME)).toBe(true)
  })
})

describe("with outputs.allowPublic false", () => {
  it("the filter is the caller's own jobs only", () => {
    setProfile({ outputs: { allowPublic: false } })
    expect(readableJobsFilter(ME)).toBe(`user_id.eq.${ME}`)
    expect(favoritableJobFilter(ME)).toBe(`user_id.eq.${ME}`)
  })

  it("someone else's job marked public reads as one that does not exist; the caller's own is untouched", () => {
    setProfile({ outputs: { allowPublic: false } })
    expect(jobReadableBy(PUBLIC_DONE, ME)).toBe(false)
    expect(jobReadableBy({ user_id: ME, is_public: true, status: "completed" }, ME)).toBe(true)
    expect(jobReadableBy({ user_id: ME, is_public: false, status: "processing" }, ME)).toBe(true)
  })
})
