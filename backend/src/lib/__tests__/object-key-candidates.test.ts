/**
 * `objectKeyJobIdCandidates` is `isOwnedObjectKey` READ BACKWARDS — the
 * inversion the relay stem fence asks `jobs.relay_job_id` about. The two share
 * `keyStem`, so the property that matters is the round trip: every candidate a
 * key yields must be a job id that would claim that key back.
 */
import { describe, it, expect } from "vitest"
import { isOwnedObjectKey, keyStem, objectKeyJobIdCandidates } from "../job-policy-outputs.js"

const UUID = "ffffffff-ffff-4000-8000-000000000001"

describe("keyStem", () => {
  it("strips the prefix and the extension, and tolerates both being absent", () => {
    expect(keyStem(`images/${UUID}.png`)).toBe(UUID)
    expect(keyStem(`a/b/c/${UUID}-seg1.mp4`)).toBe(`${UUID}-seg1`)
    expect(keyStem(UUID)).toBe(UUID)
    expect(keyStem("images/no-extension")).toBe("no-extension")
  })
})

describe("objectKeyJobIdCandidates", () => {
  it("yields the bare stem for a plain deliverable key", () => {
    expect(objectKeyJobIdCandidates(`images/${UUID}.png`)).toEqual([UUID])
  })

  it("yields the suffixed stem AND the job-id head for a family key", () => {
    expect(objectKeyJobIdCandidates(`videos/${UUID}-seg3-lastframe.mp4`)).toEqual([
      `${UUID}-seg3-lastframe`,
      UUID,
    ])
  })

  it("does not invent a head from 36 characters that are not a UUID", () => {
    const notAUuid = "x".repeat(36)
    expect(objectKeyJobIdCandidates(`videos/${notAUuid}-seg1.mp4`)).toEqual([`${notAUuid}-seg1`])
  })

  it("does not split at a non-boundary — the 37th character must be the separator", () => {
    // 40 hex-ish chars with no `-` at index 36: the head is not an id.
    const stem = `${UUID}x-tail`
    expect(objectKeyJobIdCandidates(`videos/${stem}.mp4`)).toEqual([stem])
  })

  it("is empty for a key with no stem at all", () => {
    expect(objectKeyJobIdCandidates("images/")).toEqual([])
  })

  it("round-trips: every candidate claims the key back through the family rule", () => {
    for (const key of [
      `images/${UUID}.png`,
      `videos/${UUID}-seg1.mp4`,
      `thumbnails/${UUID}-v2.png`,
      "audios/legacy-stem.mp3",
    ]) {
      for (const candidate of objectKeyJobIdCandidates(key)) {
        expect(isOwnedObjectKey(candidate, key)).toBe(true)
      }
    }
  })
})
