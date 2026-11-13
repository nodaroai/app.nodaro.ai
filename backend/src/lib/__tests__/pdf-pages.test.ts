// @test-watches backend/src/lib/__tests__/fixtures/pdf/legit/*.pdf backend/src/lib/__tests__/fixtures/pdf/attack/*.pdf backend/src/lib/__tests__/fixtures/pdf/tree/*.pdf
/**
 * A document's page count (`lib/pdf-pages.ts`, decided 2026-11-13): pdf-lib in
 * an isolated, bounded worker thread, the count the leaves of the page tree.
 *
 * Fixtures (`fixtures/pdf/`): `legit/` are real writers' files — Ghostscript
 * pdfwrite in its usual modes (object streams, none, linearised, PDF 1.4, an
 * owner password), Chrome, pdflatex, LuaLaTeX, Quartz — with the page counts a
 * reference reader (poppler) gives. `attack/` are crafted files of 150 pages
 * (60 for F1) built to make a keyword scan under-count, and `tree/` files of
 * 150 built to make a front-to-back parser under-count (duplicate objects,
 * decoy trailers, pages hidden from the tree); each must be refused or counted
 * at least as high as the reference readers show it — orphaned page objects
 * may count too (F1 reads 150, A4 151), the safe direction. The large
 * adversarial inputs are built here, never committed.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { fileURLToPath } from "node:url"
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib"
import { countPdfPages, PdfReaderBusyError, PDF_PARSE_TIMEOUT_MS, takeDocumentReadTurn, __holdPdfReaderSlotsForTests } from "../pdf-pages.js"

const FIXTURES = fileURLToPath(new URL("./fixtures/pdf/", import.meta.url))
const fixture = (path: string) => readFileSync(FIXTURES + path)

/** Poppler's page counts for the real writers' files. */
const LEGIT_PAGES: Record<string, number> = {
  "chrome.pdf": 30,
  "gs-14.pdf": 37,
  "gs-linear.pdf": 37,
  "gs-noobjstm.pdf": 37,
  "gs-owner-enc.pdf": 37,
  "gs-plain.pdf": 37,
  "lualatex.pdf": 28,
  "pdflatex.pdf": 28,
  "quartz.pdf": 1,
}

/** The crafted files' real page counts (poppler's). */
const ATTACK_PAGES = (name: string) => (name === "F1.pdf" ? 60 : 150)

describe("countPdfPages — real writers' files", () => {
  it("has a count for every legit fixture", () => {
    expect(readdirSync(FIXTURES + "legit").filter((f) => f.endsWith(".pdf")).sort()).toEqual(Object.keys(LEGIT_PAGES).sort())
  })

  it.each(Object.entries(LEGIT_PAGES))("%s counts %i pages", async (name, pages) => {
    const count = await countPdfPages(fixture(`legit/${name}`))
    expect(count?.pages).toBe(pages)
    expect(count!.holdPages).toBeGreaterThanOrEqual(pages)
  })
})

describe("countPdfPages — crafted files are counted right or refused, never under-counted", () => {
  const attacks = readdirSync(FIXTURES + "attack").filter((f) => f.endsWith(".pdf")).sort()

  it("covers the review's crafted files", () => {
    expect(attacks.length).toBeGreaterThanOrEqual(19)
  })

  it.each(attacks)("%s", async (name) => {
    const count = await countPdfPages(fixture(`attack/${name}`))
    // Refused (null) or never held low; a low hold would let a long file through cheaply.
    if (count !== null) expect(count.holdPages).toBeGreaterThanOrEqual(ATTACK_PAGES(name))
  })

  it("counts the pages whose dictionaries omit their type, and ignores a forged /Count", async () => {
    // A1–A3b: typeless pages with /Count written as leading zeros, +N, or a reference.
    for (const name of ["A1.pdf", "A2.pdf", "A3.pdf", "A3b.pdf"]) expect((await countPdfPages(fixture(`attack/${name}`)))?.pages, name).toBe(150)
  })
})

/**
 * What pdfium, mupdf and poppler show for each `tree/` file. U1t's typeless
 * duplicate tree shows 1 page in all three (only pypdf reads 150), so 1 is
 * its floor; every other file holds 150 pages.
 */
const TREE_PAGES = (name: string) => (name.startsWith("U1t-") ? 1 : 150)

describe("countPdfPages — a front-to-back parse never under-counts what a reader shows", () => {
  const trees = readdirSync(FIXTURES + "tree").filter((f) => f.endsWith(".pdf")).sort()

  it("covers the review's page-tree files", () => {
    expect(trees.length).toBeGreaterThanOrEqual(13)
  })

  it.each(trees)("%s", async (name) => {
    const count = await countPdfPages(fixture(`tree/${name}`))
    if (count !== null) expect(count.holdPages).toBeGreaterThanOrEqual(TREE_PAGES(name))
  })

  it("holds the duplicate trees, decoy trailers and a page that carries kids at their 150 pages", async () => {
    // U1, U10a, U10b, U2 and U3: each held 1 before the hold took the largest of three readings.
    const exact = trees.filter((name) => /^U(?:1|10a|10b|2|3)-/.test(name))
    expect(exact).toHaveLength(5)
    for (const name of exact) expect((await countPdfPages(fixture(`tree/${name}`)))?.holdPages, name).toBe(150)
  })
})

/** An ordinary pdf-lib document of `n` text pages (built here, as an editing tool would). */
async function pdfLibDoc(n: number): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < n; i++) doc.addPage([300, 300]).drawText(`page ${i + 1}`, { x: 20, y: 150, font, size: 18 })
  return doc
}

describe("countPdfPages — an edited ordinary file reads what a reader shows; its hold may be larger", () => {
  it("pages removed and saved (their objects left behind): 80 pages, held at the larger count", async () => {
    for (const useObjectStreams of [true, false]) {
      const doc = await pdfLibDoc(150)
      for (let i = 0; i < 70; i++) doc.removePage(doc.getPageCount() - 1)
      const count = await countPdfPages(await doc.save({ useObjectStreams }))
      expect(count?.pages, String(useObjectStreams)).toBe(80)
      expect(count!.holdPages, String(useObjectStreams)).toBeGreaterThanOrEqual(80)
    }
    // Loaded, edited, saved again: the "delete pages" web-tool flow.
    const loaded = await PDFDocument.load(await (await pdfLibDoc(150)).save())
    for (let i = 0; i < 70; i++) loaded.removePage(0)
    expect((await countPdfPages(await loaded.save()))?.pages).toBe(80)
  }, 30_000)

  it("an incremental update that deletes pages: the update's tree, held at the larger count", async () => {
    const doc = await pdfLibDoc(120)
    const base = Buffer.from(await doc.save({ useObjectStreams: false }))
    const text = base.toString("latin1")
    const pagesRef = doc.catalog.get(PDFName.of("Pages")) as unknown as { objectNumber: number }
    const kids = doc.getPages().slice(0, 60).map((p) => `${p.ref.objectNumber} 0 R`).join(" ")
    const startxref = Number(/startxref\s+(\d+)/.exec(text.slice(text.lastIndexOf("startxref")))![1])
    const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(text)![1]!
    const size = /\/Size (\d+)/.exec(trailer)![1]
    const root = /\/Root (\d+ \d+ R)/.exec(trailer)![1]
    const obj = `\n${pagesRef.objectNumber} 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count 60 >>\nendobj\n`
    const xrefAt = base.length + Buffer.byteLength(obj, "latin1")
    const update = `xref\n${pagesRef.objectNumber} 1\n${String(base.length + 1).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${size} /Root ${root} /Prev ${startxref} >>\nstartxref\n${xrefAt}\n%%EOF\n`
    const count = await countPdfPages(Buffer.concat([base, Buffer.from(obj + update, "latin1")]))
    expect(count?.pages).toBe(60)
    expect(count!.holdPages).toBe(120)
  }, 30_000)
})

/** A minimal PDF of `pages` pages, every object written in place and an xref. */
function tinyPdf(pages: number, opts: { kids?: (kids: number[]) => string } = {}): Buffer {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
  const kids: number[] = []
  for (let p = 0; p < pages; p++) {
    objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>")
    kids.push(objs.length)
  }
  objs[1] = `<< /Type /Pages /Kids [${opts.kids ? opts.kids(kids) : kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`
  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

describe("countPdfPages — the page tree", () => {
  it("counts each reference to a page, and stops at a cycle", async () => {
    expect(await countPdfPages(tinyPdf(3))).toEqual({ pages: 3, holdPages: 3 })
    // A page listed twice is shown twice.
    expect((await countPdfPages(tinyPdf(2, { kids: (k) => `${k[0]} 0 R ${k[0]} 0 R ${k[1]} 0 R` })))?.pages).toBe(3)
    // The tree lists itself: never an endless walk.
    expect((await countPdfPages(tinyPdf(2, { kids: (k) => `${k.map((n) => `${n} 0 R`).join(" ")} 2 0 R` })))?.pages).toBe(2)
  })

  it("is null for a file with no page or no catalog", async () => {
    expect(await countPdfPages(tinyPdf(0))).toBeNull()
    expect(await countPdfPages(Buffer.from("%PDF-1.4\n%%EOF\n", "latin1"))).toBeNull()
  })
})

/**
 * One page, plus an object stream whose `n` entries all point at ONE stream of
 * `mb` MB inside it: pdf-lib parses that stream once per entry, and copied its
 * bytes each time (outside the heap limit) until the worker made them views.
 */
function amplifyingPdf(n: number, mb: number): Buffer {
  const L = Math.floor(mb * 1024 * 1024)
  let pairs = ""
  for (let k = 0; k < n; k++) pairs += `${100 + k} 0 `
  const body = Buffer.concat([Buffer.from(pairs, "latin1"), Buffer.from(`<< /Length ${L} >>stream\n`, "latin1"), Buffer.alloc(L, 0x20), Buffer.from("\nendstream\n", "latin1")])
  const z = deflateSync(body, { level: 9 })
  const head = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
    "latin1",
  )
  return Buffer.concat([
    head,
    Buffer.from(`4 0 obj\n<< /Type /ObjStm /N ${n} /First ${Buffer.byteLength(pairs, "latin1")} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, "latin1"),
    z,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n", "latin1"),
  ])
}

/** One page, then a long run of digits pdf-lib searches for an object header at every byte: slow, never answered in time. */
function slowPdf(digits = 100_000): Buffer {
  return Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
      "x" + "1".repeat(digits) + "\ntrailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n",
    "latin1",
  )
}

describe("countPdfPages — a hostile file stays in its worker", () => {
  it("one stream listed thousands of times is read once, its memory flat", async () => {
    for (const n of [400, 4_000]) {
      const file = amplifyingPdf(n, 14)
      expect(file.length).toBeLessThan(64 * 1024)
      let peak = 0
      const before = process.memoryUsage.rss()
      const sampler = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage.rss() - before)
      }, 10)
      const t0 = performance.now()
      const count = await countPdfPages(file)
      clearInterval(sampler)
      expect(count?.pages, String(n)).toBe(1)
      expect(performance.now() - t0, String(n)).toBeLessThan(PDF_PARSE_TIMEOUT_MS)
      // Copies would be n × 14 MB (5.5 GB at 400); views keep it to the one decoded stream.
      expect(peak, String(n)).toBeLessThan(400 * 1024 * 1024)
    }
  }, 30_000)

  it("one user's reads wait behind each other, never taking a second worker: another user's file still counts", async () => {
    const slow = slowPdf()
    const t0 = performance.now()
    const mine = Array.from({ length: 4 }, () => countPdfPages(slow, { owner: "user-a", timeoutMs: 800 }))
    await new Promise((r) => setTimeout(r, 100))
    const t1 = performance.now()
    expect((await countPdfPages(tinyPdf(1), { owner: "user-b" }))?.pages).toBe(1)
    // Answered while user A's reads are still queued behind each other.
    expect(performance.now() - t1).toBeLessThan(1_500)
    expect(await Promise.all(mine)).toEqual([null, null, null, null])
    // One at a time: four timed-out reads take at least four time limits.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(4 * 800)
  }, 30_000)

  it("refuses a decompression bomb without inflating it", async () => {
    const data = deflateSync(Buffer.alloc(200 * 1024 * 1024, 0x20), { level: 9 })
    const bomb = Buffer.concat([
      Buffer.from(`%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, "latin1"),
      data,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
    ])
    expect(bomb.length).toBeLessThan(256 * 1024)
    const t0 = performance.now()
    expect(await countPdfPages(bomb)).toBeNull()
    expect(performance.now() - t0).toBeLessThan(PDF_PARSE_TIMEOUT_MS + 1_000)
  }, 20_000)

  it("answers 6 MB of adversarial keywords within its time limit, the main thread free meanwhile", async () => {
    const sixMb = (unit: string) => Buffer.from("%PDF-1.4\n" + unit.repeat(Math.floor((6 * 1024 * 1024) / unit.length)), "latin1")
    for (const [name, unit] of [
      ["objects never closed", "1 0 obj\n"],
      ["bare keywords", "obj "],
      ["a run of digits", "1"],
      ["escaped names", "/Type /Type /P#61ge "],
      ["filter arrays never closed", "<< /Filter [ "],
    ] as const) {
      // The main thread keeps ticking while the worker reads.
      let ticks = 0
      const ticker = setInterval(() => ticks++, 50)
      const t0 = performance.now()
      const pages = await countPdfPages(sixMb(unit))
      clearInterval(ticker)
      expect(pages, name).toBeNull()
      expect(performance.now() - t0, name).toBeLessThan(PDF_PARSE_TIMEOUT_MS + 1_000)
      if (performance.now() - t0 > 500) expect(ticks, name).toBeGreaterThan(3)
    }
  }, 60_000)

  it("a turn given up while waiting never lets a later read start beside the running one", async () => {
    for (const preAborted of [false, true]) {
      const owner = `turns-${preAborted}`
      const releaseA = await takeDocumentReadTurn(owner)
      const gone = new AbortController()
      if (preAborted) gone.abort(new Error("gone"))
      const b = takeDocumentReadTurn(owner, gone.signal)
      if (!preAborted) {
        await new Promise((r) => setTimeout(r, 10))
        gone.abort(new Error("gone"))
      }
      await expect(b).rejects.toThrow("gone")
      let cStarted = false
      const c = takeDocumentReadTurn(owner).then((release) => {
        cStarted = true
        return release
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(cStarted, String(preAborted)).toBe(false)
      releaseA()
      ;(await c)()
      expect(cStarted).toBe(true)
    }
  })

  it("a read waiting behind the same owner's past its limit is refused as busy, and the line goes on", async () => {
    const releaseA = await takeDocumentReadTurn("waiter")
    await expect(takeDocumentReadTurn("waiter", undefined, 50)).rejects.toBeInstanceOf(PdfReaderBusyError)
    let cStarted = false
    const c = takeDocumentReadTurn("waiter").then((release) => {
      cStarted = true
      return release
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(cStarted).toBe(false)
    releaseA()
    ;(await c)()
  })

  it("refuses as busy when every reader is taken past the wait, and stops on abort", async () => {
    const release = await __holdPdfReaderSlotsForTests()
    try {
      await expect(countPdfPages(tinyPdf(1), { waitMs: 50 })).rejects.toBeInstanceOf(PdfReaderBusyError)
      const gone = new AbortController()
      const waiting = countPdfPages(tinyPdf(1), { waitMs: 5_000, signal: gone.signal })
      gone.abort(new Error("client gone"))
      await expect(waiting).rejects.toThrow("client gone")
    } finally {
      release()
    }
    // Free again once released.
    expect((await countPdfPages(tinyPdf(2)))?.pages).toBe(2)
  })

  it("stops a read in flight when the request is aborted", async () => {
    const gone = new AbortController()
    const reading = countPdfPages(Buffer.from("%PDF-1.4\n" + "1 0 obj\n".repeat(700_000), "latin1"), { signal: gone.signal })
    setTimeout(() => gone.abort(new Error("client gone")), 100)
    await expect(reading).rejects.toThrow("client gone")
  })
})
