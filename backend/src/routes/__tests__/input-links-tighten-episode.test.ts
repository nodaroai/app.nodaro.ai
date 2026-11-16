// @test-units-by-name runs the one use-case node it names (tighten-episode) through the route harness
/**
 * RECORDING — a use-case route given its recordings as links (POST
 * /v1/tighten-episode). The recording is measured before the fee is held, and
 * the graph the run starts reads it. Recorded per deployment profile, for a
 * recording on another site and one on this deployment's own storage: the
 * reply, the preparation, the row, the fee and the run.
 */
import { m, makeApp, post } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect, afterEach, vi } from "vitest"
import { LEVER_INERT_PROFILES, OUTSIDE_HOST, OWN_STORAGE, REFUSE_PROFILE, REPORT_PROFILE, TODAYS_PROFILES, inputLinkLines, useProfile } from "../../lib/__tests__/helpers/input-link-profiles.js"

vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))

const savedR2 = process.env.R2_PUBLIC_URL

afterEach(() => {
  useProfile(undefined)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

async function expectStarted(host: string): Promise<void> {
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  const mediaUrls = [`${host}/videos/ep.mp4`]
  const res = await post(await makeApp(), { mediaUrls, masterAudioUrl: `${host}/audios/master.wav` })
  expect(res.statusCode, res.body).toBe(202)
  expect(res.json()).toEqual({ jobId: "job-1", executionId: "exec-1" })
  expect(m.prepare).toHaveBeenCalledTimes(1)
  expect(m.prepare.mock.calls[0]![1]).toMatchObject({ mediaUrls, masterAudioUrl: `${host}/audios/master.wav` })
  expect(m.insertJob).toHaveBeenCalledTimes(1)
  expect(m.reserve).toHaveBeenCalledTimes(1)
  expect(m.execute).toHaveBeenCalledTimes(1)
}

describe("recording: Tighten Episode with its recordings given as links, before the input-link lever", () => {
  for (const { name, profile } of TODAYS_PROFILES) {
    it(`${name}: a recording on another site is prepared and the run starts`, async () => {
      useProfile(profile)
      await expectStarted(OUTSIDE_HOST)
    })

    it(`${name}: a recording on this deployment's own storage is prepared and the run starts`, async () => {
      useProfile(profile)
      await expectStarted(OWN_STORAGE)
    })
  }
})

describe("the input-link lever: nothing changes at allow, nor with link imports on", () => {
  for (const { name, profile } of LEVER_INERT_PROFILES) {
    it(`${name}: a recording on another site is prepared and the run starts, nothing reported`, async () => {
      useProfile(profile)
      const warn = vi.spyOn(console, "warn")
      await expectStarted(OUTSIDE_HOST)
      expect(inputLinkLines(warn)).toEqual([])
      warn.mockRestore()
    })
  }
})

describe("inputLinks: report — the run starts exactly as before, and each link is recorded", () => {
  it("recordings on another site: one line per field, the host only", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectStarted(OUTSIDE_HOST)
    expect(inputLinkLines(warn).sort()).toEqual([
      '[input-links] would-refuse route="POST /v1/tighten-episode" field=masterAudioUrl host=cdn.example user=00000000-0000-4000-8000-000000000001',
      '[input-links] would-refuse route="POST /v1/tighten-episode" field=mediaUrls[] host=cdn.example user=00000000-0000-4000-8000-000000000001',
    ])
    warn.mockRestore()
  })

  it("recordings on this deployment's own storage: nothing recorded", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectStarted(OWN_STORAGE)
    expect(inputLinkLines(warn)).toEqual([])
    warn.mockRestore()
  })
})

describe("inputLinks: refuse — a recording on another site is refused before it is measured or anything is held", () => {
  it("a recording on another site: 403 link_imports_disabled; nothing prepared, no row, no fee, no run", async () => {
    useProfile(REFUSE_PROFILE.profile)
    process.env.R2_PUBLIC_URL = OWN_STORAGE
    const res = await post(await makeApp(), { mediaUrls: [`${OUTSIDE_HOST}/videos/ep.mp4`] })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  it("a recording on this deployment's own storage: the run starts as before", async () => {
    useProfile(REFUSE_PROFILE.profile)
    await expectStarted(OWN_STORAGE)
  })
})
