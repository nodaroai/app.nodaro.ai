/**
 * How a call's documents reach the aggregator's chat-completions lane
 * (`lib/llm-file-link.ts`, decided 2026-11-17): inline while they fit the
 * inline limit in all, the rest by a link on this install's own storage — an
 * own-stored `.pdf` link reused as it is, anything else a copy of the bytes
 * that were counted. The plan is made before the hold and stores nothing; the
 * copies are stored in the job's own scratch folder once the job exists and
 * deleted when the call ends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { LlmFileBlock } from "../llm-files.js"

const state = vi.hoisted(() => ({
  reachable: true,
  base: "https://media.example" as string,
  policies: false,
  verdict: { allow: true } as { allow: boolean; reason?: string },
  asked: [] as Array<Record<string, unknown>>,
  stored: [] as Array<{ bytes: Buffer; name: string; ext: string; contentType: string; jobId: string | undefined }>,
  storedUrl: undefined as string | undefined,
  storeFails: false,
  discarded: [] as Array<{ url: string; jobId: string }>,
}))

vi.mock("../config.js", () => ({
  config: {
    get R2_PUBLIC_URL() {
      return state.base
    },
  },
}))
vi.mock("../llm-files.js", () => {
  class LlmFileError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  }
  return { LlmFileError }
})
vi.mock("../own-storage-url.js", () => ({
  isOwnStoredFileUrl: (url: string) => url.startsWith("https://media.example/") || url.startsWith("http://media.example/"),
}))
vi.mock("../own-media-reachability.js", () => ({ providersCanFetchOwnMedia: () => state.reachable }))
vi.mock("../upload-policy.js", () => ({
  hasUploadPolicies: () => state.policies,
  applyUploadPolicies: async (input: Record<string, unknown>) => {
    state.asked.push(input)
    return state.verdict
  },
}))
vi.mock("../job-scratch.js", () => ({
  uploadJobScratchBuffer: async (bytes: Buffer, name: string, ext: string, contentType: string, jobId?: string) => {
    if (state.storeFails) throw new Error("storage is down")
    state.stored.push({ bytes, name, ext, contentType, jobId })
    return state.storedUrl ?? `https://media.example/tmp/provider-input/${jobId}/${name}-abcd1234.${ext}`
  },
  discardJobScratchFile: async (url: string, jobId: string) => {
    state.discarded.push({ url, jobId })
  },
}))

const {
  KIE_INLINE_FILE_MAX_CHARS, discardLlmFileLinks, llmFileInlineChars, llmFileInlineMaxBytes, llmFileLinksNeedStoring, planLlmFileLinks, storeLlmFileLinks,
} = await import("../llm-file-link.js")
const { LlmFileError } = await import("../llm-files.js")

const block = (bytes: number, filename = "report.pdf"): LlmFileBlock =>
  ({ type: "file_base64", mediaType: "application/pdf", data: Buffer.alloc(bytes, 0x41).toString("base64"), filename, pages: 3 })

const JOB = "11111111-1111-4111-8111-111111111111"
const OUTSIDE = "https://elsewhere.example/report.pdf"
const OWN = "https://media.example/uploads/u1/report.pdf"

beforeEach(() => {
  state.reachable = true
  state.base = "https://media.example"
  state.policies = false
  state.verdict = { allow: true }
  state.asked.length = 0
  state.stored.length = 0
  state.storedUrl = undefined
  state.storeFails = false
  state.discarded.length = 0
})

describe("the inline limit", () => {
  it("is 1.3 million characters in all, under the 1.36 million one inline file was read at and under the part's refusal edge", async () => {
    const { KIE_INLINE_DATA_URL_MAX_CHARS } = await import("../kie-inline-image.js")
    expect(KIE_INLINE_FILE_MAX_CHARS).toBe(1_300_000)
    expect(KIE_INLINE_FILE_MAX_CHARS).toBeLessThan(1_360_000)
    expect(KIE_INLINE_FILE_MAX_CHARS).toBeLessThan(KIE_INLINE_DATA_URL_MAX_CHARS)
  })

  it("counts a file as its data: URL; the limit is about 0.93 MB of PDF", () => {
    expect(llmFileInlineChars(block(3))).toBe("data:application/pdf;base64,".length + 4)
    const maxBytes = llmFileInlineMaxBytes(KIE_INLINE_FILE_MAX_CHARS)
    expect(maxBytes).toBe(974_979)
    expect(llmFileInlineChars(block(maxBytes))).toBeLessThanOrEqual(KIE_INLINE_FILE_MAX_CHARS)
    expect(llmFileInlineChars(block(maxBytes + 3))).toBeGreaterThan(KIE_INLINE_FILE_MAX_CHARS)
  })
})

describe("planLlmFileLinks (before the hold: stores nothing)", () => {
  it("sends every file inline while they fit the limit in all", async () => {
    const blocks = [block(1000), block(400_000)]
    const plan = await planLlmFileLinks([OUTSIDE, OWN], blocks)
    expect(plan).toEqual([{ block: blocks[0], via: "inline" }, { block: blocks[1], via: "inline" }])
    expect(llmFileLinksNeedStoring(plan)).toBe(false)
    expect(state.stored).toEqual([])
  })

  it("counts the inline files IN ALL: once they would pass the limit, the rest go by link, in order", async () => {
    // Each fits alone; together the second would pass 1.3 million characters.
    const blocks = [block(600_000, "a.pdf"), block(600_000, "b.pdf"), block(1000, "c.pdf")]
    const plan = await planLlmFileLinks([OUTSIDE, OUTSIDE, OUTSIDE], blocks)
    expect(plan.map((s) => [s.block.filename, s.via])).toEqual([["a.pdf", "inline"], ["b.pdf", "copy"], ["c.pdf", "inline"]])
    expect(llmFileLinksNeedStoring(plan)).toBe(true)
    expect(state.stored).toEqual([])
  })

  it("reuses the caller's link when it is an https .pdf on this install's storage", async () => {
    const big = block(1_200_000)
    expect(await planLlmFileLinks([OWN], [big])).toEqual([{ block: big, via: "own-link", url: OWN }])
  })

  it.each([
    ["an outside link", OUTSIDE],
    ["an own link that does not end in .pdf", "https://media.example/uploads/u1/report"],
    ["an own link with a query", "https://media.example/uploads/u1/report.pdf?v=2"],
    ["a plain-http own link", "http://media.example/uploads/u1/report.pdf"],
  ])("plans a copy of the counted bytes for %s — never the caller's link", async (_name, url) => {
    const big = block(1_200_000)
    expect(await planLlmFileLinks([url], [big])).toEqual([{ block: big, via: "copy" }])
    expect(state.stored).toEqual([])
  })

  it("where the provider cannot fetch this install's storage, files past the limit are refused — a file within it still goes inline", async () => {
    state.reachable = false
    const refusal = await planLlmFileLinks([OWN], [block(1_200_000, "big.pdf")]).catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(LlmFileError)
    expect((refusal as { code: string }).code).toBe("file_too_large")
    expect((refusal as Error).message).toBe("Files may total up to 0.9 MB for this model on this install.")
    await expect(planLlmFileLinks([OWN], [block(1000)])).resolves.toHaveLength(1)
  })

  it("where this install's storage is not served over https, a copy is refused before anything is uploaded", async () => {
    state.base = "http://media.example"
    const refusal = await planLlmFileLinks([OUTSIDE], [block(1_200_000)]).catch((e: unknown) => e)
    expect((refusal as { code: string }).code).toBe("file_too_large")
    expect(state.stored).toEqual([])
    expect(state.asked).toEqual([])
  })

  it("asks the deployment's upload policy for a copy, before the hold, and refuses on its no", async () => {
    state.policies = true
    const big = block(1_200_000)
    await planLlmFileLinks([OUTSIDE], [big], { owner: "u1" })
    expect(state.asked).toHaveLength(1)
    expect(state.asked[0]).toMatchObject({ kind: "other", lane: "media-import", mime: "application/pdf", sizeBytes: 1_200_000, userId: "u1", filename: "report.pdf" })
    state.verdict = { allow: false, reason: "Not allowed here." }
    const refusal = await planLlmFileLinks([OUTSIDE], [big], { owner: "u1" }).catch((e: unknown) => e)
    expect((refusal as { code: string }).code).toBe("upload_blocked")
    expect((refusal as Error).message).toBe("Not allowed here.")
    // A reused own link and an inline file write nothing: the policy is not asked for them.
    state.asked.length = 0
    state.verdict = { allow: true }
    await planLlmFileLinks([OWN, OUTSIDE], [big, block(1000)])
    expect(state.asked).toEqual([])
    expect(state.stored).toEqual([])
  })
})

describe("storeLlmFileLinks / discardLlmFileLinks (after the job row exists)", () => {
  it("stores each copy in the job's own scratch folder and gives every linked file its link; inline files are untouched", async () => {
    const small = block(1000, "a.pdf")
    const own = block(1_200_000, "b.pdf")
    const copy = block(1_250_000, "c.pdf")
    const plan = await planLlmFileLinks([OUTSIDE, OWN, OUTSIDE], [small, own, copy])
    const stored: string[] = []
    const out = await storeLlmFileLinks(plan, JOB, stored)
    expect(out[0]).toBe(small)
    expect(out[1]).toEqual({ ...own, hostedUrl: OWN })
    expect(state.stored).toHaveLength(1)
    expect(state.stored[0]).toMatchObject({ ext: "pdf", contentType: "application/pdf", jobId: JOB })
    expect(state.stored[0]!.name).toMatch(/^llm-file-[0-9a-f-]{36}$/)
    expect(state.stored[0]!.bytes.equals(Buffer.from(copy.data, "base64"))).toBe(true)
    expect(out[2]!.hostedUrl).toMatch(new RegExp(`^https://media\\.example/tmp/provider-input/${JOB}/llm-file-[0-9a-f-]{36}-abcd1234\\.pdf$`))
    expect(out[2]!.data).toBe(copy.data)
    expect(stored).toEqual([out[2]!.hostedUrl])
  })

  it("deletes exactly the copies it stored, from that job's folder", async () => {
    await discardLlmFileLinks(["https://media.example/tmp/provider-input/x/llm-file-1.pdf"], JOB)
    expect(state.discarded).toEqual([{ url: "https://media.example/tmp/provider-input/x/llm-file-1.pdf", jobId: JOB }])
    await discardLlmFileLinks([], JOB)
    expect(state.discarded).toHaveLength(1)
  })

  it("a stored copy whose link the aggregator would not read as a PDF fails loudly, and is still listed for deletion", async () => {
    state.storedUrl = "https://media.example/tmp/provider-input/llm-file.bin"
    const plan = await planLlmFileLinks([OUTSIDE], [block(1_200_000)])
    const stored: string[] = []
    await expect(storeLlmFileLinks(plan, JOB, stored)).rejects.toThrow(/\.pdf link/)
    expect(stored).toEqual(["https://media.example/tmp/provider-input/llm-file.bin"])
  })

  it("a failed upload lists nothing to delete", async () => {
    state.storeFails = true
    const plan = await planLlmFileLinks([OUTSIDE], [block(1_200_000)])
    const stored: string[] = []
    await expect(storeLlmFileLinks(plan, JOB, stored)).rejects.toThrow(/storage is down/)
    expect(stored).toEqual([])
  })
})
