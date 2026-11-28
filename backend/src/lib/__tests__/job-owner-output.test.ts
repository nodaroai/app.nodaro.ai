import { describe, expect, it } from "vitest"
import { redactPrivateJobData, redactPrivateJobOutput } from "../public-job-data.js"
import { OWNER_ONLY_OUTPUT_KEYS, ownerOnlyOutputFields, readerOwnsJob, withOwnerOnlyOutputFields, withOwnerOnlyRowFields } from "../job-owner-output.js"

const OWNER = "user-owner"
const HIDDEN = {
  __castSwapEngineResolution: "720p",
  __castSwapUpscaleOutcome: "applied",
  __castSwapEngineVideoUrl: "https://cdn.example/job-1-engine.mp4",
  __castSwapEngineWidth: 1280,
  __castSwapEngineHeight: 720,
}
const BEFORE = { engineVideoUrl: "https://cdn.example/job-1-engine.mp4", engineWidth: 1280, engineHeight: 720, engineResolution: "720p" }
const economy = { videoUrl: "https://cdn.example/job-1.mp4", resolution: "1080p", quality: "economy", ...HIDDEN }

describe("the owner-only output fields (Video Remake's version before upscale)", () => {
  it("are the four names the SDK types", () => {
    expect(OWNER_ONLY_OUTPUT_KEYS).toEqual(["engineVideoUrl", "engineWidth", "engineHeight", "engineResolution"])
  })

  it("the owner of a named Economy run reads them, added after the redaction", () => {
    expect(ownerOnlyOutputFields(economy, OWNER, { userId: OWNER })).toEqual(BEFORE)
    expect(withOwnerOnlyOutputFields(redactPrivateJobOutput(economy), economy, OWNER, { userId: OWNER })).toEqual({ videoUrl: "https://cdn.example/job-1.mp4", resolution: "1080p", quality: "economy", ...BEFORE })
    const raw = { id: "job-1", user_id: OWNER, output_data: economy }
    expect(withOwnerOnlyRowFields(redactPrivateJobData(raw), raw, { userId: OWNER })).toEqual({ id: "job-1", user_id: OWNER, output_data: { videoUrl: "https://cdn.example/job-1.mp4", resolution: "1080p", quality: "economy", ...BEFORE } })
  })

  it("anyone else reads none of them: another user, an admin, a signed-out reader, a row with no owner — the very object the redaction answered", () => {
    const answered = redactPrivateJobOutput(economy)
    for (const reader of [{ userId: "someone-else" }, { userId: "an-admin" }, { userId: null }, { userId: undefined }, { userId: "" }]) {
      expect(ownerOnlyOutputFields(economy, OWNER, reader), JSON.stringify(reader)).toEqual({})
      expect(withOwnerOnlyOutputFields(answered, economy, OWNER, reader)).toBe(answered)
    }
    for (const owner of [undefined, null, "", 7]) {
      expect(readerOwnsJob(owner, { userId: OWNER })).toBe(false)
      expect(withOwnerOnlyOutputFields(answered, economy, owner, { userId: OWNER })).toBe(answered)
    }
    const raw = { id: "job-1", user_id: OWNER, output_data: economy }
    const row = redactPrivateJobData(raw)
    expect(withOwnerOnlyRowFields(row, raw, { userId: "someone-else" })).toBe(row)
  })

  it("the owner reads nothing more of a run that named no quality, a Full run, or one whose step did not finish; never over a key already there", () => {
    for (const extra of [{}, { quality: "full" }, { quality: "draft" }]) {
      const output = { videoUrl: "https://cdn.example/job-1.mp4", ...extra, ...HIDDEN }
      expect(ownerOnlyOutputFields(output, OWNER, { userId: OWNER }), JSON.stringify(extra)).toEqual({})
    }
    const { __castSwapEngineVideoUrl: _u, ...noVersion } = economy
    expect(ownerOnlyOutputFields(noVersion, OWNER, { userId: OWNER })).toEqual({})
    expect(ownerOnlyOutputFields({ ...economy, engineVideoUrl: "https://cdn.example/kept.mp4" }, OWNER, { userId: OWNER })).toEqual({ engineWidth: 1280, engineHeight: 720, engineResolution: "720p" })
    expect(ownerOnlyOutputFields(null, OWNER, { userId: OWNER })).toEqual({})
    expect(ownerOnlyOutputFields([economy], OWNER, { userId: OWNER })).toEqual({})
  })
})
