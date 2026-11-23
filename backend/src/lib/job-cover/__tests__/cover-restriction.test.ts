/**
 * A restriction on the file a cover was copied from reaches the copy
 * (decided 2026-11-23, review round): the copy's key carries the source's
 * stamp, so every `coverUrl` read — the owner's, a share's — drops a copy
 * whose source is restricted, as well as a cover whose own key is restricted
 * or evidence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const h = vi.hoisted(() => ({ restricted: new Set<string>() }))
vi.mock("@/lib/content-restriction-set.js", () => ({ restrictedKeysNow: () => h.restricted, restrictedKeys: async () => h.restricted }))

import { config } from "../../config.js"
import { isRestrictedCoverAddress } from "../cover-restriction.js"
import { effectiveJobCover } from "../effective-cover.js"
import { newJobCoverKey, coverStampOf, sourceStampOf } from "../cover-key.js"
import { toSharedJob } from "../../share-links/shared-job.js"
import { isRestrictedAddress } from "../../share-links/job-reads.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CDN = "https://cdn.test"
const SOURCE = "uploads/images/0a0a0a0a-0000-4000-8000-000000000001.png"
const SUNO_ART = "https://musicfile.example/art.jpeg"

let saved: string | undefined
beforeEach(() => {
  saved = config.R2_PUBLIC_URL
  config.R2_PUBLIC_URL = CDN
  h.restricted = new Set()
})
afterEach(() => {
  config.R2_PUBLIC_URL = saved as string
})

describe("cover keys", () => {
  it("every write is a new key carrying its source's stamp; a copy of a copy carries the original's", () => {
    const a = newJobCoverKey(USER, SOURCE, "png")
    const b = newJobCoverKey(USER, SOURCE, "png")
    expect(a).not.toBe(b)
    expect(a.startsWith(`job-covers/${USER}/cover-`)).toBe(true)
    expect(coverStampOf(a)).toBe(sourceStampOf(SOURCE))
    expect(coverStampOf(newJobCoverKey(USER, a, "png"))).toBe(sourceStampOf(SOURCE))
  })
})

describe("isRestrictedCoverAddress", () => {
  it("a copy whose source is restricted is restricted; its own key restricted or evidence too; others are not", () => {
    const copy = `${CDN}/${newJobCoverKey(USER, SOURCE, "png")}`
    expect(isRestrictedCoverAddress(copy)).toBe(false)
    h.restricted = new Set([SOURCE])
    expect(isRestrictedCoverAddress(copy)).toBe(true)
    expect(isRestrictedCoverAddress(`${CDN}/${newJobCoverKey(USER, "images/other.png", "png")}`)).toBe(false)
    h.restricted = new Set([copy.slice(CDN.length + 1)])
    expect(isRestrictedCoverAddress(copy)).toBe(true)
    expect(isRestrictedCoverAddress(`${CDN}/evidence/r1/${SOURCE}`)).toBe(true)
    expect(isRestrictedCoverAddress(SUNO_ART)).toBe(false)
  })
})

describe("every coverUrl read", () => {
  const copy = () => `${CDN}/${newJobCoverKey(USER, SOURCE, "png")}`

  it("the owner's read falls back to the provider's art when the cover's source is restricted", () => {
    const cover = copy()
    expect(effectiveJobCover({ cover_url: cover, output_data: { sunoImageUrl: SUNO_ART } })).toBe(cover)
    h.restricted = new Set([SOURCE])
    expect(effectiveJobCover({ cover_url: cover, output_data: { sunoImageUrl: SUNO_ART } })).toBe(SUNO_ART)
    expect(effectiveJobCover({ cover_url: cover, output_data: {} })).toBeNull()
  })

  it("a share drops a restricted cover, and the share's restricted-address check knows a restricted copy", () => {
    const cover = copy()
    const row = { id: "j1", status: "completed", input_data: { type: "suno-generate" }, output_data: { audioUrl: `${CDN}/audios/a.mp3` }, created_at: "2026-11-23T00:00:00Z", cover_url: cover }
    expect(toSharedJob(row, { allowCopy: false })?.coverUrl).toBe(cover)
    h.restricted = new Set([SOURCE])
    expect(toSharedJob(row, { allowCopy: false })?.coverUrl).toBeNull()
    expect(isRestrictedAddress(cover)).toBe(true)
    h.restricted = new Set([`audios/a.mp3`])
    expect(isRestrictedAddress(`${CDN}/audios/a.mp3`)).toBe(true)
  })
})
