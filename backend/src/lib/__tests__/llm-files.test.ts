/**
 * Documents an LLM call reads (`lib/llm-files.ts`): each link fetched once
 * (the SSRF-safe, byte-capped fetch, faked here), refused unless it is a PDF
 * whose pages can be counted, within the call's limits. The pages are counted
 * by the real worker (`lib/pdf-pages.ts`, its own suite: pdf-pages.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { deflateSync } from "node:zlib"

const state = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  linksAllowed: true,
  fetched: [] as string[],
}))

vi.mock("../safe-fetch-bytes.js", () => {
  class PublicDownloadTooLargeError extends Error {
    readonly code = "download_too_large"
  }
  return {
    PublicDownloadTooLargeError,
    boundedPublicChunks: (url: string, opts: { maxBytes: number }) => (async function* () {
      state.fetched.push(url)
      const bytes = state.files.get(url)
      if (!bytes) throw new Error("File download failed")
      if (bytes.length > opts.maxBytes) throw new PublicDownloadTooLargeError("File download exceeds the size limit")
      yield bytes
    })(),
  }
})
vi.mock("../link-imports.js", () => ({
  linkImportRefusal: (url: string) =>
    state.linksAllowed || url.startsWith("https://media.example/") ? null : { code: "link_imports_disabled", message: "links are off" },
}))

const { looksLikePdf, llmFileName, prepareLlmFiles, LlmFileError, LLM_FILES_MAX_TOTAL_BYTES, LLM_FILES_MAX_PAGES } = await import("../llm-files.js")

/** A plain PDF 1.4 of `pages` pages: every page an indirect object in the body. */
export function plainPdf(pages: number, opts: { page?: (p: number) => string; count?: number } = {}): Buffer {
  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
  const kids: number[] = []
  for (let p = 0; p < pages; p++) {
    objs.push(`<< /Length 20 >>\nstream\nBT (page ${p + 1}) Tj ET\nendstream`)
    objs.push(opts.page ? opts.page(p) : `<< /Type /Page /Parent 2 0 R /Contents ${objs.length} 0 R >>`)
    kids.push(objs.length)
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${opts.count ?? pages} >>`
  return Buffer.from("%PDF-1.4\n" + objs.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join("") + "trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1")
}

/** A PDF 1.5 whose page objects live only inside a Flate-compressed object stream. */
function objectStreamPdf(pages: number, opts: { filter?: string; corrupt?: boolean } = {}): Buffer {
  const inner: Array<[number, string]> = []
  for (let p = 0; p < pages; p++) inner.push([10 + p, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>`])
  inner.push([2, `<</Type/Pages/Kids[${inner.map(([n]) => `${n} 0 R`).join(" ")}]/Count ${pages}>>`])
  let offset = 0
  const index: string[] = []
  const bodies: string[] = []
  for (const [n, body] of inner) {
    index.push(`${n} ${offset}`)
    bodies.push(body)
    offset += body.length + 1
  }
  const head = index.join(" ") + "\n"
  const decoded = Buffer.from(head + bodies.join("\n"), "latin1")
  const data = opts.corrupt ? Buffer.from("not deflate data", "latin1") : deflateSync(decoded)
  const filter = opts.filter ?? "FlateDecode"
  const dict = `<< /Type /ObjStm /N ${inner.length} /First ${head.length} /Filter /${filter} /Length ${data.length} >>`
  return Buffer.concat([
    Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n5 0 obj\n" + dict + "\nstream\n", "latin1"),
    data,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
  ])
}

beforeEach(() => {
  state.files.clear()
  state.fetched.length = 0
  state.linksAllowed = true
})

describe("looksLikePdf / llmFileName", () => {
  it("reads the PDF signature", () => {
    expect(looksLikePdf(plainPdf(1))).toBe(true)
    expect(looksLikePdf(Buffer.from("hello, plain text"))).toBe(false)
  })

  it("names a file by its link's .pdf segment, else generically", () => {
    expect(llmFileName("https://media.example/uploads/documents/report%20Q3.pdf", 0)).toBe("report Q3.pdf")
    expect(llmFileName("https://media.example/doc?id=7", 1)).toBe("document-2.pdf")
  })
})

describe("prepareLlmFiles", () => {
  it("fetches each file once and returns inline PDF blocks with their counted pages, in order", async () => {
    state.files.set("https://media.example/a.pdf", plainPdf(2))
    state.files.set("https://media.example/b.pdf", objectStreamPdf(5))
    const blocks = await prepareLlmFiles(["https://media.example/a.pdf", "https://media.example/b.pdf"])
    expect(blocks.map((b) => [b.type, b.mediaType, b.filename, b.pages])).toEqual([
      ["file_base64", "application/pdf", "a.pdf", 2],
      ["file_base64", "application/pdf", "b.pdf", 5],
    ])
    expect(Buffer.from(blocks[0]!.data, "base64").equals(plainPdf(2))).toBe(true)
    expect(state.fetched).toEqual(["https://media.example/a.pdf", "https://media.example/b.pdf"])
  })

  it("refuses a file that is not a PDF", async () => {
    state.files.set("https://media.example/notes.txt", Buffer.from("plain text"))
    await expect(prepareLlmFiles(["https://media.example/notes.txt"])).rejects.toMatchObject({ code: "file_type_not_supported" })
  })

  it("names a refused file by its file name, never its link (a workflow's failure shows the sentence as it is)", async () => {
    const link = "https://media.example/uploads/documents/report%20Q3.pdf?token=secret"
    state.files.set(link, Buffer.from("plain text"))
    const err = (await prepareLlmFiles([link]).catch((e: Error) => e)) as Error
    expect(err.message).toContain("report Q3.pdf")
    expect(err.message).not.toContain("https://")
    const missing = (await prepareLlmFiles(["https://media.example/x/missing.pdf"]).catch((e: Error) => e)) as Error
    expect(missing.message).toContain("missing.pdf")
    expect(missing.message).not.toContain("https://")
    // A workflow's Generate Text node shows these sentences as they are.
    const { syncHttpFailureMessage } = await import("../../services/workflow-engine/sync-http-failure.js")
    for (const e of [err, missing]) {
      expect(syncHttpFailureMessage(400, JSON.stringify({ error: { code: (e as { code?: string }).code, message: e.message } }))).toBe(e.message)
    }
  })

  it("reads one owner's calls one at a time, fetches included", async () => {
    state.files.set("https://media.example/a.pdf", plainPdf(2))
    const both = await Promise.all([
      prepareLlmFiles(["https://media.example/a.pdf"], { owner: "user-1" }),
      prepareLlmFiles(["https://media.example/a.pdf"], { owner: "user-1" }),
    ])
    expect(both.map((b) => b.length)).toEqual([1, 1])
  })

  it("refuses a PDF whose pages cannot be counted", async () => {
    state.files.set("https://media.example/locked.pdf", objectStreamPdf(4, { corrupt: true }))
    await expect(prepareLlmFiles(["https://media.example/locked.pdf"])).rejects.toMatchObject({ code: "file_unreadable" })
  })

  it("refuses files past the page limit — one call's pages IN ALL, not each file's", async () => {
    state.files.set("https://media.example/long.pdf", plainPdf(LLM_FILES_MAX_PAGES + 1))
    await expect(prepareLlmFiles(["https://media.example/long.pdf"])).rejects.toMatchObject({ code: "file_too_many_pages", message: expect.stringMatching(/pages in all/) })
    state.files.set("https://media.example/ok.pdf", plainPdf(LLM_FILES_MAX_PAGES))
    await expect(prepareLlmFiles(["https://media.example/ok.pdf"])).resolves.toHaveLength(1)
    state.files.set("https://media.example/half-a.pdf", plainPdf(60))
    state.files.set("https://media.example/half-b.pdf", plainPdf(41))
    await expect(prepareLlmFiles(["https://media.example/half-a.pdf", "https://media.example/half-b.pdf"])).rejects.toMatchObject({ code: "file_too_many_pages", message: expect.stringMatching(/101 pages/) })
    state.files.set("https://media.example/half-c.pdf", plainPdf(40))
    await expect(prepareLlmFiles(["https://media.example/half-a.pdf", "https://media.example/half-c.pdf"])).resolves.toHaveLength(2)
  })

  it("accepts an ordinary edited file by the pages a reader shows, and holds it at the larger count", async () => {
    const { PDFDocument } = await import("pdf-lib")
    const doc = await PDFDocument.create()
    for (let i = 0; i < 150; i++) doc.addPage([100, 100])
    for (let i = 0; i < 70; i++) doc.removePage(doc.getPageCount() - 1)
    state.files.set("https://media.example/edited.pdf", Buffer.from(await doc.save()))
    const [block] = await prepareLlmFiles(["https://media.example/edited.pdf"])
    expect(block!.pages).toBe(80)
    expect(block!.holdPages).toBeGreaterThanOrEqual(80)
  })

  it("refuses a disguised page count at the limit: escaped page types count", async () => {
    state.files.set("https://media.example/disguised.pdf", plainPdf(LLM_FILES_MAX_PAGES + 50, { page: () => "<< /Type /P#61ge /Parent 2 0 R >>", count: 1 }))
    await expect(prepareLlmFiles(["https://media.example/disguised.pdf"])).rejects.toMatchObject({ code: "file_too_many_pages" })
  })

  it("caps the files' bytes IN ALL: the second file gets only what the first left", async () => {
    const half = Math.floor(LLM_FILES_MAX_TOTAL_BYTES / 2) + 10
    const big = (n: number) => Buffer.concat([plainPdf(1), Buffer.alloc(n - plainPdf(1).length, 0x20)])
    state.files.set("https://media.example/1.pdf", big(half))
    state.files.set("https://media.example/2.pdf", big(half))
    await expect(prepareLlmFiles(["https://media.example/1.pdf"])).resolves.toHaveLength(1)
    await expect(prepareLlmFiles(["https://media.example/1.pdf", "https://media.example/2.pdf"])).rejects.toMatchObject({ code: "file_too_large" })
  })

  it("refuses an unreachable file, and more files than a call takes, before any fetch", async () => {
    await expect(prepareLlmFiles(["https://media.example/missing.pdf"])).rejects.toMatchObject({ code: "file_unreachable" })
    state.fetched.length = 0
    await expect(prepareLlmFiles(Array.from({ length: 6 }, (_, i) => `https://media.example/${i}.pdf`))).rejects.toBeInstanceOf(LlmFileError)
    expect(state.fetched).toEqual([])
  })

  it("refuses as busy when every PDF reader is taken, and passes the request's signal to the page count", async () => {
    const { __holdPdfReaderSlotsForTests } = await import("../pdf-pages.js")
    state.files.set("https://media.example/a.pdf", plainPdf(2))
    const release = await __holdPdfReaderSlotsForTests()
    try {
      const gone = new AbortController()
      const reading = prepareLlmFiles(["https://media.example/a.pdf"], { signal: gone.signal })
      setTimeout(() => gone.abort(new Error("client gone")), 50)
      await expect(reading).rejects.toThrow("client gone")
    } finally {
      release()
    }
    await expect(prepareLlmFiles(["https://media.example/a.pdf"])).resolves.toHaveLength(1)
  })

  it("asks the deployment's link switch for every link before fetching any", async () => {
    state.linksAllowed = false
    state.files.set("https://media.example/own.pdf", plainPdf(1))
    state.files.set("https://elsewhere.example/x.pdf", plainPdf(1))
    await expect(prepareLlmFiles(["https://media.example/own.pdf", "https://elsewhere.example/x.pdf"])).rejects.toMatchObject({ code: "link_imports_disabled" })
    expect(state.fetched).toEqual([])
    await expect(prepareLlmFiles(["https://media.example/own.pdf"])).resolves.toHaveLength(1)
  })
})
