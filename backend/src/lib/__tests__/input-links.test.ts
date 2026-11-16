/**
 * The media-input funnel (lib/input-links.ts) and its lever
 * (`imports.inputLinks`, lib/surface-profile-client-keys.ts): how the lever is
 * read, what reaches /config.js, which fields of a request are judged, and
 * what `report` records.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const report = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => true))
vi.mock("../app-reports.js", () => ({ insertAppReport: report }))
vi.mock("../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../config.js")>()), isCloud: () => true, isBusiness: () => false }))

import { SurfaceProfileSchema, runtimeSurfaceProfile, surfaceAllowsLinkImports, surfaceInputLinksMode } from "../surface-profile.js"
import { renderSurfaceProfileForRuntimeConfig } from "../surface-profile-runtime-config.js"
import { inputLinkReportCounts, judgeInputLinks, judgedInputLinks, linkHost } from "../input-links.js"
import { inputLinkReadingForRoute } from "../input-link-lanes.js"
import { useProfile } from "./helpers/input-link-profiles.js"

const OWN = "https://media.nodaro.test"
const savedR2 = process.env.R2_PUBLIC_URL

beforeEach(() => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN
})

afterEach(() => {
  useProfile(undefined)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

const importsOf = (imports: unknown) => SurfaceProfileSchema.parse({ imports }).imports

describe("the lever, as the profile reads it", () => {
  it("absent: `imports` is exactly what it was", () => {
    expect(importsOf({ links: false })).toEqual({ links: false })
    expect(importsOf({ links: true })).toEqual({ links: true })
    expect(importsOf(undefined)).toBeUndefined()
  })

  it("each mode, in any case, with spaces", () => {
    expect(importsOf({ links: false, inputLinks: "allow" })).toEqual({ links: false, inputLinks: "allow" })
    expect(importsOf({ links: false, inputLinks: "report" })).toEqual({ links: false, inputLinks: "report" })
    expect(importsOf({ links: false, inputLinks: " Refuse " })).toEqual({ links: false, inputLinks: "refuse" })
  })

  it("a value that is not a mode takes the restrictive side, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(importsOf({ links: false, inputLinks: "reprot" })).toEqual({ links: false, inputLinks: "refuse" })
    expect(importsOf({ links: false, inputLinks: true })).toEqual({ links: false, inputLinks: "refuse" })
    expect(warn.mock.calls.flat().join(" ")).toMatch(/imports\.inputLinks .* using the restrictive "refuse"/)
    warn.mockRestore()
  })

  it("set while link imports are on, or without `links`: kept, inert, and said so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(importsOf({ links: true, inputLinks: "refuse" })).toEqual({ links: true, inputLinks: "refuse" })
    expect(importsOf({ inputLinks: "report" })).toEqual({ links: true, inputLinks: "report" })
    expect(warn.mock.calls.flat().join(" ")).toMatch(/has no effect while imports\.links is not false/)
    warn.mockRestore()
  })
})

describe("surfaceInputLinksMode: only a deployment with link imports off answers anything but allow", () => {
  it.each([
    [undefined, "allow"],
    [{ imports: { links: false } }, "allow"],
    [{ imports: { links: true, inputLinks: "refuse" } }, "allow"],
    [{ imports: { inputLinks: "refuse" } }, "allow"],
    [{ imports: { links: false, inputLinks: "allow" } }, "allow"],
    [{ imports: { links: false, inputLinks: "report" } }, "report"],
    [{ imports: { links: false, inputLinks: "refuse" } }, "refuse"],
  ])("%j → %s", (profile, mode) => {
    useProfile(profile as Record<string, unknown> | undefined)
    expect(surfaceInputLinksMode()).toBe(mode)
  })

  it("the link-import switch itself reads as before", () => {
    useProfile({ imports: { links: false, inputLinks: "report" } })
    expect(surfaceAllowsLinkImports()).toBe(false)
    useProfile({ imports: { inputLinks: "report" } })
    expect(surfaceAllowsLinkImports()).toBe(true)
  })
})

describe("/config.js: the lever is the server's, never a page's", () => {
  it("stripped, with `imports.links` kept", () => {
    useProfile({ imports: { links: false, inputLinks: "report" } })
    expect(JSON.parse(renderSurfaceProfileForRuntimeConfig()).imports).toEqual({ links: false })
  })

  it("without the lever, the same single JSON.stringify of the profile as before", () => {
    useProfile({ imports: { links: false } })
    expect(renderSurfaceProfileForRuntimeConfig()).toBe(JSON.stringify(runtimeSurfaceProfile()))
  })
})

describe("which values of a request are judged", () => {
  const fields = (body: unknown, route = "POST /v1/x") => judgedInputLinks(body, inputLinkReadingForRoute(route) ?? {}).map((f) => `${f.field} ${f.value}`)

  it("an address-named field, as an address (a host without its scheme too); a media-named one with a fetched scheme", () => {
    expect(fields({ imageUrl: "https://a.example/1.png", sourceUrl: "a.example/2.png", image: "https://a.example/3.png", video: "not a link" })).toEqual([
      "imageUrl https://a.example/1.png",
      "sourceUrl a.example/2.png",
      "image https://a.example/3.png",
    ])
  })

  it("list items as their list, nested objects by their own names, a JSON text of a list inside", () => {
    expect(fields({ referenceImageUrls: ["https://a.example/1.png"], refs: [{ url: "https://a.example/2.png" }], imageUrls: '["https://a.example/3.png"]' })).toEqual([
      "referenceImageUrls[] https://a.example/1.png",
      "refs[].url https://a.example/2.png",
      "imageUrls https://a.example/3.png",
    ])
  })

  it("never a prompt, an id, a JSON text, an endpoint the request posts to", () => {
    expect(
      fields({
        prompt: "like https://a.example/1.png",
        jobId: "https://a.example/2.png",
        json: '{"imageUrl":"https://a.example/3.png"}',
        webhookUrl: "https://hooks.example/x",
        callbackUrl: "https://hooks.example/y",
        redirect_uri: "https://app.example/cb",
      }),
    ).toEqual([])
  })

  it("a name that holds an address under another word: everything under it", () => {
    expect(fields({ segments: [{ src: "https://a.example/1.mp4" }], realLifeRefsByVariant: { front: ["https://a.example/2.png"] } })).toEqual([
      "segments[].src https://a.example/1.mp4",
      "realLifeRefsByVariant https://a.example/2.png",
    ])
  })

  it("a route's declared reader: a node preset's data read as a node's settings, its preview no input", () => {
    expect(fields({ data: { imageUrl: "https://a.example/1.png", generatedImageUrl: "https://a.example/out.png" }, previewUrl: "https://a.example/p.png" }, "POST /v1/node-presets")).toEqual([
      "data https://a.example/1.png",
      "data https://a.example/out.png",
    ])
  })

  it("an exempt route is not judged at all", () => {
    expect(inputLinkReadingForRoute("POST /v1/webhooks/:token")).toBeNull()
    expect(inputLinkReadingForRoute("PATCH /v1/admin/tutorials/:id")).toBeNull()
    expect(inputLinkReadingForRoute("POST /v1/trim-video")).toEqual({})
  })

  it("a host, never the address", () => {
    expect(linkHost("https://User:pw@CDN.Example:8443/a/b.png?sig=1")).toBe("cdn.example:8443")
    expect(linkHost("a.example/b.png")).toBe("a.example")
    expect(linkHost("::::")).toBe("(unreadable)")
  })
})

describe("the verdict", () => {
  const lane = { kind: "route", name: "POST /v1/x" } as const

  it("allow: nothing is read", () => {
    useProfile({ imports: { links: false } })
    expect(judgeInputLinks(lane, { imageUrl: "https://a.example/1.png" })).toEqual({ mode: "allow", found: [], refusal: null })
  })

  it("report: each outside link found and recorded, nothing refused; own storage and an upload stay out", async () => {
    useProfile({ imports: { links: false, inputLinks: "report" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const verdict = judgeInputLinks(lane, { imageUrl: "https://a.example/1.png", maskUrl: `${OWN}/images/m.png`, audioUrl: "data:audio/wav;base64,AAAA" }, { userId: "u-1" })
    expect(verdict).toEqual({ mode: "report", found: [{ field: "imageUrl", host: "a.example" }], refusal: null })
    expect(warn).toHaveBeenCalledWith('[input-links] would-refuse route="POST /v1/x" field=imageUrl host=a.example user=u-1')
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    warn.mockRestore()
  })

  it("report: a link on our host in a form another reader could read differently is outside, by the switch's own rule", () => {
    useProfile({ imports: { links: false, inputLinks: "report" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(judgeInputLinks(lane, { imageUrl: `${OWN}/cdn-cgi/image/w=100/images/a.png` }).found).toEqual([{ field: "imageUrl", host: "media.nodaro.test" }])
    warn.mockRestore()
  })

  it("report: the admin report is throttled per lane, field and host; the counts keep every link", async () => {
    useProfile({ imports: { links: false, inputLinks: "report" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (let i = 0; i < 3; i++) judgeInputLinks(lane, { imageUrl: `https://a.example/${i}.png` })
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    expect(inputLinkReportCounts().get("route:POST /v1/x|imageUrl|a.example")).toBe(3)
    expect(report.mock.calls[0]![0]).toMatchObject({ node: "input-links", kind: "input-link-report", severity: "info", payload: { host: "a.example", count: 1 } })
    warn.mockRestore()
  })

  it("a value judged already in this request is not judged again", () => {
    useProfile({ imports: { links: false, inputLinks: "report" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(judgeInputLinks(lane, { imageUrl: "https://a.example/1.png" }, { skip: new Set(["https://a.example/1.png"]) }).found).toEqual([])
    warn.mockRestore()
  })
})

describe("the REST hook (middleware/input-links.ts)", () => {
  async function appWith(authKind?: "internal" | "jwt") {
    const Fastify = (await import("fastify")).default
    const { registerInputLinkJudge } = await import("../../middleware/input-links.js")
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      req.userId = "u-1"
      if (authKind) req.authKind = authKind
    })
    registerInputLinkJudge(app)
    app.post("/v1/x", async () => ({ ok: true }))
    app.get("/v1/x", async () => ({ ok: true }))
    app.post("/v1/t", { config: { mcpTransport: true } }, async () => ({ ok: true }))
    app.post("/v1/webhooks/:token", async () => ({ ok: true }))
    await app.ready()
    return app
  }

  it("judges a body; never a GET, an internal call, the MCP transport or an exempt route", async () => {
    useProfile({ imports: { links: false, inputLinks: "report" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const lines = () => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[input-links]"))
    const payload = { imageUrl: "https://a.example/1.png" }
    const app = await appWith()
    expect((await app.inject({ method: "POST", url: "/v1/x", payload })).statusCode).toBe(200)
    expect(lines()).toEqual(['[input-links] would-refuse route="POST /v1/x" field=imageUrl host=a.example user=u-1'])
    warn.mockClear()
    await app.inject({ method: "GET", url: "/v1/x?imageUrl=https://a.example/1.png" })
    await app.inject({ method: "POST", url: "/v1/t", payload })
    await app.inject({ method: "POST", url: "/v1/webhooks/abc", payload })
    expect(lines()).toEqual([])
    await app.close()
    const internal = await appWith("internal")
    await internal.inject({ method: "POST", url: "/v1/x", payload })
    expect(lines()).toEqual([])
    await internal.close()
    warn.mockRestore()
  })
})

describe("what a name says, and what the lanes table says instead", () => {
  it("an entity's voice sample is no input (played by the browser): saving a character with a library voice is not judged on it", () => {
    const body = { name: "Kira", sourceImageUrl: "https://a.example/kira.png", voice: { voiceId: "v1", voiceName: "Ava", traits: "", previewUrl: "https://storage.googleapis.com/voices/ava.mp3" } }
    expect(judgedInputLinks(body, inputLinkReadingForRoute("POST /v1/characters")!).map((f) => f.field)).toEqual(["sourceImageUrl"])
  })

  it("a collection record keeps its link and media as data: not judged where it is written", () => {
    expect(inputLinkReadingForRoute("POST /v1/collections/:id/records")).toBeNull()
    expect(inputLinkReadingForRoute("POST /v1/collection-write")).toBeNull()
  })
})

describe("the workflow lane's reading of a node", () => {
  it("a node's own results, an endpoint it posts to and a type kept as data are not its inputs", async () => {
    useProfile({ imports: { links: false, inputLinks: "refuse" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { judgeNodeInputLinks } = await import("../../services/workflow-engine/node-input-links.js")
    const node = (type: string, data: Record<string, unknown>) => ({ id: "n", type, data }) as never
    expect(judgeNodeInputLinks(node("audio-separation", { vocalUrl: "https://a.example/v.mp3", generatedAudioUrl: "https://a.example/o.mp3" }), {}, "u").found).toEqual([])
    expect(judgeNodeInputLinks(node("webhook-output", { url: "https://hooks.example/x" }), {}, "u").found).toEqual([])
    expect(judgeNodeInputLinks(node("collection-write", { link: "https://a.example/post" }), { imageUrl: "https://a.example/1.png" }, "u").found).toEqual([])
    // Its own media settings and what its wires hand it are.
    expect(judgeNodeInputLinks(node("generate-image", { referenceImageUrls: ["https://a.example/r.png"] }), { videoUrl: "https://b.example/v.mp4" }, "u").found).toEqual([
      { field: "node.data.referenceImageUrls[]", host: "a.example" },
      { field: "inputs.videoUrl", host: "b.example" },
    ])
    warn.mockRestore()
  })
})

describe("a link that is cited, never fetched", () => {
  it("a content recipe's post link: not judged on its route, nor in a run (wired, typed or sent)", async () => {
    useProfile({ imports: { links: false, inputLinks: "refuse" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(judgedInputLinks({ source: "text", sourceUrl: "https://social.example/p/1" }, inputLinkReadingForRoute("POST /v1/content-recipe")!)).toEqual([])
    const { judgeNodeInputLinks, judgeNodePayloadLinks } = await import("../../services/workflow-engine/node-input-links.js")
    const node = { id: "n", type: "content-recipe", data: { sourceUrl: "https://social.example/p/1" } } as never
    expect(judgeNodeInputLinks(node, { sourceLink: "https://social.example/p/2" }, "u").found).toEqual([])
    expect(judgeNodePayloadLinks(node, {}, { sourceUrl: "https://social.example/p/2" }, "u").found).toEqual([])
    warn.mockRestore()
  })
})
