/**
 * A deployment's `catalogs.images` (surface profile) on every reply that can
 * carry a picker picture: the REST directory and each catalog (compact and
 * full), `/v1/catalogs` with a pack registered (compact and full), and the
 * MCP get_picker_catalog tool (directory and each catalog, compact and full).
 *
 * "none" and "own" carry no picture anywhere — no imageUrl, no imageSrcSet,
 * no topic picture, an imageCount of 0, and no address on the Nodaro CDN or
 * under /picker-art/. "default" keeps them (the control: the same checks find
 * pictures, so an empty reply cannot pass). Community does not read the
 * surface profile, so its pictures stay whatever it says.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { summarizePickerCatalogs } from "@nodaro/prompts/picker-catalogs"

const env = vi.hoisted(() => ({ edition: "cloud", publicUrl: "" }))

vi.mock("../../lib/config.js", () => ({
  config: {
    get EDITION() {
      return env.edition
    },
    get PUBLIC_URL() {
      return env.publicUrl
    },
  },
  isCloud: () => env.edition === "cloud",
  isBusiness: () => env.edition === "business",
}))

import { pickerCatalogsRoutes } from "../picker-catalogs.js"
import { catalogsRoutes } from "../catalogs.js"
import { registerPickerCatalogs } from "../../lib/mcp/tools/picker-catalogs.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const savedProfile = process.env.NODARO_SURFACE_PROFILE
let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  await app.register(pickerCatalogsRoutes)
  await app.register(catalogsRoutes)
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
afterEach(() => {
  resetCatalogPacks()
  if (savedProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = savedProfile
  __resetSurfaceProfileCacheForTests()
})

function deploy(edition: string, images: string | undefined): void {
  env.edition = edition
  env.publicUrl = ""
  if (images === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ catalogs: { images } })
  __resetSurfaceProfileCacheForTests()
}

function mcpTool() {
  const tools: { handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }[] = []
  const server = { registerTool: (_n: string, _c: unknown, handler: (typeof tools)[number]["handler"]) => tools.push({ handler }) }
  registerPickerCatalogs(server as never, { userId: "u1", scopes: [] } as never)
  return tools[0]!.handler
}

interface Reply {
  readonly surface: string
  readonly body: string
}

/** Every reply that can carry a picker picture, as text. */
async function everyReply(): Promise<Reply[]> {
  const nodeTypes = summarizePickerCatalogs().map((s) => s.nodeType)
  expect(nodeTypes.length).toBeGreaterThan(30)
  const replies: Reply[] = []
  const rest = async (url: string) => {
    const res = await app.inject({ method: "GET", url })
    expect(res.statusCode, url).toBe(200)
    replies.push({ surface: `GET ${url}`, body: res.body })
  }
  const tool = mcpTool()
  const mcp = async (args: Record<string, unknown>) => {
    const res = await tool(args)
    replies.push({ surface: `get_picker_catalog ${JSON.stringify(args)}`, body: res.content.map((c) => c.text).join("\n") })
  }

  await rest("/v1/picker-catalogs")
  await mcp({})
  for (const t of nodeTypes) {
    await rest(`/v1/picker-catalogs/${t}`)
    await rest(`/v1/picker-catalogs/${t}?detail=full`)
    await mcp({ node_type: t })
    await mcp({ node_type: t, detail: "full" })
  }
  // /v1/catalogs projects every catalog only once a pack is registered.
  registerCatalogPack({ id: "images-setting-test", catalogId: "setting", mode: "deny", denyIds: [] })
  await rest("/v1/catalogs")
  await rest("/v1/catalogs?detail=full")
  const catalogs = replies.at(-1)!
  expect(JSON.parse(catalogs.body).curated).toBe(true)
  return replies
}

/** The picture marks a reply carries. */
function pictures(reply: Reply): string[] {
  const marks = [
    ['"imageUrl"', "an imageUrl"],
    ['"imageSrcSet"', "an imageSrcSet"],
    ["cdn.nodaro.ai", "a Nodaro CDN address"],
    ["/picker-art/", "a /picker-art/ address"],
  ] as const
  const found: string[] = marks.filter(([needle]) => reply.body.includes(needle)).map(([, what]) => what)
  if (/"imageCount":\s*[1-9]/.test(reply.body)) found.push("an imageCount above 0")
  return found
}

/** A reply's text, less the pack registry's version (each registration moves it). */
const comparable = (reply: Reply): string => reply.body.replace(/"version":\d+/g, '"version":0')

function imageCounts(reply: Reply): number[] {
  return [...reply.body.matchAll(/"imageCount":\s*(\d+)/g)].map((m) => Number(m[1]))
}

describe("catalogs.images on Cloud and Business", () => {
  for (const edition of ["cloud", "business"]) {
    for (const images of ["none", "own"]) {
      it(`"${images}" on ${edition}: no reply carries a picture`, async () => {
        deploy(edition, images)
        const replies = await everyReply()
        const found = replies.flatMap((r) => pictures(r).map((what) => `${r.surface}: ${what}`))
        expect(found).toEqual([])
        // The directories still count, at 0.
        const directories = replies.filter((r) => r.surface === "GET /v1/picker-catalogs" || r.surface === "get_picker_catalog {}")
        for (const d of directories) {
          const counts = imageCounts(d)
          expect(counts.length, d.surface).toBeGreaterThan(30)
          expect(new Set(counts), d.surface).toEqual(new Set([0]))
        }
      })
    }
  }

  it('"default" on Cloud: the same replies carry the platform\'s pictures (the control)', async () => {
    deploy("cloud", "default")
    const found = new Set((await everyReply()).flatMap(pictures))
    expect([...found].sort()).toEqual(["a /picker-art/ address", "a Nodaro CDN address", "an imageCount above 0", "an imageSrcSet", "an imageUrl"])
  })

  it('"default" on Business: its own pictures, as with no setting', async () => {
    deploy("business", undefined)
    const unset = (await everyReply()).map(comparable)
    resetCatalogPacks()
    deploy("business", "default")
    const withDefault = (await everyReply()).map(comparable)
    expect(withDefault).toEqual(unset)
    expect(withDefault.some((b) => b.includes("/picker-art/"))).toBe(true)
  })
})

describe("catalogs.images on Community", () => {
  it('ignores "none": the surface profile is not read there', async () => {
    deploy("community", undefined)
    const unset = (await everyReply()).map(comparable)
    resetCatalogPacks()
    deploy("community", "none")
    const withNone = (await everyReply()).map(comparable)
    expect(withNone).toEqual(unset)
    expect(withNone.some((b) => b.includes("/picker-art/"))).toBe(true)
  })
})
