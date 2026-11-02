import { describe, expect, it } from "vitest"
import type { FetchLike } from "../github.js"
import type { WorldLink } from "../report-types.js"
import { parseWorldsFile, readWorldsFile, siteWorlds, WORLDS_FILE, type WorldsFile } from "../site-worlds.js"
import { askOnce } from "../world-links.js"

/**
 * Where a site's worlds row leads, as the site says in `/shell-worlds.json`:
 * the file's addresses laid over the header's own (a world it leaves out keeps
 * the header's), a path on the site's own address, and the row hidden when
 * the site hides it. A site that serves no such file says nothing; one this
 * page cannot read is said so, with where.
 */

const HOST = "next.tools.example.com"
const file = (body: unknown) => parseWorldsFile(JSON.stringify(body), HOST)
const reported = (worldsRow: boolean, hrefs: Record<string, string>): WorldsFile => ({ status: "reported", worldsRow, hrefs: new Map(Object.entries(hrefs)) })

/** The header's list as its map gives it, each at its own address. */
const LIST: WorldLink[] = [
  { id: "image", label: "Image", href: "https://example.com/image", group: "simple", answer: { status: "answered", code: 404 } },
  { id: "video", label: "Video", href: "https://example.com/video", group: "simple", answer: { status: "answered", code: 404 } },
  { id: "app", label: "App", href: "https://app.example.com", group: "advanced", answer: { status: "answered", code: 200 } },
]

describe("parseWorldsFile", () => {
  it("reads the row and every address, a path as a page of the site itself", () => {
    expect(file({ worldsRow: true, worldHrefs: { image: "/image", app: "https://next.example.com", studio: "/" } })).toEqual(
      reported(true, { image: `https://${HOST}/image`, app: "https://next.example.com/", studio: `https://${HOST}/` }),
    )
    expect(file({ worldsRow: false, worldHrefs: {} })).toEqual(reported(false, {}))
  })

  it("keeps a world the header no longer lists (the header ignores it; the page does not draw it)", () => {
    expect(file({ worldsRow: true, worldHrefs: { ads: "/ads" } })).toEqual(reported(true, { ads: `https://${HOST}/ads` }))
  })

  it("a site that sends its page for every address, or no JSON object, has no file", () => {
    for (const body of ["<!doctype html><title>Tools</title>", "", "null", "[1]", '"text"']) {
      expect(parseWorldsFile(body, HOST)).toEqual({ status: "not_reported" })
    }
  })

  it.each([
    ["an address that is not https", { worldsRow: true, worldHrefs: { image: "http://example.com/image" } }, /worldHrefs\.image: must be an https:\/\/ address/],
    ["an address that leaves the site from a path", { worldsRow: true, worldHrefs: { image: "//other.example.com/image" } }, /worldHrefs\.image: must be/],
    ["an https address that is none", { worldsRow: true, worldHrefs: { image: "https://" } }, /worldHrefs\.image: not an https address or a page of this site/],
    ["a path an address reads as another site", { worldsRow: true, worldHrefs: { image: "/\\other.example.com/image" } }, /worldHrefs\.image: not an https address or a page of this site/],
    ["a path with a tab that reads as another site", { worldsRow: true, worldHrefs: { image: "/\t/other.example.com/image" } }, /worldHrefs\.image: not an https address or a page of this site/],
    ["a world id that is not one", { worldsRow: true, worldHrefs: { "Not An Id": "/x" } }, /worldHrefs/],
    ["a row that is not yes or no", { worldsRow: "yes", worldHrefs: {} }, /worldsRow/],
    ["no addresses at all", { worldsRow: true }, /worldHrefs/],
    ["an address too long", { worldsRow: true, worldHrefs: { image: `/${"x".repeat(300)}` } }, /worldHrefs\.image/],
    ["more worlds than a header has", { worldsRow: true, worldHrefs: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`w${i}`, "/"])) }, /at most 30 worlds/],
  ])("refuses %s, saying where", (_name, body, where) => {
    const read = file(body)
    expect(read.status).toBe("invalid")
    expect(read.status === "invalid" && read.message).toMatch(where)
    expect(read.status === "invalid" && read.message).toContain(`/${WORLDS_FILE}`)
  })

  it("refuses a file that is not JSON, and one too large to be addresses, before parsing it", () => {
    expect(parseWorldsFile("{ not json", HOST)).toEqual({ status: "invalid", message: `/${WORLDS_FILE} is not valid JSON.` })
    const huge = JSON.stringify({ worldsRow: true, worldHrefs: {}, padding: "x".repeat(17_000) })
    expect(parseWorldsFile(huge, HOST)).toEqual({ status: "invalid", message: `/${WORLDS_FILE} is larger than 16 KB.` })
  })
})

describe("readWorldsFile", () => {
  it("asks the site's own file past any cache, as JSON", async () => {
    const asked: { url: string; accept: string | undefined }[] = []
    const fetch: FetchLike = async (url, init) => {
      asked.push({ url, accept: (init?.headers as Record<string, string> | undefined)?.accept })
      return new Response(JSON.stringify({ worldsRow: true, worldHrefs: { image: "/image" } }))
    }
    expect(await readWorldsFile(fetch, () => 42, HOST)).toEqual(reported(true, { image: `https://${HOST}/image` }))
    expect(asked).toEqual([{ url: `https://${HOST}/${WORLDS_FILE}?t=42`, accept: "application/json" }])
  })

  it("no such file is not reported; a site down or failing did not answer", async () => {
    const missing: FetchLike = async () => new Response("Not Found", { status: 404 })
    const failing: FetchLike = async () => new Response("Bad Gateway", { status: 502 })
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed")
    }
    expect(await readWorldsFile(missing, () => 0, HOST)).toEqual({ status: "not_reported" })
    expect(await readWorldsFile(failing, () => 0, HOST)).toEqual({ status: "no_answer" })
    expect(await readWorldsFile(down, () => 0, HOST)).toEqual({ status: "no_answer" })
  })
})

describe("siteWorlds", () => {
  const answering = () => {
    const probed: string[] = []
    const ask = askOnce(async (href) => {
      probed.push(href)
      return href.startsWith("https://example.com/") ? 404 : 200
    })
    return { ask, probed }
  }

  it("every world of the list in its order: the site's address where it gives one, else the header's, each asked", async () => {
    const { ask, probed } = answering()
    const read = await siteWorlds(reported(true, { video: `https://${HOST}/video`, app: "https://next.example.com/", ads: `https://${HOST}/ads` }), LIST, ask)
    expect(read).toEqual({
      status: "reported",
      worldsRow: true,
      links: [
        { id: "image", href: "https://example.com/image", own: false, answer: { status: "answered", code: 404 } },
        { id: "video", href: `https://${HOST}/video`, own: true, answer: { status: "answered", code: 200 } },
        { id: "app", href: "https://next.example.com/", own: true, answer: { status: "answered", code: 200 } },
      ],
    })
    // A world the list does not have is neither drawn nor asked.
    expect(probed.sort()).toEqual(["https://example.com/image", `https://${HOST}/video`, "https://next.example.com/"].sort())
  })

  it("a hidden row leads nowhere, and nothing is asked", async () => {
    const { ask, probed } = answering()
    expect(await siteWorlds(reported(false, { studio: `https://${HOST}/` }), LIST, ask)).toEqual({ status: "reported", worldsRow: false, links: [] })
    expect(probed).toEqual([])
  })

  it("without the header's list nothing is drawn; a site without a file, or with one unread, says so", async () => {
    const { ask, probed } = answering()
    expect(await siteWorlds(reported(true, { image: "https://x.example/" }), null, ask)).toEqual({ status: "reported", worldsRow: true, links: [] })
    expect(await siteWorlds({ status: "not_reported" }, LIST, ask)).toEqual({ status: "not_reported" })
    expect(await siteWorlds({ status: "invalid", message: "why" }, LIST, ask)).toEqual({ status: "invalid", message: "why" })
    expect(await siteWorlds({ status: "no_answer" }, LIST, ask)).toEqual({ status: "no_answer" })
    expect(probed).toEqual([])
  })
})
