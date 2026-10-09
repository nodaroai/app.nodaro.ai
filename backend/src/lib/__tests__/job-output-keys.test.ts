import { describe, it, expect, vi } from "vitest"

/**
 * A job's own files, read off its WHOLE output (decided 2026-10-08): every
 * string at any depth — nested objects and lists included — that is one of our
 * urls, kept only when its key is in the job's own key family
 * (`isOwnedObjectKey`). This is the one rule the expiry reapers and the admin
 * app expunge share.
 */

vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.test" } }))
// The family rule's module imports the storage client, which this pure walk never calls.
vi.mock("../storage.js", () => ({ r2KeyFromOurUrl: () => null }))

import {
  jobFileObjectId,
  ownedJobOutputFiles,
  ownedJobOutputKeys,
  r2KeyFromUrl,
  rawExtensionObjectId,
  rawExtensionReferenceObjectId,
  withUrlsNulled,
} from "../job-output-keys.js"
import { isOwnedObjectKey } from "../job-policy-outputs.js"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const OTHER = "00000000-0000-4000-8000-0000000000bb"
const url = (key: string) => `https://cdn.test/${key}`

describe("r2KeyFromUrl", () => {
  it("returns the key of one of our urls and null for anything else", () => {
    expect(r2KeyFromUrl(url(`images/${JOB}.png`))).toBe(`images/${JOB}.png`)
    expect(r2KeyFromUrl("https://elsewhere.test/images/x.png")).toBeNull()
  })
})

describe("ownedJobOutputFiles", () => {
  it("reaches the job's own files at the top level, nested in objects, and in lists", () => {
    const output = {
      videoUrl: url(`videos/${JOB}.mp4`),
      stems: { vocals: url(`audios/${JOB}-vocals.mp3`) },
      imageUrls: [url(`images/${JOB}.png`), url(`images/${JOB}-v1.png`)],
      json: { version: 1, url: url(`speaker-tracks/${JOB}.json`) },
      variants: [{ deep: [{ url: url(`thumbnails/${JOB}-v2.png`) }] }],
    }
    expect(ownedJobOutputKeys(JOB, output).sort()).toEqual(
      [
        `audios/${JOB}-vocals.mp3`,
        `images/${JOB}-v1.png`,
        `images/${JOB}.png`,
        `speaker-tracks/${JOB}.json`,
        `thumbnails/${JOB}-v2.png`,
        `videos/${JOB}.mp4`,
      ].sort(),
    )
  })

  it("holds back our urls outside the job's family (an echoed input, another job's object) at any depth", () => {
    const output = {
      imageUrl: url(`images/${OTHER}.png`),
      json: { sources: [{ url: url(`videos/${OTHER}.mp4`) }, { url: url("uploads/videos/upload-1.mp4") }] },
      mine: url(`images/${JOB}.png`),
    }
    const { files, heldBack } = ownedJobOutputFiles(JOB, output)
    expect(files.map((f) => f.key)).toEqual([`images/${JOB}.png`])
    expect(heldBack).toBe(3)
  })

  it("never reads a url that is not ours, and lists a repeated url once", () => {
    const own = url(`videos/${JOB}.mp4`)
    const { files, heldBack } = ownedJobOutputFiles(JOB, {
      videoUrl: own,
      again: [own, { own }],
      external: "https://provider.test/videos/x.mp4",
      text: "not a url",
      n: 3,
      flag: true,
      nothing: null,
    })
    expect(files).toEqual([{ url: own, key: `videos/${JOB}.mp4` }])
    expect(heldBack).toBe(0)
  })

  it("a sibling job id that merely starts with this one is not in its family", () => {
    expect(ownedJobOutputKeys("job-1", { a: url("images/job-10.png") })).toEqual([])
  })
})

describe("withUrlsNulled", () => {
  it("nulls exactly the given urls wherever they sit, on a copy", () => {
    const gone = url(`images/${JOB}.png`)
    const kept = url(`images/${OTHER}.png`)
    const output = { imageUrl: gone, json: { url: gone, sources: [kept, gone], sha: "abc" }, n: 1 }
    const out = withUrlsNulled(output, new Set([gone])) as typeof output
    expect(out).toEqual({ imageUrl: null, json: { url: null, sources: [kept, null], sha: "abc" }, n: 1 })
    // Never mutated.
    expect(output.imageUrl).toBe(gone)
    expect(output.json.sources[1]).toBe(gone)
  })
})

describe("keys a writer picks inside the job's family (decided 2026-10-08)", () => {
  it("a Seedance extend's raw .mov copy is `<jobId>-raw`: the job's family, never the deliverable's slot", () => {
    const key = `videos/${rawExtensionObjectId(JOB)}.mov`
    expect(key).toBe(`videos/${JOB}-raw.mov`)
    expect(isOwnedObjectKey(JOB, key)).toBe(true)
    expect(key).not.toBe(`videos/${JOB}.mov`)
    expect(ownedJobOutputKeys(JOB, { videoUrl: url(`videos/${JOB}.mp4`), rawExtensionUrl: url(key) })).toEqual([
      `videos/${JOB}.mp4`,
      key,
    ])
  })

  it("a later extend's copy of the source clip is `<jobId>-raw-ref`: its own key, never the `-raw` slot", () => {
    const key = `videos/${rawExtensionReferenceObjectId(JOB)}.mov`
    expect(key).toBe(`videos/${JOB}-raw-ref.mov`)
    expect(isOwnedObjectKey(JOB, key)).toBe(true)
    expect(key).not.toBe(`videos/${rawExtensionObjectId(JOB)}.mov`)
    expect(ownedJobOutputKeys(JOB, { videoUrl: url(`videos/${JOB}.mp4`), chainReferenceUrl: url(key) })).toEqual([
      `videos/${JOB}.mp4`,
      key,
    ])
  })

  it("a file a running job writes more than once is `<jobId>-<label>-<nonce>`: in the family, never the same twice", () => {
    const a = jobFileObjectId(JOB, "combine")
    const b = jobFileObjectId(JOB, "combine")
    expect(a).toMatch(new RegExp(`^${JOB}-combine-[0-9a-f-]{36}$`))
    expect(a).not.toBe(b)
    expect(isOwnedObjectKey(JOB, `videos/${a}.mp4`)).toBe(true)
    expect(isOwnedObjectKey(JOB, `images/${jobFileObjectId(JOB, "plate")}.png`)).toBe(true)
    // Never the deliverable's own slot.
    expect(a).not.toBe(JOB)
  })

  it("with no job running, the id is random (there is no job whose expiry could take it)", () => {
    const id = jobFileObjectId(undefined, "combine")
    expect(id).toMatch(/^combine-[0-9a-f-]{36}$/)
    expect(isOwnedObjectKey(JOB, `videos/${id}.mp4`)).toBe(false)
  })
})
