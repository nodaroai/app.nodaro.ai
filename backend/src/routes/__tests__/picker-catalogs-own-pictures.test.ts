/**
 * A deployment's own picker pictures (lib/picker-pictures.ts) on every reply
 * that can carry a picker picture — the REST directory and each catalog, the
 * `/v1/catalogs` projection, and the MCP get_picker_catalog tool — under each
 * value of `catalogs.images`:
 *
 * - "own": the registered pictures and nothing of the platform's. An option
 *   with none has no picture; a topic has none. The enlarged picture rides as
 *   `imageLargeUrl` on the REST replies (the MCP tool leaves it out, as it
 *   leaves out `imageSrcSet`). `/v1/catalogs` sends its body even with no
 *   catalog pack (curated: false), because the editor reads the pictures there.
 * - "none": no picture at all, registered or not.
 * - "default": the platform's pictures, byte for byte as with nothing
 *   registered.
 * - nothing registered: every reply byte for byte as before, on every value.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { summarizePickerCatalogs } from "@nodaro/prompts/picker-catalogs"

const env = vi.hoisted(() => ({ edition: "cloud" }))

vi.mock("../../lib/config.js", () => ({
  config: {
    get EDITION() {
      return env.edition
    },
    PUBLIC_URL: "",
    R2_PUBLIC_URL: "https://media.example.com",
    R2_PUBLIC_FALLBACK_DOMAIN: "",
  },
  isCloud: () => env.edition === "cloud",
  isBusiness: () => env.edition === "business",
}))

import { pickerCatalogsRoutes } from "../picker-catalogs.js"
import { catalogsRoutes } from "../catalogs.js"
import { registerPickerCatalogs } from "../../lib/mcp/tools/picker-catalogs.js"
import { mcpLaneAddresses } from "../../lib/mcp-lane-addresses.js"
import { registerPickerPictures, resetPickerPicturesForTests } from "../../lib/picker-pictures.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const savedProfile = process.env.NODARO_SURFACE_PROFILE
let app: FastifyInstance

const MEDIA = "https://media.example.com/pictures"
const STYLE = { url: `${MEDIA}/style/cinematic.webp`, large: `${MEDIA}/style/cinematic.large.webp` }
const PERSON = `${MEDIA}/person/man.webp`
const SOUND = `${MEDIA}/music-genre/jazz.webp`

function registerOwn(): void {
  registerPickerPictures([
    { catalogId: "style", optionId: "cinematic", pictureUrl: STYLE.url, enlargedPictureUrl: STYLE.large },
    { catalogId: "person", optionId: "man", pictureUrl: PERSON },
    { catalogId: "music-genre", optionId: "jazz", pictureUrl: SOUND },
  ])
}

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
  resetPickerPicturesForTests()
  if (savedProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = savedProfile
  __resetSurfaceProfileCacheForTests()
})

function deploy(edition: string, images: string | undefined): void {
  env.edition = edition
  if (images === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ catalogs: { images } })
  __resetSurfaceProfileCacheForTests()
}

function mcpTool() {
  const tools: { handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }[] = []
  const server = { registerTool: (_n: string, _c: unknown, handler: (typeof tools)[number]["handler"]) => tools.push({ handler }) }
  registerPickerCatalogs(server as never, { userId: "u1", scopes: [], addresses: mcpLaneAddresses() } as never)
  return tools[0]!.handler
}

async function rest(url: string): Promise<string> {
  const res = await app.inject({ method: "GET", url })
  expect(res.statusCode, url).toBe(200)
  return res.body
}

async function mcp(args: Record<string, unknown>): Promise<string> {
  return (await mcpTool()(args)).content.map((c) => c.text).join("\n")
}

interface Reply {
  readonly surface: string
  readonly body: string
}

/** Every reply that can carry a picker picture, as text; `/v1/catalogs` without a pack and with one. */
async function everyReply(): Promise<Reply[]> {
  const nodeTypes = summarizePickerCatalogs().map((s) => s.nodeType)
  const replies: Reply[] = []
  const add = async (surface: string, body: Promise<string>) => replies.push({ surface, body: await body })
  await add("GET /v1/picker-catalogs", rest("/v1/picker-catalogs"))
  await add("get_picker_catalog {}", mcp({}))
  for (const t of nodeTypes) {
    await add(`GET /v1/picker-catalogs/${t}`, rest(`/v1/picker-catalogs/${t}`))
    await add(`GET /v1/picker-catalogs/${t}?detail=full`, rest(`/v1/picker-catalogs/${t}?detail=full`))
    await add(`get_picker_catalog ${t}`, mcp({ node_type: t }))
    await add(`get_picker_catalog ${t} full`, mcp({ node_type: t, detail: "full" }))
  }
  await add("GET /v1/catalogs (no pack)", rest("/v1/catalogs"))
  await add("GET /v1/catalogs?detail=full (no pack)", rest("/v1/catalogs?detail=full"))
  registerCatalogPack({ id: "own-pictures-test", catalogId: "setting", mode: "deny", denyIds: [] })
  await add("GET /v1/catalogs (a pack)", rest("/v1/catalogs"))
  await add("GET /v1/catalogs?detail=full (a pack)", rest("/v1/catalogs?detail=full"))
  resetCatalogPacks()
  return replies
}

/** The platform's picture marks a reply carries. */
function platformPictures(reply: Reply): string[] {
  const marks = [
    ['"imageSrcSet"', "an imageSrcSet"],
    ["cdn.nodaro.ai", "a Nodaro CDN address"],
    ["/picker-art/", "a /picker-art/ address"],
  ] as const
  return marks.filter(([needle]) => reply.body.includes(needle)).map(([, what]) => `${reply.surface}: ${what}`)
}

/** Every `"imageUrl"` / `"imageLargeUrl"` value in a reply. */
function addresses(body: string, key: "imageUrl" | "imageLargeUrl"): string[] {
  return [...body.matchAll(new RegExp(`"${key}":\\s*"([^"]+)"`, "g"))].map((m) => m[1]!)
}

const comparable = (body: string): string => body.replace(/"version":\d+/g, '"version":0')

describe('"own" with pictures registered', () => {
  for (const edition of ["cloud", "business"]) {
    it(`${edition}: every reply carries the registered pictures and none of the platform's`, async () => {
      deploy(edition, "own")
      registerOwn()
      const replies = await everyReply()
      expect(replies.flatMap(platformPictures)).toEqual([])
      const pictured = new Set([STYLE.url, PERSON, SOUND])
      for (const r of replies) {
        for (const url of addresses(r.body, "imageUrl")) expect(pictured.has(url), `${r.surface}: ${url}`).toBe(true)
      }
    })
  }

  it("the REST catalog carries the picture and the enlarged picture of each registered option, and nothing for the rest", async () => {
    deploy("cloud", "own")
    registerOwn()
    const style = JSON.parse(await rest("/v1/picker-catalogs/style")).data
    const cinematic = style.options.find((o: { id: string }) => o.id === "cinematic")
    expect(cinematic).toMatchObject({ imageUrl: STYLE.url, imageLargeUrl: STYLE.large })
    expect(style.options.filter((o: { imageUrl?: string }) => o.imageUrl !== undefined)).toHaveLength(1)
    const person = JSON.parse(await rest("/v1/picker-catalogs/person")).data
    const man = person.dimensions.flatMap((d: { options: unknown[] }) => d.options).find((o: { id: string }) => o.id === "man")
    expect(man.imageUrl).toBe(PERSON)
    expect(man.imageLargeUrl).toBeUndefined()
    // A topic is not an option: no topic picture under "own".
    expect(person.sections.length).toBeGreaterThan(0)
    expect(person.sections.filter((s: { imageUrl?: string }) => s.imageUrl !== undefined)).toEqual([])
  })

  it("the directory counts the registered pictures", async () => {
    deploy("cloud", "own")
    registerOwn()
    for (const body of [await rest("/v1/picker-catalogs"), await mcp({})]) {
      const rows = (JSON.parse(body).data ?? JSON.parse(body).pickers) as { catalogId: string; imageCount: number }[]
      const counted = Object.fromEntries(rows.filter((r) => r.imageCount > 0).map((r) => [r.catalogId, r.imageCount]))
      expect(counted).toEqual({ style: 1, person: 1, "music-genre": 1 })
    }
  })

  it("the MCP tool carries the picture but not the enlarged one (as it leaves out imageSrcSet)", async () => {
    deploy("cloud", "own")
    registerOwn()
    const body = await mcp({ node_type: "style" })
    expect(addresses(body, "imageUrl")).toEqual([STYLE.url])
    expect(body).not.toContain("imageLargeUrl")
  })

  it("/v1/catalogs sends its body with no catalog pack (curated: false), and the editor's reply carries both pictures", async () => {
    deploy("cloud", "own")
    registerOwn()
    const reply = JSON.parse(await rest("/v1/catalogs?detail=full"))
    expect(reply.curated).toBe(false)
    expect(reply.packs).toBe(0)
    const style = reply.data.find((c: { catalogId: string }) => c.catalogId === "style")
    expect(style.options.find((o: { id: string }) => o.id === "cinematic")).toMatchObject({ imageUrl: STYLE.url, imageLargeUrl: STYLE.large })
    registerCatalogPack({ id: "own-pictures-curated", catalogId: "setting", mode: "deny", denyIds: [] })
    expect(JSON.parse(await rest("/v1/catalogs")).curated).toBe(true)
  })
})

describe('"none" with pictures registered: nothing shows', () => {
  it("no reply carries a picture, and /v1/catalogs without a pack has no body", async () => {
    deploy("cloud", "none")
    registerOwn()
    const replies = await everyReply()
    expect(replies.flatMap((r) => addresses(r.body, "imageUrl").map((u) => `${r.surface}: ${u}`))).toEqual([])
    expect(replies.flatMap(platformPictures)).toEqual([])
    expect(replies.some((r) => r.body.includes("imageLargeUrl"))).toBe(false)
    const catalogs = JSON.parse(await rest("/v1/catalogs"))
    expect(catalogs).toEqual({ curated: false, packs: 0, version: catalogs.version })
  })
})

describe('"default" with pictures registered: the platform\'s pictures, exactly as with none registered', () => {
  for (const images of [undefined, "default"]) {
    it(`${images ?? "no setting"}`, async () => {
      deploy("cloud", images)
      const before = (await everyReply()).map((r) => comparable(r.body))
      registerOwn()
      const after = (await everyReply()).map((r) => comparable(r.body))
      expect(after).toEqual(before)
      expect(after.some((b) => b.includes("cdn.nodaro.ai"))).toBe(true)
      expect(after.some((b) => b.includes("media.example.com") || b.includes("imageLargeUrl"))).toBe(false)
    })
  }
})

describe("nothing registered: every value answers as before", () => {
  it('"own" is exactly "none", and /v1/catalogs without a pack keeps its empty answer', async () => {
    deploy("cloud", "none")
    const none = (await everyReply()).map((r) => comparable(r.body))
    deploy("cloud", "own")
    const own = (await everyReply()).map((r) => comparable(r.body))
    expect(own).toEqual(none)
    const catalogs = JSON.parse(await rest("/v1/catalogs"))
    expect(catalogs).toEqual({ curated: false, packs: 0, version: catalogs.version })
  })
})
